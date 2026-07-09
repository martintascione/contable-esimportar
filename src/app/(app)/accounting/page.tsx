import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";
import { AccountingClient } from "@/components/modules/AccountingClient";

export const dynamic = "force-dynamic";

export default async function AccountingPage() {
  const { user, companyId, role } = await getActiveCompany();
  if (!user) return null;

  let accounts: any[] = [];
  let entries: any[] = [];
  let company: any = null;

  if (companyId) {
    const admin = createAdminClient();
    const [accs, ents, comp] = await Promise.all([
      admin.from("accounts")
        .select("id, code, name, type, parent_id, is_imputable, active")
        .eq("company_id", companyId)
        .eq("active", true)
        .order("code", { ascending: true }),
      admin.from("journal_entries")
        .select("id, numero, fecha, concepto, source, total_debe, total_haber, status, journal_entry_lines(id, account_id, descripcion, debe, haber, ord, accounts(code, name, type))")
        .eq("company_id", companyId)
        .order("fecha", { ascending: false })
        .order("numero", { ascending: false })
        .limit(500),
      admin.from("companies").select("razon_social, cuit").eq("id", companyId).maybeSingle()
    ]);
    accounts = accs.data ?? [];
    entries = ents.data ?? [];
    company = comp.data ?? null;
  }

  return (
    <AccountingClient
      accounts={accounts}
      entries={entries}
      canEdit={role === "admin" && !!companyId}
      hasCompany={!!companyId}
      company={company}
    />
  );
}
