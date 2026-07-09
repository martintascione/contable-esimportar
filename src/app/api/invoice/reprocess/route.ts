import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";
import { extractInvoice } from "@/lib/ai/extract";

export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * POST /api/invoice/reprocess
 * Body: { id, model? }
 *
 * Re-procesa una factura con la IA (por defecto Opus para máxima precisión).
 * Útil cuando una factura quedó en "revisión" por baja confianza.
 */
export async function POST(req: NextRequest) {
  const { user, companyId } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const id = body.id;
  // Tier opcional: "fast" | "precise" | "premium". Default "precise" en reprocess.
  const tier = (body.tier === "fast" || body.tier === "precise" || body.tier === "premium") ? body.tier : "precise";
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });

  const admin = createAdminClient();
  const { data: inv } = await admin
    .from("invoices").select("*").eq("id", id).maybeSingle();
  if (!inv) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  if (inv.company_id !== companyId) return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  if (!inv.storage_path) return NextResponse.json({ error: "Esta factura no tiene archivo" }, { status: 400 });

  // Bajar el archivo desde Storage
  const { data: file, error: dlErr } = await admin.storage.from("invoices").download(inv.storage_path);
  if (dlErr || !file) return NextResponse.json({ error: "No se pudo leer el archivo: " + (dlErr?.message ?? "") }, { status: 500 });

  const buf = Buffer.from(await file.arrayBuffer());
  const base64 = buf.toString("base64");
  const isPdf = inv.storage_path.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";

  let data;
  try {
    data = await extractInvoice(
      isPdf
        ? { type: "pdf", base64 }
        : { type: "image", mediaType: (file.type || "image/png") as any, base64 },
      tier
    );
  } catch (e: any) {
    return NextResponse.json({ error: "IA: " + e.message }, { status: 500 });
  }

  const updates = {
    neto_gravado: data.neto_gravado ?? inv.neto_gravado,
    iva_21: data.iva_21 ?? inv.iva_21,
    iva_10_5: data.iva_10_5 ?? inv.iva_10_5,
    iva_27: data.iva_27 ?? inv.iva_27,
    iva_otros: (data.iva_otros ?? 0) + (data.iva_5 ?? 0) + (data.iva_2_5 ?? 0),
    percepciones:
      (data.percepciones_total ?? data.percepciones ?? 0) +
      (data.impuestos_internos_total ?? 0) +
      (data.otros_impuestos_total ?? 0),
    total: data.total ?? inv.total,
    razon_social: (inv.tipo === "venta" ? data.receptor?.razon_social : data.emisor?.razon_social) ?? inv.razon_social,
    cuit: (inv.tipo === "venta" ? data.receptor?.cuit : data.emisor?.cuit) ?? inv.cuit,
    fecha: data.fecha_emision ?? inv.fecha,
    comprobante: data.comprobante ?? inv.comprobante,
    cae: data.cae ?? inv.cae,
    ai_metadata: data as any,
    ai_confidence: data.confidence ?? inv.ai_confidence,
    status: (data.confidence ?? 0) >= 0.85 ? "aprobada" : "revision"
  };

  const { data: updated, error } = await admin
    .from("invoices").update(updates).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, invoice: updated, confidence: data.confidence });
}
