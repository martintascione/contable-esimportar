import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";

export const runtime = "nodejs";

/** GET /api/accounting/accounts — lista plan de cuentas de la empresa activa */
export async function GET() {
  const { user, companyId } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("accounts")
    .select("id, code, name, type, parent_id, is_imputable, description, active")
    .eq("company_id", companyId)
    .eq("active", true)
    .order("code", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ accounts: data ?? [] });
}

/** POST /api/accounting/accounts — crear cuenta nueva */
export async function POST(req: NextRequest) {
  const { user, companyId, role } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });
  if (role !== "admin") return NextResponse.json({ error: "Solo admin puede crear cuentas" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const code = String(body.code ?? "").trim();
  const name = String(body.name ?? "").trim();
  const type = body.type;
  const parent_id = body.parent_id ?? null;
  const is_imputable = body.is_imputable ?? true;

  if (!code || !name) return NextResponse.json({ error: "Faltan code o name" }, { status: 400 });
  if (!["activo","pasivo","patrimonio_neto","ingreso","egreso"].includes(type)) {
    return NextResponse.json({ error: "type inválido" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.from("accounts").insert({
    company_id: companyId,
    code, name, type, parent_id, is_imputable,
    description: body.description ?? null
  }).select().single();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: `Ya existe una cuenta con código ${code}` }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, account: data });
}
