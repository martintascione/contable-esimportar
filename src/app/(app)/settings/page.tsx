import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";
import { SettingsClient } from "@/components/modules/SettingsClient";

export default async function SettingsPage() {
  const { user, companyId: initialId, profile: initialProfile } = await getActiveCompany();
  if (!user) return null;

  const admin = createAdminClient();

  let companyId = initialId;
  let profile = initialProfile;

  // Auto-reparación: si el profile no tiene empresa pero existe una company
  // donde el user es owner, la asociamos automáticamente.
  if (!companyId) {
    const { data: orphan } = await admin
      .from("companies").select("*")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (orphan) {
      // Intentar update con active_company_id; si la columna no existe, fallback
      const up1 = await admin.from("profiles")
        .update({ company_id: orphan.id, active_company_id: orphan.id, role: "admin" })
        .eq("id", user.id);
      if (up1.error) {
        await admin.from("profiles").update({ company_id: orphan.id, role: "admin" }).eq("id", user.id);
      }
      // Asegurar membership
      await admin.from("company_members")
        .insert({ user_id: user.id, company_id: orphan.id, role: "admin" })
        .then(() => {}, () => {});

      companyId = orphan.id;
      // Re-leer profile actualizado
      const { data: p } = await admin.from("profiles").select("*").eq("id", user.id).maybeSingle();
      profile = p as any;
    }
  }

  let company: any = null;
  let teamMembers: any[] = [];
  let integrations: any[] = [];

  if (companyId) {
    const [c, m, it] = await Promise.all([
      admin.from("companies").select("*").eq("id", companyId).maybeSingle(),
      admin.from("profiles").select("id, email, full_name, role").eq("company_id", companyId),
      admin.from("integrations").select("*").eq("company_id", companyId)
    ]);
    company = c.data;
    teamMembers = m.data ?? [];
    integrations = it.data ?? [];
  }

  return (
    <SettingsClient
      profile={profile as any}
      company={company}
      teamMembers={teamMembers}
      integrations={integrations}
    />
  );
}
