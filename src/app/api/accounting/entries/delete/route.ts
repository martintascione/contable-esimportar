import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";

export const runtime = "nodejs";

/** POST /api/accounting/entries/delete  Body: { id } */
export async function POST(req: NextRequest) {
  const { user, companyId, role } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });
  if (role !== "admin") return NextResponse.json({ error: "Solo admin" }, { status: 403 });

  const { id } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });

  const admin = createAdminClient();
  const { data: entry } = await admin.from("journal_entries").select("id, company_id").eq("id", id).maybeSingle();
  if (!entry) return NextResponse.json({ error: "Asiento no encontrado" }, { status: 404 });
  if (entry.company_id !== companyId) return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });

  const { error } = await admin.from("journal_entries").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
