import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";

export const runtime = "nodejs";

/**
 * POST /api/invoice/delete
 * Body: { id: string } | { ids: string[] }
 *
 * Elimina la(s) factura(s):
 *   1) Desvincula bank_movements vinculados (los deja como "pendiente").
 *   2) Borra el archivo del Storage (bucket "invoices").
 *   3) Borra la fila en la tabla invoices.
 *
 * Valida que la factura pertenezca a la empresa activa del usuario.
 */
export async function POST(req: NextRequest) {
  const { user, companyId, role } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });
  if (role !== "admin") {
    return NextResponse.json({ error: "Solo el administrador puede eliminar facturas." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids) ? body.ids : body.id ? [body.id] : [];
  if (!ids.length) return NextResponse.json({ error: "Faltan ids" }, { status: 400 });

  const admin = createAdminClient();

  // Traer las facturas + validar ownership
  const { data: rows, error: selErr } = await admin
    .from("invoices")
    .select("id, company_id, storage_path, comprobante")
    .in("id", ids);
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });
  if (!rows || !rows.length) return NextResponse.json({ error: "No se encontraron facturas" }, { status: 404 });

  const invalid = rows.filter(r => r.company_id !== companyId);
  if (invalid.length) return NextResponse.json({ error: "Acceso denegado a una o más facturas" }, { status: 403 });

  const results: { id: string; ok: boolean; error?: string }[] = [];

  for (const r of rows) {
    try {
      // 1) Desvincular bank_movements (los vuelve a pendiente)
      await admin
        .from("bank_movements")
        .update({ invoice_id: null, estado: "pendiente" })
        .eq("invoice_id", r.id);

      // 2) Borrar del Storage
      if (r.storage_path) {
        const rm = await admin.storage.from("invoices").remove([r.storage_path]);
        if (rm.error) {
          // No abortar — el archivo puede estar ya borrado manualmente en Supabase
          console.warn(`[delete invoice ${r.id}] storage remove failed: ${rm.error.message}`);
        }
      }

      // 3) Borrar de la tabla
      const { error: delErr } = await admin.from("invoices").delete().eq("id", r.id);
      if (delErr) { results.push({ id: r.id, ok: false, error: delErr.message }); continue; }

      results.push({ id: r.id, ok: true });
    } catch (e: any) {
      results.push({ id: r.id, ok: false, error: e.message || "Error inesperado" });
    }
  }

  const deleted = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  return NextResponse.json({ ok: true, deleted, failed, results });
}
