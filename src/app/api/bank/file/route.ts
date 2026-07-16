import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";

export const runtime = "nodejs";

/**
 * GET /api/bank/file?id=<statement_id>
 * GET /api/bank/file?path=<storage_path>
 * GET /api/bank/file?path=<storage_path>&download=1  → forzar attachment
 *
 * Devuelve una signed URL (10 min) al PDF/CSV/Excel del extracto bancario.
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
    if (!path.startsWith(`${companyId}/`)) {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }
    storagePath = path;
    const { data: st } = await admin
      .from("bank_statements")
      .select("original_filename")
      .eq("company_id", companyId)
      .eq("storage_path", path)
      .not("original_filename", "is", null)
      .limit(1)
      .maybeSingle();
    originalFilename = st?.original_filename ?? null;
  } else if (id) {
    const { data: st } = await admin
      .from("bank_statements")
      .select("id, company_id, storage_path, original_filename")
      .eq("id", id)
      .maybeSingle();
    if (!st) return NextResponse.json({ error: "Extracto no encontrado" }, { status: 404 });
    if (st.company_id !== companyId) return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    storagePath = st.storage_path;
    originalFilename = st.original_filename ?? null;
  } else {
    return NextResponse.json({ error: "Falta id o path" }, { status: 400 });
  }

  if (!storagePath) return NextResponse.json({ error: "Sin archivo asociado" }, { status: 404 });

  const signOpts = download
    ? { download: originalFilename ?? storagePath.split("/").pop() ?? "archivo" }
    : undefined;

  const { data: signed, error } = await admin.storage
    .from("bank-statements")
    .createSignedUrl(storagePath, 600, signOpts);

  if (error || !signed?.signedUrl) return NextResponse.json({ error: error?.message ?? "Error" }, { status: 500 });

  return NextResponse.json({
    url: signed.signedUrl,
    path: storagePath,
    original_filename: originalFilename
  });
}
