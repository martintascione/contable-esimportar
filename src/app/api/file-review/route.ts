import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";

export const runtime = "nodejs";

/**
 * POST /api/file-review
 * Body: { storage_path, status?: "ok"|"con_observacion"|"con_error", note?: string }
 * Crea o actualiza la revisión de un archivo (upsert por storage_path).
 */
export async function POST(req: NextRequest) {
  const { user, companyId } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });

  const body = await req.json();
  const { storage_path, status, note } = body ?? {};
  if (!storage_path) return NextResponse.json({ error: "Falta storage_path" }, { status: 400 });
  if (!storage_path.startsWith(`${companyId}/`)) {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  const admin = createAdminClient();
  const cleanStatus = ["ok", "con_observacion", "con_error"].includes(status) ? status : "ok";

  const { data, error } = await admin
    .from("file_reviews")
    .upsert(
      {
        company_id: companyId,
        storage_path,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        status: cleanStatus,
        note: (note ?? "").trim() || null
      },
      { onConflict: "company_id,storage_path" }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, review: data });
}

/**
 * DELETE /api/file-review?storage_path=<path>
 * Marca el archivo como "no revisado" (borra el registro).
 */
export async function DELETE(req: NextRequest) {
  const { user, companyId } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });

  const storage_path = req.nextUrl.searchParams.get("storage_path");
  if (!storage_path) return NextResponse.json({ error: "Falta storage_path" }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("file_reviews")
    .delete()
    .eq("company_id", companyId)
    .eq("storage_path", storage_path);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
