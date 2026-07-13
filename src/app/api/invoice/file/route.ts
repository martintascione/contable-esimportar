import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";

export const runtime = "nodejs";

/**
 * GET /api/invoice/file?id=<invoice_id>  ← flujo viejo (detalle de una factura)
 * GET /api/invoice/file?path=<storage_path>  ← flujo nuevo (para modal de archivos)
 *
 * Devuelve una signed URL (10 min) del PDF/imagen/Excel original.
 * Valida que el usuario sea miembro de la empresa dueña del archivo.
 */
export async function GET(req: NextRequest) {
  const { user, companyId } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });

  const id = req.nextUrl.searchParams.get("id");
  const path = req.nextUrl.searchParams.get("path");
  const download = req.nextUrl.searchParams.get("download") === "1";

  const admin = createAdminClient();
  let storagePath: string | null = null;
  let originalFilename: string | null = null;

  if (path) {
    // Validamos que el path pertenezca a la empresa activa (los paths empiezan por companyId/)
    if (!path.startsWith(`${companyId}/`)) {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }
    storagePath = path;
    // Buscamos si alguna factura tiene el nombre original
    const { data: inv } = await admin
      .from("invoices")
      .select("original_filename")
      .eq("company_id", companyId)
      .eq("storage_path", path)
      .not("original_filename", "is", null)
      .limit(1)
      .maybeSingle();
    originalFilename = inv?.original_filename ?? null;
  } else if (id) {
    const { data: inv } = await admin
      .from("invoices")
      .select("id, company_id, storage_path, original_filename")
      .eq("id", id)
      .maybeSingle();
    if (!inv) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
    if (inv.company_id !== companyId) return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    storagePath = inv.storage_path;
    originalFilename = inv.original_filename ?? null;
  } else {
    return NextResponse.json({ error: "Falta id o path" }, { status: 400 });
  }

  if (!storagePath) return NextResponse.json({ error: "Sin archivo asociado" }, { status: 404 });

  // 10 min de vida para dar tiempo al contador a abrir archivos grandes.
  const signOpts = download
    ? { download: originalFilename ?? storagePath.split("/").pop() ?? "archivo" }
    : undefined;

  const { data: signed, error } = await admin.storage
    .from("invoices")
    .createSignedUrl(storagePath, 600, signOpts);

  if (error || !signed?.signedUrl) return NextResponse.json({ error: error?.message ?? "Error" }, { status: 500 });

  return NextResponse.json({
    url: signed.signedUrl,
    path: storagePath,
    original_filename: originalFilename
  });
}
