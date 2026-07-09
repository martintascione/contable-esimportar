import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractInvoice } from "@/lib/ai/extract";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles").select("company_id, active_company_id").eq("id", user.id).single();
  const companyId = ((profile as any)?.active_company_id ?? profile?.company_id) as string | undefined;
  if (!companyId) return NextResponse.json({ error: "El usuario no tiene empresa activa" }, { status: 400 });
  const { data: compRow } = await supabase.from("companies").select("cuit").eq("id", companyId).maybeSingle();
  const companyCuit = compRow?.cuit as string | undefined;

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });

  // 1) Subir a Storage
  const ext = file.name.split(".").pop() ?? "pdf";
  const storagePath = `${companyId}/${new Date().toISOString().slice(0,7)}/${crypto.randomUUID()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const up = await supabase.storage.from("invoices").upload(storagePath, bytes, { contentType: file.type, upsert: false });
  if (up.error) return NextResponse.json({ error: "No se pudo subir el archivo: " + up.error.message }, { status: 500 });

  // 2) Extraer con Claude
  const base64 = Buffer.from(bytes).toString("base64");
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  let data;
  try {
    data = await extractInvoice(
      isPdf
        ? { type: "pdf", base64 }
        : { type: "image", mediaType: (file.type || "image/png") as any, base64 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: "Error del motor de IA: " + e.message }, { status: 500 });
  }

  // 3) Clasificar venta vs compra según CUIT del emisor vs empresa
  const cuitEmisor = normalizeCuit(data.emisor?.cuit);
  const cuitEmpresa = normalizeCuit(companyCuit);
  const tipo: "venta" | "compra" = cuitEmisor && cuitEmpresa && cuitEmisor === cuitEmpresa ? "venta" : "compra";
  const contraparte = tipo === "venta" ? data.receptor : data.emisor;

  // 4) Insertar en invoices
  const { data: inserted, error: insErr } = await supabase
    .from("invoices")
    .insert({
      company_id: companyId,
      tipo,
      fecha: data.fecha_emision ?? new Date().toISOString().slice(0,10),
      razon_social: contraparte?.razon_social ?? "Sin identificar",
      cuit: contraparte?.cuit ?? null,
      comprobante: data.comprobante ?? (data.punto_venta && data.numero ? `${data.tipo_comprobante} ${data.punto_venta}-${data.numero}` : null),
      punto_venta: data.punto_venta,
      numero: data.numero,
      ...(function() {
        // Moneda y TC
        const moneda = (data.moneda === "USD" || data.moneda === "EUR" || data.moneda === "OTRA") ? data.moneda : "ARS";
        const tcRaw = Number(data.tipo_cambio ?? 0);
        const tipo_cambio = moneda === "ARS" ? 1 : (tcRaw > 0 ? tcRaw : 1);
        const netoOrig  = Number(data.neto_gravado ?? 0);
        const ivaOtrosOrig = Number(data.iva_otros ?? 0) + Number(data.iva_5 ?? 0) + Number(data.iva_2_5 ?? 0);
        const iva21Orig = Number(data.iva_21 ?? 0);
        const iva105Orig = Number(data.iva_10_5 ?? 0);
        const iva27Orig = Number(data.iva_27 ?? 0);
        const percOrig = Number(data.percepciones_total ?? data.percepciones ?? 0) + Number(data.impuestos_internos_total ?? 0) + Number(data.otros_impuestos_total ?? 0);
        const totalOrig = Number(data.total ?? 0);
        const ivaTotalOrig = iva21Orig + iva105Orig + iva27Orig + ivaOtrosOrig;
        const conv = (n: number) => Math.round(n * tipo_cambio * 100) / 100;
        return {
          neto_gravado: conv(netoOrig),
          iva_21: conv(iva21Orig),
          iva_10_5: conv(iva105Orig),
          iva_27: conv(iva27Orig),
          iva_otros: conv(ivaOtrosOrig),
          percepciones: conv(percOrig),
          total: conv(totalOrig),
          moneda,
          tipo_cambio,
          total_moneda_original: moneda !== "ARS" ? totalOrig : null,
          neto_moneda_original: moneda !== "ARS" ? netoOrig : null,
          iva_total_moneda_original: moneda !== "ARS" ? ivaTotalOrig : null
        };
      })(),
      cae: data.cae,
      storage_path: storagePath,
      ai_metadata: data as any,
      ai_confidence: data.confidence ?? null,
      status: (data.confidence ?? 0) >= 0.85 ? "aprobada" : "revision",
      created_by: user.id
    })
    .select()
    .single();

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, invoice: inserted });
}

function normalizeCuit(c?: string | null) {
  if (!c) return null;
  return c.replace(/[^0-9]/g, "");
}
