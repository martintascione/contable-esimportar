import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";

export const runtime = "nodejs";

/**
 * POST /api/invoice/update
 * Body: { id, fields: { razon_social?, cuit?, fecha?, tipo?, comprobante?, neto_gravado?, iva_21?, iva_10_5?, iva_27?, iva_otros?, percepciones?, total?, status? } }
 *
 * Edita una factura manualmente. Marca manual_edited=true en ai_metadata para distinguir de extracción pura.
 */
export async function POST(req: NextRequest) {
  const { user, companyId } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  const fields = body.fields ?? {};
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });

  const admin = createAdminClient();
  const { data: current } = await admin
    .from("invoices")
    .select("id, company_id, ai_metadata, status")
    .eq("id", id)
    .maybeSingle();
  if (!current) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  if (current.company_id !== companyId) return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });

  const allowed = [
    "razon_social", "cuit", "fecha", "tipo", "comprobante", "punto_venta", "numero",
    "neto_gravado", "iva_21", "iva_10_5", "iva_27", "iva_otros",
    "percepciones", "total", "status", "cae",
    "moneda", "tipo_cambio",
    "total_moneda_original", "neto_moneda_original", "iva_total_moneda_original"
  ];
  const updates: any = {};
  for (const k of allowed) {
    if (fields[k] !== undefined) updates[k] = fields[k];
  }

  // Marcar como editada manualmente en ai_metadata
  const prevMeta = (current.ai_metadata as any) || {};
  updates.ai_metadata = {
    ...prevMeta,
    manual_edited: true,
    manual_edited_at: new Date().toISOString(),
    manual_edited_by: user.id
  };

  // Si el usuario aprueba manualmente, pasar a "aprobada"
  if (fields.status === undefined && current.status === "revision") {
    updates.status = "aprobada";
  }

  const { data: updated, error } = await admin
    .from("invoices").update(updates).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, invoice: updated });
}
