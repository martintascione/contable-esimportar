import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";

export const runtime = "nodejs";

/**
 * POST /api/accounting/accounts/delete
 * Body: { id }
 *
 * Borra una cuenta si no tiene movimientos. Si tiene, la marca inactive.
 */
export async function POST(req: NextRequest) {
  const { user, companyId, role } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });
  if (role !== "admin") return NextResponse.json({ error: "Solo admin" }, { status: 403 });

  const { id } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });

  const admin = createAdminClient();

  // ¿Tiene movimientos?
  const { count } = await admin
    .from("journal_entry_lines")
    .select("id", { count: "exact", head: true })
    .eq("account_id", id);

  if ((count ?? 0) > 0) {
    // Soft delete — la cuenta sigue existiendo pero no aparece en listados
    const { error } = await admin.from("accounts").update({ active: false }).eq("id", id).eq("company_id", companyId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, soft: true, message: "Cuenta archivada (tiene movimientos asociados)" });
  }

  const { error } = await admin.from("accounts").delete().eq("id", id).eq("company_id", companyId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, soft: false });
}
