import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/company/list
 * Devuelve todas las empresas donde el usuario es miembro y cuál es la activa.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles").select("active_company_id, company_id").eq("id", user.id).maybeSingle();

  const { data: members } = await admin
    .from("company_members")
    .select("role, company_id, companies:companies(*)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  const companies = (members ?? []).map((m: any) => ({
    id: m.company_id,
    role: m.role,
    company: m.companies
  }));

  return NextResponse.json({
    ok: true,
    activeCompanyId: profile?.active_company_id ?? profile?.company_id ?? null,
    companies
  });
}
