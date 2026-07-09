import { NextResponse, type NextRequest } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/company/switch
 * Body: { company_id: uuid }
 *
 * Cambia la empresa activa del usuario. Defensivo contra el estado de la migración 0002:
 *   - Si existe company_members y active_company_id → los usa (modo moderno).
 *   - Si no existen → cae a verificar owner_id y actualiza solo company_id (modo legacy).
 *   - Siempre persiste en company_id también para que al refrescar quede fijada.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { company_id } = await req.json().catch(() => ({}));
  if (!company_id || typeof company_id !== "string") {
    return NextResponse.json({ error: "Falta company_id" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Validar acceso del usuario a esa empresa.
  // 1) Primero con company_members (si existe la tabla).
  let role: "admin" | "contador" = "admin";
  let membershipOk = false;

  const { data: member, error: memErr } = await admin
    .from("company_members")
    .select("id, role")
    .eq("user_id", user.id)
    .eq("company_id", company_id)
    .maybeSingle();

  if (!memErr && member) {
    membershipOk = true;
    role = (member.role as any) ?? "admin";
  } else {
    // Fallback: si no existe company_members o no hay membership,
    // verificar si el usuario es owner de la company.
    const { data: company } = await admin
      .from("companies").select("id, owner_id").eq("id", company_id).maybeSingle();
    if (company && company.owner_id === user.id) {
      membershipOk = true;
      role = "admin";
    }
  }

  if (!membershipOk) {
    return NextResponse.json({ error: "No sos miembro de esa empresa." }, { status: 403 });
  }

  // Intento 1: actualizar ambos campos (company_id + active_company_id)
  let updErr: any = null;
  {
    const r = await admin.from("profiles")
      .update({ company_id, active_company_id: company_id, role })
      .eq("id", user.id);
    updErr = r.error;
  }

  // Intento 2: si la columna active_company_id no existe (error), intentar solo con company_id
  if (updErr) {
    const r2 = await admin.from("profiles")
      .update({ company_id, role })
      .eq("id", user.id);
    if (r2.error) return NextResponse.json({ error: r2.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, active_company_id: company_id });
}
