import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";
import { DashboardClient } from "@/components/modules/DashboardClient";

export default async function DashboardPage() {
  const { user, companyId } = await getActiveCompany();
  if (!user) return null;

  let invoices: any[] = [];
  let annual: { m: string; debito: number; credito: number }[] = [];
  let company: any = null;

  if (companyId) {
    const admin = createAdminClient();
    const [inv, comp] = await Promise.all([
      admin.from("invoices").select("*").eq("company_id", companyId).order("fecha", { ascending: false }).limit(200),
      admin.from("companies").select("*").eq("id", companyId).maybeSingle()
    ]);
    invoices = inv.data ?? [];
    company = comp.data ?? null;

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
    />
  );
}
