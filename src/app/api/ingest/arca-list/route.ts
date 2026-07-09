import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";
import { extractInvoiceList } from "@/lib/ai/extract";
import { onlyDigits } from "@/lib/cuit";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/ingest/arca-list
 * Form-data: file (PDF "Mis Comprobantes Recibidos/Emitidos" de ARCA)
 *
 * Procesa un PDF tipo listado y crea UNA factura por cada fila.
 * - Clasifica venta/compra automáticamente por el CUIT del titular vs CUIT emisor.
 * - Usa el listado como "storage_path" compartido (no hay PDF individual de cada factura).
 * - Marca ai_metadata.from_arca_list = true para distinguir del flujo individual.
 */
export async function POST(req: NextRequest) {
  const { user, companyId } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });

  const admin = createAdminClient();
  const { data: comp } = await admin.from("companies").select("cuit").eq("id", companyId).maybeSingle();
  const cuitEmpresa = onlyDigits(comp?.cuit);

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });

  const ext = file.name.split(".").pop() ?? "pdf";
  const storagePath = `${companyId}/arca-list/${new Date().toISOString().slice(0,7)}/${crypto.randomUUID()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const up = await admin.storage.from("invoices").upload(storagePath, bytes, { contentType: file.type });
  if (up.error) return NextResponse.json({ error: "No se pudo subir: " + up.error.message }, { status: 500 });

  const base64 = Buffer.from(bytes).toString("base64");
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  let data;
  try {
    data = await extractInvoiceList(
      isPdf ? { type: "pdf", base64 } : { type: "image", mediaType: (file.type || "image/png") as any, base64 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: "Error del motor de IA: " + e.message }, { status: 500 });
  }

  if (!data?.facturas?.length) {
    return NextResponse.json({ error: "No pude detectar facturas en este PDF. ¿Es un listado ARCA válido?" }, { status: 400 });
  }

  // Detección de duplicados: por (tipo, punto_venta, numero, cuit_emisor)
  // Traemos las existentes del año de ese rango para comparar rápido
  const fechas = data.facturas.map(f => f.fecha_emision).filter(Boolean).sort();
  const desde = fechas[0];
  const hasta = fechas[fechas.length - 1];

  const { data: existentes } = await admin
    .from("invoices")
    .select("id, fecha, cuit, comprobante, total")
    .eq("company_id", companyId)
    .gte("fecha", desde || "2000-01-01")
    .lte("fecha", hasta || "2100-12-31");

  const existKey = (c: string | null, fecha: string, cuit: string | null, total: number) =>
    `${c ?? ""}|${fecha}|${onlyDigits(cuit ?? "")}|${Math.round(total * 100)}`;
  const existSet = new Set((existentes ?? []).map(e =>
    existKey(e.comprobante, e.fecha, e.cuit, Number(e.total))
  ));

  // Armamos el batch
  const rows: any[] = [];
  const skipped: any[] = [];
  const monedaWarnings: string[] = [];

  // El tipo_listado que devuelve la IA es la fuente de verdad principal:
  //   "emitidos" (Mis Comprobantes Emitidos) → TODAS son ventas nuestras
  //   "recibidos" (Mis Comprobantes Recibidos) → TODAS son compras que nos hicieron
  // Solo caemos al match de CUIT si el tipo_listado no está claro.
  const tipoListado = String(data.tipo_listado ?? "").toLowerCase();

  for (const f of data.facturas) {
    const cuitEmisor = onlyDigits(f.cuit_emisor);
    let tipo: "venta" | "compra";
    if (tipoListado === "emitidos") {
      tipo = "venta";
    } else if (tipoListado === "recibidos") {
      tipo = "compra";
    } else {
      // Fallback: comparar CUITs si no está claro qué tipo de listado es
      tipo = (cuitEmisor && cuitEmpresa && cuitEmisor === cuitEmpresa) ? "venta" : "compra";
    }
    const razon_social = f.razon_social_emisor;
    const cuit = formatCuit(cuitEmisor);

    // Moneda y tipo de cambio
    const moneda = (f.moneda === "USD" || f.moneda === "EUR" || f.moneda === "OTRA") ? f.moneda : "ARS";
    const tcRaw = Number(f.tipo_cambio ?? 0);
    const tipo_cambio = moneda === "ARS" ? 1 : (tcRaw > 0 ? tcRaw : 1);

    // Importes originales
    const netoOrig  = Number(f.neto_gravado) || 0;
    const ivaOrig   = Number(f.iva_total) || 0;
    const otrosOrig = Number(f.otros_tributos) || 0;
    const totalOrig = Number(f.total) || 0;

    // Importes convertidos a ARS
    const neto  = Math.round(netoOrig  * tipo_cambio * 100) / 100;
    const iva   = Math.round(ivaOrig   * tipo_cambio * 100) / 100;
    const otros = Math.round(otrosOrig * tipo_cambio * 100) / 100;
    const total = Math.round(totalOrig * tipo_cambio * 100) / 100;

    if (moneda !== "ARS" && tcRaw <= 0) {
      monedaWarnings.push(`Factura ${f.comprobante ?? "sin ID"} en ${moneda} sin TC — se guardó tratando el importe como ARS. Editá manualmente el TC.`);
    }

    const key = existKey(f.comprobante, f.fecha_emision, cuitEmisor, total);
    if (existSet.has(key)) { skipped.push({ comprobante: f.comprobante, razon_social, reason: "duplicado" }); continue; }

    const ivaBuckets = inferIvaBuckets({
      neto_gravado: neto,
      iva_total:    iva,
      letra:        f.letra,
      codigo_afip:  f.codigo_tipo_afip
    });

    rows.push({
      company_id: companyId,
      tipo,
      fecha: f.fecha_emision,
      razon_social,
      cuit,
      comprobante: f.comprobante ?? null,
      punto_venta: f.punto_venta ?? null,
      numero: f.numero ?? null,
      neto_gravado: neto,
      iva_21:   ivaBuckets.iva_21,
      iva_10_5: ivaBuckets.iva_10_5,
      iva_27:   ivaBuckets.iva_27,
      iva_otros: ivaBuckets.iva_otros,
      percepciones: otros,
      total,
      cae: f.cae ?? null,
      storage_path: storagePath,
      moneda,
      tipo_cambio,
      total_moneda_original: moneda !== "ARS" ? totalOrig : null,
      neto_moneda_original: moneda !== "ARS" ? netoOrig : null,
      iva_total_moneda_original: moneda !== "ARS" ? ivaOrig : null,
      ai_metadata: {
        from_arca_list: true,
        tipo_afip: f.codigo_tipo_afip,
        letra: f.letra,
        neto_no_gravado: f.neto_no_gravado,
        exento: f.exento,
        iva_total_listado: f.iva_total,
        otros_tributos: f.otros_tributos,
        list_confidence: data.confidence ?? null,
        alicuota_inferida: ivaBuckets.alicuota_inferida,
        inferencia_ok: ivaBuckets.match,
        moneda_original: moneda,
        tipo_cambio_aplicado: tipo_cambio
      } as any,
      ai_confidence: data.confidence ?? null,
      status: ivaBuckets.match ? "aprobada" : "revision",
      created_by: user.id
    });
  }

  if (!rows.length) {
    return NextResponse.json({
      ok: true,
      inserted: 0,
      skipped,
      warnings: ["Todas las facturas ya estaban cargadas previamente."]
    });
  }

  const { data: inserted, error: insErr } = await admin.from("invoices").insert(rows).select();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    inserted: inserted?.length ?? 0,
    skipped,
    warnings: [...(data.warnings ?? []), ...monedaWarnings],
    cuit_titular: data.cuit_titular,
    tipo_listado: data.tipo_listado
  });
}

function formatCuit(c: string | null | undefined) {
  if (!c) return null;
  const d = onlyDigits(c);
  if (d.length !== 11) return d || null;
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}

/**
 * Infiere la alícuota de IVA de un renglón del listado ARCA a partir de
 * neto_gravado y iva_total. Devuelve los buckets por alícuota.
 *
 * Reglas:
 *  - Factura C (tipo 11/12/13) → sin IVA discriminado: todo queda en 0.
 *  - Si neto_gravado = 0 o iva_total = 0 → sin IVA.
 *  - Calcula ratio = iva_total / neto_gravado.
 *  - Compara contra alícuotas conocidas con tolerancia ±0.3% absoluto.
 *  - Si hay match → asigna todo el iva_total al bucket correspondiente (21 / 10.5 / 27 / 5 / 2.5).
 *  - Si no hay match (ej factura con múltiples alícuotas) → va a iva_otros.
 */
function inferIvaBuckets({
  neto_gravado, iva_total, letra, codigo_afip
}: { neto_gravado: number; iva_total: number; letra: string | null; codigo_afip: number | null }) {
  const zero = { iva_21: 0, iva_10_5: 0, iva_27: 0, iva_otros: 0, alicuota_inferida: null as number | null, match: false };

  // Factura C → sin IVA por definición
  if (letra === "C" || codigo_afip === 11 || codigo_afip === 12 || codigo_afip === 13) {
    return { ...zero, match: true };
  }

  const iva = Number(iva_total) || 0;
  const neto = Number(neto_gravado) || 0;

  if (iva === 0 || neto === 0) return { ...zero, match: true };

  const ratio = iva / neto;

  const alicuotas = [
    { pct: 0.21,  key: "iva_21"   as const, label: 21   },
    { pct: 0.105, key: "iva_10_5" as const, label: 10.5 },
    { pct: 0.27,  key: "iva_27"   as const, label: 27   },
    { pct: 0.05,  key: "iva_otros" as const, label: 5   },
    { pct: 0.025, key: "iva_otros" as const, label: 2.5 }
  ];

  // Tolerancia de 0.003 (0.3 pp) — cubre redondeos típicos.
  const match = alicuotas.find(a => Math.abs(ratio - a.pct) < 0.003);

  if (match) {
    const buckets = { iva_21: 0, iva_10_5: 0, iva_27: 0, iva_otros: 0 };
    buckets[match.key] = iva;
    return { ...buckets, alicuota_inferida: match.label, match: true };
  }

  // Sin match claro → ponemos todo en iva_otros para no perder el importe
  return {
    iva_21: 0, iva_10_5: 0, iva_27: 0,
    iva_otros: iva,
    alicuota_inferida: null,
    match: false
  };
}
