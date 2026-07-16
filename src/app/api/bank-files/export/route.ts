import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

/**
 * GET /api/bank-files/export?year=2026&month=03&banco=Santander
 *
 * Índice de extractos bancarios como papel de trabajo del contador.
 */
export async function GET(req: NextRequest) {
  const { user, companyId } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });

  const year = req.nextUrl.searchParams.get("year");
  const month = req.nextUrl.searchParams.get("month");
  const banco = req.nextUrl.searchParams.get("banco");

  const admin = createAdminClient();

  let query = admin
    .from("bank_statements")
    .select("id, storage_path, original_filename, banco, cuenta, cbu, periodo_desde, periodo_hasta, created_at")
    .eq("company_id", companyId)
    .not("storage_path", "is", null);

  if (banco) query = query.eq("banco", banco);

  const { data: allStatements, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Filtro por período: un extracto "cubre" el período si periodo_desde <= fin del mes
  // Y periodo_hasta >= inicio del mes (soporta extractos multi-mes).
  const statements = (allStatements ?? []).filter(st => {
    if (!year) return true;
    const desde = st.periodo_desde ?? "";
    const hasta = st.periodo_hasta ?? desde;
    if (month) {
      const mesInicio = `${year}-${month.padStart(2, "0")}-01`;
      const mesFin    = `${year}-${month.padStart(2, "0")}-31`;
      return desde <= mesFin && hasta >= mesInicio;
    }
    // Solo year: incluye si algún día del extracto cae en el año
    return desde <= `${year}-12-31` && hasta >= `${year}-01-01`;
  });

  const paths = (statements ?? []).map(s => s.storage_path).filter(Boolean) as string[];

  // Reviews de esos paths
  const { data: reviews } = paths.length
    ? await admin.from("file_reviews")
        .select("storage_path, status, note, reviewed_at, reviewed_by")
        .eq("company_id", companyId)
        .eq("entity_type", "bank_statement")
        .in("storage_path", paths)
    : { data: [] as any[] };

  const reviewerIds = Array.from(new Set((reviews ?? []).map(r => r.reviewed_by)));
  const { data: reviewers } = reviewerIds.length
    ? await admin.from("profiles").select("id, email, full_name").in("id", reviewerIds)
    : { data: [] as any[] };
  const reviewerMap = new Map((reviewers ?? []).map(u => [u.id, u]));
  const reviewMap = new Map((reviews ?? []).map(r => [r.storage_path, r]));

  // Contar movimientos y monto por statement
  const stIds = (statements ?? []).map(s => s.id);
  const { data: movs } = stIds.length
    ? await admin.from("bank_movements")
        .select("statement_id, monto, tipo")
        .in("statement_id", stIds)
    : { data: [] as any[] };
  const movsBySt = new Map<string, any[]>();
  for (const m of movs ?? []) {
    if (!movsBySt.has(m.statement_id)) movsBySt.set(m.statement_id, []);
    movsBySt.get(m.statement_id)!.push(m);
  }

  const rows = (statements ?? []).map(st => {
    const filename = st.original_filename || (st.storage_path?.split("/").pop() ?? "");
    const review = reviewMap.get(st.storage_path!);
    const reviewer = review ? reviewerMap.get(review.reviewed_by) : null;
    const ms = movsBySt.get(st.id) ?? [];
    const ingresos = ms.filter(m => m.tipo === "ingreso").reduce((a, b) => a + Number(b.monto ?? 0), 0);
    const egresos  = ms.filter(m => m.tipo === "egreso").reduce((a, b) => a + Number(b.monto ?? 0), 0);
    return {
      Archivo: filename,
      "Ruta storage": st.storage_path,
      Banco: st.banco ?? "",
      Cuenta: st.cuenta ?? "",
      CBU: st.cbu ?? "",
      "Período desde": st.periodo_desde ?? "",
      "Período hasta": st.periodo_hasta ?? "",
      Movimientos: ms.length,
      "Ingresos ARS": ingresos,
      "Egresos ARS": egresos,
      "Estado revisión": review?.status ?? "sin_revisar",
      "Revisado por": reviewer?.full_name || reviewer?.email || "",
      "Fecha revisión": review?.reviewed_at ? review.reviewed_at.slice(0, 10) : "",
      Notas: review?.note ?? "",
      "Cargado el": st.created_at ? String(st.created_at).slice(0, 10) : ""
    };
  });

  rows.sort((a, b) => (b["Período desde"] || "").localeCompare(a["Período desde"] || ""));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 44 }, { wch: 48 }, { wch: 18 }, { wch: 20 }, { wch: 24 },
    { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 },
    { wch: 16 }, { wch: 24 }, { wch: 14 }, { wch: 40 }, { wch: 14 }
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Extractos bancarios");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const filename = `extractos-bancarios-${year ?? "todos"}${month ? `-${month}` : ""}.xlsx`;
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
}
