import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";
import { onlyDigits } from "@/lib/cuit";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/ingest/arca-csv
 * Form-data: file (Excel/CSV bajado de "Mis Comprobantes" de ARCA)
 *
 * Procesa el archivo SIN llamar a la IA. Costo: cero.
 * Detecta el formato de ARCA y crea una factura por fila.
 * Infiere alícuota IVA por ratio iva/neto para clasificar sin ambigüedades.
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

  const bytes = new Uint8Array(await file.arrayBuffer());
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: "array", cellDates: true });
  } catch (e: any) {
    return NextResponse.json({ error: "No se pudo leer el archivo: " + e.message }, { status: 400 });
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any>(sheet, { defval: null, raw: false });
  if (!rows.length) return NextResponse.json({ error: "Archivo vacío" }, { status: 400 });

  // Detectar nombres de columnas del formato ARCA (varían según export)
  const first = rows[0];
  const colFecha    = pickCol(first, ["Fecha", "Fecha de Emisión", "Fecha Emisión", "Fecha Comprobante"]);
  const colTipo     = pickCol(first, ["Tipo", "Tipo de Comprobante", "Tipo Comprobante"]);
  const colPV       = pickCol(first, ["Punto de Venta", "Pto. Vta.", "Punto Venta", "PtoVta"]);
  const colNumero   = pickCol(first, ["Número Desde", "Número", "Nro Comprobante", "Comprobante", "Numero"]);
  const colCae      = pickCol(first, ["Cód. Autorización", "CAE", "Codigo Autorizacion", "Cod Autorizacion"]);
  const colCuit     = pickCol(first, ["Nro. Doc. Emisor", "CUIT Emisor", "CUIT", "Nro Doc", "Nro Doc Emisor"]);
  const colRazon    = pickCol(first, ["Denominación Emisor", "Denominacion Emisor", "Razón Social", "Razon Social", "Emisor"]);
  const colNeto     = pickCol(first, ["Imp. Neto Gravado", "Neto Gravado", "Neto", "Imp Neto Gravado"]);
  const colOtrosTr  = pickCol(first, ["Otros Tributos", "Otros"]);
  const colIVA      = pickCol(first, ["IVA", "Total IVA", "Imp IVA"]);
  const colTotal    = pickCol(first, ["Imp. Total", "Total", "Importe Total", "Imp Total"]);
  const colMoneda   = pickCol(first, ["Moneda", "Cod Moneda", "Código Moneda"]);
  const colTC       = pickCol(first, ["Tipo Cambio", "Tipo de Cambio", "TC", "Cotizacion", "Cotización"]);

  if (!colFecha || !colCuit || !colTotal) {
    return NextResponse.json({
      error: "No se detectó formato ARCA válido. Columnas encontradas: " + Object.keys(first).join(", ")
    }, { status: 400 });
  }

  // Buscar duplicados existentes
  const { data: existentes } = await admin
    .from("invoices").select("id, fecha, cuit, comprobante, total").eq("company_id", companyId);
  const existKey = (c: string | null, fecha: string, cuit: string | null, total: number) =>
    `${c ?? ""}|${fecha}|${onlyDigits(cuit ?? "")}|${Math.round(total * 100)}`;
  const existSet = new Set((existentes ?? []).map((e: any) =>
    existKey(e.comprobante, e.fecha, e.cuit, Number(e.total))
  ));

  const insertRows: any[] = [];
  const skipped: any[] = [];
  const errors: string[] = [];

  for (const [i, row] of rows.entries()) {
    try {
      const fecha = parseFecha(row[colFecha!]);
      if (!fecha) { errors.push(`Fila ${i + 2}: fecha inválida`); continue; }

      const cuitEmisor = onlyDigits(String(row[colCuit!] ?? ""));
      if (cuitEmisor.length !== 11) { errors.push(`Fila ${i + 2}: CUIT inválido "${row[colCuit!]}"`); continue; }

      const tipoStr = String(row[colTipo!] ?? "").trim();
      const { letra, codigo } = parseTipoAfip(tipoStr);
      const tipoComp = mapTipoComprobante(codigo);

      const pv = String(row[colPV!] ?? "").padStart(5, "0").slice(-5);
      const nro = String(row[colNumero!] ?? "").padStart(8, "0").slice(-8);
      const comprobante = pv && nro ? `${tipoComp} ${pv}-${nro}` : null;

      // Detección de moneda y tipo de cambio
      const monedaRaw = colMoneda ? String(row[colMoneda] ?? "").trim().toUpperCase() : "";
      const moneda = normalizeMoneda(monedaRaw);        // "ARS" | "USD" | "EUR" | "OTRA"
      const tcRaw = colTC ? parseNumero(row[colTC]) : 0;
      // TC efectivo: si es ARS, siempre 1. Si es otra moneda, usar TC del archivo o warning.
      const tipo_cambio = moneda === "ARS" ? 1 : (tcRaw > 0 ? tcRaw : 1);

      // Importes en la moneda original (tal cual del archivo)
      const netoOrig  = parseNumero(row[colNeto!]);
      const ivaOrig   = parseNumero(row[colIVA!]);
      const otrosOrig = parseNumero(row[colOtrosTr!]);
      const totalOrig = parseNumero(row[colTotal!]);

      // Importes convertidos a ARS (para guardar en columnas principales)
      const neto  = round2(netoOrig * tipo_cambio);
      const iva   = round2(ivaOrig * tipo_cambio);
      const otros = round2(otrosOrig * tipo_cambio);
      const total = round2(totalOrig * tipo_cambio);

      // Warning si moneda != ARS pero no vino TC → guardamos igual pero avisamos
      if (moneda !== "ARS" && tcRaw <= 0) {
        errors.push(`Fila ${i + 2}: factura en ${moneda} sin tipo de cambio. Se guardó sin conversión (valores en ${moneda} tratados como ARS). Editá manualmente el TC.`);
      }

      const key = existKey(comprobante, fecha, cuitEmisor, total);
      if (existSet.has(key)) { skipped.push({ comprobante, cuit: cuitEmisor, reason: "duplicado" }); continue; }

      // Venta o compra: si el CUIT emisor es de la empresa activa, es venta.
      const tipo: "venta" | "compra" =
        (cuitEmisor && cuitEmpresa && cuitEmisor === cuitEmpresa) ? "venta" : "compra";

      const ivaBuckets = inferIvaBuckets({ neto, iva, letra });

      insertRows.push({
        company_id: companyId,
        tipo,
        fecha,
        razon_social: String(row[colRazon!] ?? "").trim() || "Sin identificar",
        cuit: formatCuit(cuitEmisor),
        comprobante,
        punto_venta: pv,
        numero: nro,
        neto_gravado: neto,
        iva_21:   ivaBuckets.iva_21,
        iva_10_5: ivaBuckets.iva_10_5,
        iva_27:   ivaBuckets.iva_27,
        iva_otros: ivaBuckets.iva_otros,
        percepciones: otros,
        total,
        cae: row[colCae!] ? String(row[colCae!]).trim() : null,
        storage_path: null,
        moneda,
        tipo_cambio,
        total_moneda_original: moneda !== "ARS" ? totalOrig : null,
        neto_moneda_original: moneda !== "ARS" ? netoOrig : null,
        iva_total_moneda_original: moneda !== "ARS" ? ivaOrig : null,
        ai_metadata: {
          from_arca_csv: true,
          letra,
          codigo_afip: codigo,
          alicuota_inferida: ivaBuckets.alicuota_inferida,
          moneda_original: moneda,
          tipo_cambio_aplicado: tipo_cambio
        } as any,
        ai_confidence: 1.0,
        status: ivaBuckets.match ? "aprobada" : "revision",
        created_by: user.id
      });
    } catch (e: any) {
      errors.push(`Fila ${i + 2}: ${e.message}`);
    }
  }

  if (!insertRows.length) {
    return NextResponse.json({
      ok: true,
      inserted: 0,
      skipped,
      errors,
      warnings: skipped.length ? ["Todas las facturas ya estaban cargadas."] : ["No se pudo procesar ninguna fila."]
    });
  }

  const { data: inserted, error: insErr } = await admin.from("invoices").insert(insertRows).select();
  if (insErr) return NextResponse.json({ error: insErr.message, errors }, { status: 500 });

  return NextResponse.json({
    ok: true,
    inserted: inserted?.length ?? 0,
    skipped,
    errors,
    format: "csv-excel"
  });
}

