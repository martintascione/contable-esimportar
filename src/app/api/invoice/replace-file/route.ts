import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";
import { extractInvoice } from "@/lib/ai/extract";

export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * POST /api/invoice/replace-file
 * Form-data: id (invoice id), file (nuevo PDF/imagen)
 *
 * Reemplaza el archivo de una factura con un PDF individual (típicamente cuando la factura
 * vino de un listado ARCA y ahora el usuario quiere cargar el comprobante específico).
 * Sube el archivo, actualiza storage_path, y re-procesa con IA para llenar el detalle.
 */
export async function POST(req: NextRequest) {
  const { user, companyId } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });

  const form = await req.formData();
  const id = String(form.get("id") ?? "");
  const file = form.get("file") as File | null;
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
  if (!file) return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });

  const admin = createAdminClient();
  const { data: inv } = await admin
    .from("invoices").select("*").eq("id", id).maybeSingle();
  if (!inv) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  if (inv.company_id !== companyId) return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });

  // Subir el nuevo archivo (en carpeta individual, no bajo arca-list)
  const ext = file.name.split(".").pop() ?? "pdf";
  const storagePath = `${companyId}/${new Date().toISOString().slice(0,7)}/${crypto.randomUUID()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const up = await admin.storage.from("invoices").upload(storagePath, bytes, { contentType: file.type || "application/pdf" });
  if (up.error) return NextResponse.json({ error: "No se pudo subir el archivo: " + up.error.message }, { status: 500 });

  // Extraer con IA usando el prompt de factura individual
  const base64 = Buffer.from(bytes).toString("base64");
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  let data;
  try {
    data = await extractInvoice(
      isPdf ? { type: "pdf", base64 } : { type: "image", mediaType: (file.type || "image/png") as any, base64 }
    );
  } catch (e: any) {
    // Subimos el archivo aunque falle la IA — el usuario puede editar a mano.
    await admin.from("invoices").update({
      storage_path: storagePath,
      ai_metadata: { ...((inv.ai_metadata as any) || {}), file_replaced: true, ai_error: e.message }
    }).eq("id", id);
    return NextResponse.json({
      ok: true,
      warning: "Archivo reemplazado pero la IA no pudo leerlo: " + e.message + ". Podés editar los valores a mano.",
      invoice: null
    });
  }

  const updates = {
    neto_gravado: data.neto_gravado ?? inv.neto_gravado,
    iva_21:   data.iva_21 ?? 0,
    iva_10_5: data.iva_10_5 ?? 0,
    iva_27:   data.iva_27 ?? 0,
    iva_otros: (data.iva_otros ?? 0) + (data.iva_5 ?? 0) + (data.iva_2_5 ?? 0),
    percepciones:
      (data.percepciones_total ?? (data as any).percepciones ?? 0) +
      (data.impuestos_internos_total ?? 0) +
      (data.otros_impuestos_total ?? 0),
    total: data.total ?? inv.total,
    razon_social: (inv.tipo === "venta" ? data.receptor?.razon_social : data.emisor?.razon_social) ?? inv.razon_social,
    cuit: (inv.tipo === "venta" ? data.receptor?.cuit : data.emisor?.cuit) ?? inv.cuit,
    fecha: data.fecha_emision ?? inv.fecha,
    comprobante: data.comprobante ?? inv.comprobante,
    cae: data.cae ?? inv.cae,
    storage_path: storagePath,
    ai_metadata: {
      ...data,
      file_replaced_at: new Date().toISOString(),
      replaced_from_arca_list: (inv.ai_metadata as any)?.from_arca_list === true
    } as any,
    ai_confidence: data.confidence ?? inv.ai_confidence,
    status: (data.confidence ?? 0) >= 0.85 ? "aprobada" : "revision"
  };

  const { data: updated, error } = await admin
    .from("invoices").update(updates).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, invoice: updated, confidence: data.confidence });
}
