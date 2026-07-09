import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";
import { DocumentsClient } from "@/components/modules/DocumentsClient";

export default async function DocumentsPage() {
  const { user, companyId, role } = await getActiveCompany();
  if (!user) return null;

  let docs: any[] = [];
  if (companyId) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("company_documents").select("*").eq("company_id", companyId)
      .order("created_at", { ascending: false });
    docs = data ?? [];
  }

  return (
    <DocumentsClient
      docs={docs}
      canEdit={role === "admin" && !!companyId}
      hasCompany={!!companyId}
    />
  );
}