// ─── Helpers ────────────────────────────────────────────

function pickCol(row: any, candidates: string[]): string | null {
  const keys = Object.keys(row);
  const norm = (s: string) => s.toLowerCase().replace(/[.\s_-]/g, "");
  for (const cand of candidates) {
    const found = keys.find(k => norm(k) === norm(cand));
    if (found) return found;
  }
  return null;
}

function parseFecha(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m1) return `${m1[3]}-${m1[2].padStart(2, "0")}-${m1[1].padStart(2, "0")}`;
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return null;
}

function parseNumero(v: any): number {
  if (v == null || v === "") return 0;
  const s = String(v).trim().replace(/\$|\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function parseTipoAfip(s: string): { letra: string | null; codigo: number | null } {
  const m = s.match(/^(\d+)/);
  const codigo = m ? parseInt(m[1], 10) : null;
  const upper = s.toUpperCase();
  let letra: string | null = null;
  if (/\bA\b/.test(upper) || upper.endsWith(" A") || upper.endsWith("-A")) letra = "A";
  else if (/\bB\b/.test(upper) || upper.endsWith(" B") || upper.endsWith("-B")) letra = "B";
  else if (/\bC\b/.test(upper) || upper.endsWith(" C") || upper.endsWith("-C")) letra = "C";
  else if (/\bE\b/.test(upper) || upper.endsWith(" E") || upper.endsWith("-E")) letra = "E";
  return { letra, codigo };
}

function mapTipoComprobante(codigo: number | null): string {
  if (codigo == null) return "OTRO";
  if ([1, 6, 11, 19].includes(codigo)) return "FA";
  if ([2, 7, 12, 20].includes(codigo)) return "ND";
  if ([3, 8, 13, 21].includes(codigo)) return "NC";
  return "OTRO";
}

function formatCuit(c: string): string | null {
  if (!c || c.length !== 11) return null;
  return `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`;
}

/**
 * Normaliza el string de moneda al código ISO estándar.
 * ARCA suele mandar "PES" (pesos argentinos) o códigos numéricos.
 */
function normalizeMoneda(s: string): "ARS" | "USD" | "EUR" | "OTRA" {
  if (!s) return "ARS";
  const u = s.toUpperCase().trim();
  // Códigos comunes de ARCA
  if (["PES", "PESO", "PESOS", "ARS", "$", "AR$", "PE$", "01"].includes(u)) return "ARS";
  if (["USD", "DOLAR", "DÓLAR", "DOLARES", "DÓLARES", "U$S", "US$", "US", "DOL", "02"].includes(u)) return "USD";
  if (["EUR", "EURO", "EUROS", "€", "03"].includes(u)) return "EUR";
  // Si empieza con PES o AR
  if (u.startsWith("PES") || u.startsWith("AR")) return "ARS";
  if (u.startsWith("USD") || u.startsWith("DOL") || u.startsWith("US$") || u.startsWith("U$S")) return "USD";
  return "OTRA";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function inferIvaBuckets({ neto, iva, letra }: { neto: number; iva: number; letra: string | null }) {
  const zero = { iva_21: 0, iva_10_5: 0, iva_27: 0, iva_otros: 0, alicuota_inferida: null as number | null, match: false };
  if (letra === "C") return { ...zero, match: true };
  if (iva === 0 || neto === 0) return { ...zero, match: true };
  const ratio = iva / neto;
  const alicuotas = [
    { pct: 0.21,  key: "iva_21"   as const, label: 21   },
    { pct: 0.105, key: "iva_10_5" as const, label: 10.5 },
    { pct: 0.27,  key: "iva_27"   as const, label: 27   },
    { pct: 0.05,  key: "iva_otros" as const, label: 5   },
    { pct: 0.025, key: "iva_otros" as const, label: 2.5 }
  ];
  const match = alicuotas.find(a => Math.abs(ratio - a.pct) < 0.003);
  if (match) {
    const buckets = { iva_21: 0, iva_10_5: 0, iva_27: 0, iva_otros: 0 };
    buckets[match.key] = iva;
    return { ...buckets, alicuota_inferida: match.label, match: true };
  }
  return { iva_21: 0, iva_10_5: 0, iva_27: 0, iva_otros: iva, alicuota_inferida: null, match: false };
}
