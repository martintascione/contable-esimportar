import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";
import { DEFAULT_PLAN } from "@/lib/accountingPlan";

export const runtime = "nodejs";

/**
 * POST /api/accounting/accounts/seed
 * Carga el plan de cuentas estándar argentino. No duplica si el código ya existe.
 */
export async function POST() {
  const { user, companyId, role } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });
  if (role !== "admin") return NextResponse.json({ error: "Solo admin" }, { status: 403 });

  const admin = createAdminClient();

  // Leer cuentas existentes
  const { data: existing } = await admin
    .from("accounts").select("id, code").eq("company_id", companyId);
  const codeToId = new Map((existing ?? []).map((c: any) => [c.code, c.id as string]));

  let created = 0;
  let skipped = 0;

  // Insertamos en pasadas — los hijos pueden referenciar parents recién creados.
  // Como el array está ordenado por código natural, los padres siempre van antes.
  for (const seed of DEFAULT_PLAN) {
    if (codeToId.has(seed.code)) { skipped++; continue; }

    const parent_id = seed.parent_code ? codeToId.get(seed.parent_code) ?? null : null;

    const { data, error } = await admin.from("accounts").insert({
      company_id: companyId,
      code: seed.code,
      name: seed.name,
      type: seed.type,
      parent_id,
      is_imputable: seed.is_imputable
    }).select("id, code").single();

    if (error) {
      console.warn(`[seed] ${seed.code} fallo: ${error.message}`);
      continue;
    }
    codeToId.set(data.code, data.id);
    created++;
  }

  return NextResponse.json({ ok: true, created, skipped, total: DEFAULT_PLAN.length });
}
