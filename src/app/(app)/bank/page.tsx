import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";
import { BankClient } from "@/components/modules/BankClient";

export default async function BankPage() {
  const { user, companyId } = await getActiveCompany();
  if (!user) return null;

  let movements: any[] = [];
  let invoices: any[] = [];
  let statements: any[] = [];
  let partners: any[] = [];

  if (companyId) {
    const admin = createAdminClient();
    const [mov, inv, st, pt] = await Promise.all([
      admin.from("bank_movements")
        .select("*, bank_statements(id, banco, cuenta, cbu, periodo_desde, periodo_hasta)")
        .eq("company_id", companyId)
        .order("fecha", { ascending: false })
        .limit(10000),
      admin.from("invoices")
        .select("id,comprobante,razon_social,cuit,fecha,tipo,total,neto_gravado,iva_total")
        .eq("company_id", companyId)
        .limit(1000),
      admin.from("bank_statements")
        .select("id, banco, cuenta, cbu, periodo_desde, periodo_hasta, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false }),
      admin.from("company_partners")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: true })
    ]);
    movements = (mov.data ?? []).map((m: any) => ({
      ...m,
      banco: m.bank_statements?.banco ?? "Sin banco",
      cuenta: m.bank_statements?.cuenta ?? null,
      cuit_contraparte: m.cuit_contraparte ?? null,
      nombre_contraparte: m.nombre_contraparte ?? null,
      es_transferencia: m.es_transferencia ?? false,
      es_cuenta_propia: m.es_cuenta_propia ?? false
    }));
    invoices = inv.data ?? [];
    statements = st.data ?? [];
    partners = pt.data ?? [];
  }

  return <BankClient movements={movements} invoices={invoices} statements={statements} partners={partners} />;
}
