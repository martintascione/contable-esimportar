import { NextResponse, type NextRequest } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { extractBankStatement } from "@/lib/ai/extract";
import { findCuitInText, onlyDigits, removeCuitFromText, looksLikeTransfer } from "@/lib/cuit";
import { getTcBulk, type Moneda } from "@/lib/bcra";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles").select("company_id, active_company_id").eq("id", user.id).single();
  const companyId = ((profile as any)?.active_company_id ?? profile?.company_id) as string | undefined;
  if (!companyId) return NextResponse.json({ error: "El usuario no tiene empresa activa" }, { status: 400 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const bancoHint = (form.get("banco") as string | null) ?? null;
  if (!file) return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });

  const ext = file.name.split(".").pop() ?? "pdf";
  const storagePath = `${companyId}/${new Date().toISOString().slice(0,7)}/${crypto.randomUUID()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const up = await supabase.storage.from("bank-statements").upload(storagePath, bytes, { contentType: file.type });
  if (up.error) return NextResponse.json({ error: "No se pudo subir el extracto: " + up.error.message }, { status: 500 });

  const base64 = Buffer.from(bytes).toString("base64");
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  let data;
  try {
    data = await extractBankStatement(
      isPdf ? { type: "pdf", base64 } : { type: "image", mediaType: (file.type || "image/png") as any, base64 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: "Error del motor de IA: " + e.message }, { status: 500 });
  }

  const banco = data.banco || bancoHint || "Banco desconocido";
  // La IA detecta la moneda del extracto (default ARS)
  const monedaExtracto: "ARS" | "USD" | "EUR" | "OTRA" =
    data.moneda === "USD" ? "USD" :
    data.moneda === "ARS" ? "ARS" :
    "ARS";

  const admin = createAdminClient();

  const { data: statement, error: stErr } = await supabase
    .from("bank_statements")
    .insert({
      company_id: companyId,
      banco,
      cuenta: data.cuenta,
      cbu: data.cbu,
      periodo_desde: data.periodo_desde,
      periodo_hasta: data.periodo_hasta,
      storage_path: storagePath,
      original_filename: file.name,
      moneda: monedaExtracto,
      ai_metadata: data as any,
      created_by: user.id
    })
    .select()
    .single();

  if (stErr) return NextResponse.json({ error: stErr.message }, { status: 500 });

  // Si el extracto es USD/EUR, buscamos TC del BCRA para todas las fechas de una
  // (una sola consulta cubre todo el rango). Los movs quedan con TC de referencia.
  let tcMap = new Map<string, number>();
  if (monedaExtracto !== "ARS") {
    const fechas = (data.movimientos ?? []).map(m => m.fecha).filter(Boolean);
    try {
      tcMap = await getTcBulk(fechas, monedaExtracto as Moneda);
    } catch {
      // Si BCRA falla, dejamos los movs sin TC de referencia (se pueden setear después)
    }
  }

  // Matcheo contra facturas
  const { data: invoices } = await admin
    .from("invoices")
    .select("id, total, fecha, tipo")
    .eq("company_id", companyId);

  // Empresas "propias" del usuario — todas las empresas donde es miembro o dueño
  const propiaCuits = await getCuitsPropios(admin, user.id);

  const rows = (data.movimientos ?? []).map((m) => {
    const isImpuesto = ["impuesto_ley_25413","comision","sircreb","retencion_iva","retencion_ganancias"].includes(m.categoria);

    // Enriquecer contraparte: IA > regex fallback
    let cuitContraparte = m.cuit_contraparte ? onlyDigits(m.cuit_contraparte) : null;
    if (!cuitContraparte) cuitContraparte = findCuitInText(`${m.descripcion} ${m.referencia ?? ""}`);
    if (cuitContraparte && cuitContraparte.length !== 11) cuitContraparte = null;

    let nombreContraparte = m.nombre_contraparte?.trim() || null;
    if (!nombreContraparte && cuitContraparte) {
      nombreContraparte = removeCuitFromText(m.descripcion, cuitContraparte).slice(0, 180) || null;
    }

    const esTransferencia = Boolean(m.es_transferencia ?? looksLikeTransfer(m.descripcion));
    const esPropia = Boolean(cuitContraparte && propiaCuits.has(cuitContraparte));

    // Matcheo con facturas (solo para no-impuesto y no-propia)
    let invoiceId: string | null = null;
    if (!isImpuesto && !esPropia && invoices?.length) {
      const tipoFactura = m.tipo === "ingreso" ? "venta" : "compra";
      const match = invoices.find((f: any) =>
        f.tipo === tipoFactura &&
        Math.abs(Number(f.total) - Number(m.monto)) / Math.max(1, Number(m.monto)) < 0.02 &&
        Math.abs(new Date(f.fecha).getTime() - new Date(m.fecha).getTime()) < 1000*60*60*24*10
      );
      if (match) invoiceId = match.id;
    }

    // TC de referencia: solo para movs de moneda != ARS
    const tcRef = monedaExtracto !== "ARS" ? (tcMap.get(m.fecha) ?? null) : null;

    return {
      company_id: companyId,
      statement_id: statement.id,
      fecha: m.fecha,
      descripcion: m.descripcion,
      tipo: m.tipo,
      monto: m.monto,
      referencia: m.referencia,
      estado: isImpuesto ? "impuesto" : invoiceId ? "conciliado" : "pendiente",
      invoice_id: invoiceId,
      cuit_contraparte: cuitContraparte,
      nombre_contraparte: nombreContraparte,
      es_transferencia: esTransferencia,
      es_cuenta_propia: esPropia,
      categoria_detalle: (m as any).categoria_detalle ?? m.categoria ?? null,
      jurisdiccion: (m as any).jurisdiccion ?? null,
      alicuota: (m as any).alicuota ?? null,
      moneda: monedaExtracto,
      tipo_cambio_referencia: tcRef,
      tipo_cambio_referencia_fuente: tcRef !== null ? "bcra" : null
    };
  });

  if (rows.length) {
    const { error: insErr } = await admin.from("bank_movements").insert(rows as any);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  const warnings: string[] = [];
  if (data.moneda == null && (data.movimientos ?? []).length > 0) {
    warnings.push(
      "La IA no pudo determinar la moneda del extracto — se asumió ARS. " +
      "Si es una cuenta USD, cambiala manualmente desde el modal de extractos originales."
    );
  }
  if (monedaExtracto !== "ARS" && tcMap.size === 0 && rows.length > 0) {
    warnings.push(
      `Extracto en ${monedaExtracto}: no se pudo obtener ningún TC del BCRA. ` +
      "Los movimientos quedaron sin TC de referencia. Podés reintentar desde el modal de extractos originales."
    );
  }

  return NextResponse.json({ ok: true, statement, count: rows.length, warnings });
}

/**
 * Devuelve un Set de CUITs (11 dígitos) que pertenecen al mismo usuario:
 *   - empresas donde es miembro (company_members)
 *   - o donde es owner_id (retro-compat)
 */
async function getCuitsPropios(admin: any, userId: string): Promise<Set<string>> {
  const set = new Set<string>();
  // Miembro
  const { data: mem } = await admin
    .from("company_members")
    .select("companies:companies(cuit)")
    .eq("user_id", userId);
  (mem ?? []).forEach((r: any) => {
    const c = onlyDigits(r.companies?.cuit);
    if (c.length === 11) set.add(c);
  });
  // Owner
  const { data: owned } = await admin.from("companies").select("cuit").eq("owner_id", userId);
  (owned ?? []).forEach((r: any) => {
    const c = onlyDigits(r.cuit);
    if (c.length === 11) set.add(c);
  });
  return set;
}
