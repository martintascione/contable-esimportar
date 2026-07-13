import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";
import { DashboardClient } from "@/components/modules/DashboardClient";

export default async function DashboardPage() {
  const { user, companyId } = await getActiveCompany();
  if (!user) return null;

  let invoices: any[] = [];
  let annual: { m: string; debito: number; credito: number }[] = [];
  let company: any = null;
  let fileReviews: any[] = [];
  let reviewers: any[] = [];

  if (companyId) {
    const admin = createAdminClient();
    const [inv, comp, fr] = await Promise.all([
      // Sin límite: necesitamos histórico completo para el índice de archivos originales.
      admin.from("invoices").select("*").eq("company_id", companyId).order("fecha", { ascending: false }).limit(10000),
      admin.from("companies").select("*").eq("id", companyId).maybeSingle(),
      admin.from("file_reviews").select("*").eq("company_id", companyId)
    ]);
    invoices = inv.data ?? [];
    company = comp.data ?? null;
    fileReviews = fr.data ?? [];

    // Traer nombres de los revisores para mostrarlos
    const reviewerIds = Array.from(new Set(fileReviews.map((r: any) => r.reviewed_by)));
    if (reviewerIds.length) {
      const { data: users } = await admin
        .from("profiles").select("id, email, full_name").in("id", reviewerIds);
      reviewers = users ?? [];
    }

    const year = new Date().getFullYear();
    const MESES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    annual = MESES.map((m) => ({ m, debito: 0, credito: 0 }));
    invoices.forEach((invv) => {
      const d = new Date(invv.fecha);
      if (d.getFullYear() !== year) return;
      const idx = d.getMonth();
      if (invv.tipo === "venta") annual[idx].debito += Number(invv.iva_total ?? 0);
      else annual[idx].credito += Number(invv.iva_total ?? 0);
    });
  }

  return (
    <DashboardClient
      invoices={invoices}
      annual={annual}
      company={company}
      fileReviews={fileReviews}
      reviewers={reviewers}
    />
  );
}
