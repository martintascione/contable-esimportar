import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";

export const runtime = "nodejs";

/**
 * GET /api/invoice/file?id=<invoice_id>
 * Devuelve una signed URL (60s) del PDF/imagen original de la factura.
 * El usuario debe ser miembro de la empresa dueña de la factura.
 */
export async function GET(req: NextRequest) {
  const { user, companyId } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });

  const admin = createAdminClient();
  const { data: inv } = await admin
    .from("invoices")
    .select("id, company_id, storage_path")
    .eq("id", id)
    .maybeSingle();

  if (!inv) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  if (inv.company_id !== companyId) return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  if (!inv.storage_path) return NextResponse.json({ error: "Sin archivo asociado" }, { status: 404 });

  const { data: signed, error } = await admin.storage.from("invoices").createSignedUrl(inv.storage_path, 60);
  if (error || !signed?.signedUrl) return NextResponse.json({ error: error?.message ?? "Error" }, { status: 500 });

  return NextResponse.json({ url: signed.signedUrl, path: inv.storage_path });
}
