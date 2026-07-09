import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";
import { BalancesClient } from "@/components/modules/BalancesClient";

export const dynamic = "force-dynamic";

export default async function BalancesPage() {
  const { user, companyId } = await getActiveCompany();
  if (!user) return null;

  let invoices: any[] = [];
  let movements: any[] = [];
  let company: any = null;

  if (companyId) {
    const admin = createAdminClient();
    const [inv, mov, comp] = await Promise.all([
      admin.from("invoices")
        .select("id, tipo, fecha, razon_social, cuit, comprobante, neto_gravado, iva_21, iva_10_5, iva_27, iva_otros, iva_total, percepciones, total, status")
        .eq("company_id", companyId)
        .order("fecha", { ascending: false })
        .limit(10000),
      admin.from("bank_movements")
        .select("id, fecha, descripcion, tipo, monto, estado, invoice_id, categoria_detalle, jurisdiccion, alicuota, bank_statements(banco, cuenta)")
        .eq("company_id", companyId)
        .order("fecha", { ascending: false })
        .limit(10000),
      admin.from("companies").select("*").eq("id", companyId).maybeSingle()
    ]);
    invoices = inv.data ?? [];
    movements = (mov.data ?? []).map((m: any) => ({
      ...m,
      banco: m.bank_statements?.banco ?? "Sin banco"
    }));
    company = comp.data ?? null;
  }

  return <BalancesClient invoices={invoices} movements={movements} company={company} />;
}
