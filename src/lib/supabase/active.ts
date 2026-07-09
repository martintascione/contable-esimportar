import { createClient, createAdminClient } from "./server";

/**
 * Devuelve la empresa activa del usuario + su rol.
 * Resiliente al estado de la migración 0002:
 *   - Si existe active_company_id, la usa.
 *   - Si no, cae a company_id.
 *   - Usa el admin client para leer el profile y evitar cualquier edge case de RLS.
 */
export async function getActiveCompany() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, companyId: null, role: null, profile: null };

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, email, full_name, role, company_id, active_company_id")
    .eq("id", user.id)
    .maybeSingle();

  const companyId = (profile as any)?.active_company_id ?? profile?.company_id ?? null;
  return {
    user,
    companyId,
    role: profile?.role ?? null,
    profile
  };
}
