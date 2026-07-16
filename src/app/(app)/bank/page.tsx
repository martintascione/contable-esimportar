import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";
import { BankClient } from "@/components/modules/BankClient";
import { groupBanks } from "@/lib/banks";

export default async function BankPage() {
  const { user, companyId } = await getActiveCompany();
  if (!user) return null;

  let movements: any[] = [];
  let invoices: any[] = [];
  let statements: any[] = [];
  let partners: any[] = [];
  let fileReviews: any[] = [];
  let reviewers: any[] = [];

  if (companyId) {
    const admin = createAdminClient();
    const [mov, inv, st, pt, fr] = await Promise.all([
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
        .select("id, banco, cuenta, cbu, periodo_desde, periodo_hasta, storage_path, original_filename, moneda, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false }),
      admin.from("company_partners")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: true }),
      admin.from("file_reviews")
        .select("*")
        .eq("company_id", companyId)
        .eq("entity_type", "bank_statement")
    ]);
    // Consolidamos nombres de bancos: aplica reglas hardcoded + fuzzy match para
    // agrupar variantes similares (ej. "Bco. XYZ" y "Banco XYZ Argentina" bajo un
    // único nombre). Se construye desde TODOS los bancos que aparecen en la data,
    // así el mapa es consistente entre movements y statements.
    const todosLosBancosCrudos = [
      ...(mov.data ?? []).map((m: any) => m.bank_statements?.banco),
      ...(st.data ?? []).map((s: any) => s.banco)
    ];
    const bancosMap = groupBanks(todosLosBancosCrudos);

    movements = (mov.data ?? []).map((m: any) => ({
      ...m,
      banco: bancosMap.get(m.bank_statements?.banco ?? "") ?? "Sin banco",
      cuenta: m.bank_statements?.cuenta ?? null,
      cuit_contraparte: m.cuit_contraparte ?? null,
      nombre_contraparte: m.nombre_contraparte ?? null,
      es_transferencia: m.es_transferencia ?? false,
      es_cuenta_propia: m.es_cuenta_propia ?? false
    }));
    invoices = inv.data ?? [];
    statements = (st.data ?? []).map((s: any) => ({
      ...s,
      banco: bancosMap.get(s.banco ?? "") ?? "Sin banco"
    }));
    partners = pt.data ?? [];
    fileReviews = fr.data ?? [];

    const reviewerIds = Array.from(new Set(fileReviews.map((r: any) => r.reviewed_by)));
    if (reviewerIds.length) {
      const { data: users } = await admin
        .from("profiles").select("id, email, full_name").in("id", reviewerIds);
      reviewers = users ?? [];
    }
  }

  return (
    <BankClient
      movements={movements}
      invoices={invoices}
      statements={statements}
      partners={partners}
      fileReviews={fileReviews}
      reviewers={reviewers}
    />
  );
}
