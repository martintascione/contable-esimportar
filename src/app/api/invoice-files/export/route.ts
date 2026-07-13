import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

/**
 * GET /api/invoice-files/export?year=2026&month=03&tipo=venta
 *
 * Devuelve un XLSX con el índice de archivos originales del período,
 * pensado como "papel de trabajo" para el contador.
 * Todos los query params son opcionales.
 */
export async function GET(req: NextRequest) {
  const { user, companyId } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });

  const year = req.nextUrl.searchParams.get("year");   // "2026" | null
  const month = req.nextUrl.searchParams.get("month"); // "03"   | null
  const tipo = req.nextUrl.searchParams.get("tipo");   // "venta" | "compra" | null

  const admin = createAdminClient();

  let query = admin
    .from("invoices")
    .select("id, storage_path, original_filename, tipo, fecha, razon_social, cuit, comprobante, total, moneda, tipo_cambio, ai_confidence, status, created_at")
    .eq("company_id", companyId)
    .not("storage_path", "is", null);

  if (year && month) {
    const desde = `${year}-${month}-01`;
    const hasta = `${year}-${month}-31`;
    query = query.gte("fecha", desde).lte("fecha", hasta);
  } else if (year) {
    query = query.gte("fecha", `${year}-01-01`).lte("fecha", `${year}-12-31`);
  }
  if (tipo === "venta" || tipo === "compra") query = query.eq("tipo", tipo);

  const { data: invoices, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: reviews } = await admin
    .from("file_reviews")
    .select("storage_path, status, note, reviewed_at, reviewed_by")
    .eq("company_id", companyId);

  // Traemos email de quienes revisaron
  const reviewerIds = Array.from(new Set((reviews ?? []).map(r => r.reviewed_by)));
  const { data: reviewers } = reviewerIds.length
    ? await admin.from("profiles").select("id, email, full_name").in("id", reviewerIds)
    : { data: [] as any[] };
  const reviewerMap = new Map((reviewers ?? []).map(u => [u.id, u]));
  const reviewMap = new Map((reviews ?? []).map(r => [r.storage_path, r]));

  // Agrupar por storage_path
  const groups = new Map<string, any[]>();
  for (const inv of invoices ?? []) {
    if (!inv.storage_path) continue;
    if (!groups.has(inv.storage_path)) groups.set(inv.storage_path, []);
    groups.get(inv.storage_path)!.push(inv);
  }

  // Armar filas del índice
  const rows = Array.from(groups.entries()).map(([path, facts]) => {
    const fechas = facts.map(f => f.fecha).filter(Boolean).sort();
    const total = facts.reduce((a, b) => a + Number(b.total ?? 0), 0);
    const ventas = facts.filter(f => f.tipo === "venta").length;
    const compras = facts.filter(f => f.tipo === "compra").length;
    const filename = facts[0].original_filename || path.split("/").pop() || path;
    const review = reviewMap.get(path);
    const reviewer = review ? reviewerMap.get(review.reviewed_by) : null;
    const confMin = facts.reduce((a, b) => Math.min(a, Number(b.ai_confidence ?? 1)), 1);
    return {
      Archivo: filename,
      "Ruta storage": path,
      "Facturas": facts.length,
      Ventas: ventas,
      Compras: compras,
      "Período desde": fechas[0] ?? "",
      "Período hasta": fechas[fechas.length - 1] ?? "",
      "Total ARS": total,
      "Confianza IA (min)": Math.round(confMin * 100) / 100,
      "Estado revisión": review?.status ?? "sin_revisar",
      "Revisado por": reviewer?.full_name || reviewer?.email || "",
      "Fecha revisión": review?.reviewed_at ? review.reviewed_at.slice(0, 10) : "",
      Notas: review?.note ?? "",
      "Cargado el": facts[0].created_at ? String(facts[0].created_at).slice(0, 10) : ""
    };
  });

  // Ordenar por fecha desde desc
  rows.sort((a, b) => (b["Período desde"] || "").localeCompare(a["Período desde"] || ""));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);

  // Anchos de columna
  const cols = [
    { wch: 44 }, // Archivo
    { wch: 48 }, // Ruta storage
    { wch: 10 }, // Facturas
    { wch: 8 },  // Ventas
    { wch: 8 },  // Compras
    { wch: 14 }, // Período desde
    { wch: 14 }, // Período hasta
    { wch: 14 }, // Total ARS
    { wch: 12 }, // Confianza IA
    { wch: 16 }, // Estado revisión
    { wch: 24 }, // Revisado por
    { wch: 14 }, // Fecha revisión
    { wch: 40 }, // Notas
    { wch: 14 }, // Cargado el
  ];
  ws["!cols"] = cols;

  XLSX.utils.book_append_sheet(wb, ws, "Índice de archivos");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const filename = `indice-archivos-${year ?? "todos"}${month ? `-${month}` : ""}.xlsx`;
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
}
