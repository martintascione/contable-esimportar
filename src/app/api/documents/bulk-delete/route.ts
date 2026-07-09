import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/documents/bulk-delete
 * Body: { filter: "all" | "today" | "last_week" }
 *
 * Elimina documentos de la empresa activa según un filtro de fecha (created_at).
 * Borra primero archivos en Storage y después las filas de la DB.
 * Solo admins.
 */
export async function POST(req: NextRequest) {
  const { user, companyId, role } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });
  if (role !== "admin") return NextResponse.json({ error: "Solo admin puede eliminar documentos" }, { status: 403 });

  const { filter } = await req.json().catch(() => ({}));
  if (!["all", "today", "last_week"].includes(filter)) {
    return NextResponse.json({ error: "Filtro inválido" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Calcular el rango de fecha según el filtro
  let sinceISO: string | null = null;
  if (filter === "today") {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    sinceISO = d.toISOString();
  } else if (filter === "last_week") {
    const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0);
    sinceISO = d.toISOString();
  }

  // Buscar los documentos que match al filtro
  let q = admin
    .from("company_documents")
    .select("id, storage_path, created_at")
    .eq("company_id", companyId);
  if (sinceISO) q = q.gte("created_at", sinceISO);

  const { data: docs, error: selErr } = await q;
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });

  if (!docs?.length) {
    return NextResponse.json({ ok: true, deleted: 0, files_removed: 0 });
  }

  // 1) Borrar archivos del bucket
  const paths = docs.map(d => d.storage_path).filter(Boolean) as string[];
  let filesRemoved = 0;
  if (paths.length > 0) {
    // Remove en batches de 100 para no saturar
    for (let i = 0; i < paths.length; i += 100) {
      const batch = paths.slice(i, i + 100);
      const { error: rmErr } = await admin.storage.from("company-documents").remove(batch);
      if (!rmErr) filesRemoved += batch.length;
      else console.warn("[bulk-delete] storage remove warn:", rmErr.message);
    }
  }

  // 2) Borrar filas de la DB
  const ids = docs.map(d => d.id);
  const { error: delErr } = await admin
    .from("company_documents")
    .delete()
    .in("id", ids);
  if (delErr) return NextResponse.json({ error: "Storage borrado pero DB falló: " + delErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    deleted: docs.length,
    files_removed: filesRemoved,
    filter
  });
}
