import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";
import { getTcBulk, type Moneda } from "@/lib/bcra";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/bank/statement/update-currency
 * Body: {
 *   statement_id: string,
 *   moneda: 'ARS'|'USD'|'EUR',
 *   fetch_tc?: boolean   // default true; si true busca TC del BCRA para cada mov
 * }
 *
 * Cambia la moneda de un extracto y de TODOS sus movimientos.
 * Para cada movimiento, guarda el TC del día como REFERENCIA (informativo).
 * NO recalcula 'monto' — el monto queda tal cual (en la moneda elegida).
 *
 * Optimización: actualiza los movimientos AGRUPADOS por (moneda + TC), no uno
 * por uno. Reduce N queries a Postgres a ~30 (típicamente) para un mes entero.
 */
export async function POST(req: NextRequest) {
  const { user, companyId } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });

  const body = await req.json();
  const { statement_id, moneda, fetch_tc = true } = body ?? {};

  if (!statement_id) return NextResponse.json({ error: "Falta statement_id" }, { status: 400 });
  if (!["ARS", "USD", "EUR"].includes(moneda)) {
    return NextResponse.json({ error: "Moneda inválida" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Ownership
  const { data: st } = await admin
    .from("bank_statements")
    .select("id, company_id")
    .eq("id", statement_id)
    .maybeSingle();
  if (!st) return NextResponse.json({ error: "Extracto no encontrado" }, { status: 404 });
  if (st.company_id !== companyId) return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });

  // Traer movs
  const { data: movs } = await admin
    .from("bank_movements")
    .select("id, fecha")
    .eq("company_id", companyId)
    .eq("statement_id", statement_id);

  // Actualizar el extracto siempre
  await admin.from("bank_statements").update({ moneda }).eq("id", statement_id);

  if (!movs || movs.length === 0) {
    return NextResponse.json({ ok: true, updated_movements: 0, statement_updated: true });
  }

  // Caso ARS: bulk update con IN (una sola query)
  if (moneda === "ARS") {
    const ids = movs.map(m => m.id);
    const { error } = await admin.from("bank_movements").update({
      moneda: "ARS",
      tipo_cambio_referencia: null,
      tipo_cambio_referencia_fuente: null
    }).in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      ok: true,
      updated_movements: movs.length,
      statement_updated: true,
      fuente_tc: "n/a"
    });
  }

  // Caso USD/EUR: obtener TC de referencia por fecha
  let tcMap = new Map<string, number>();
  if (fetch_tc) {
    const fechas = movs.map(m => m.fecha).filter(Boolean) as string[];
    tcMap = await getTcBulk(fechas, moneda as Moneda);
  }

  // Agrupar movimientos por su TC de referencia para hacer bulk updates
  // (una query por grupo TC en vez de una por mov).
  const groupsByTc = new Map<string, string[]>();  // "tc" (o "null") -> [movement_ids]
  const missingTc: string[] = [];

  for (const m of movs) {
    const tcRef = tcMap.get(m.fecha) ?? null;
    if (fetch_tc && tcRef === null) missingTc.push(m.fecha);
    const key = tcRef === null ? "null" : String(tcRef);
    if (!groupsByTc.has(key)) groupsByTc.set(key, []);
    groupsByTc.get(key)!.push(m.id);
  }

  let updated = 0;
  const errors: string[] = [];

  for (const [tcKey, ids] of groupsByTc.entries()) {
    const tcRef = tcKey === "null" ? null : Number(tcKey);
    const { error, count } = await admin.from("bank_movements").update(
      {
        moneda,
        tipo_cambio_referencia: tcRef,
        tipo_cambio_referencia_fuente: tcRef !== null ? "bcra" : null
      },
      { count: "exact" }
    ).in("id", ids);
    if (error) errors.push(error.message);
    else updated += count ?? ids.length;
  }

  const uniqMissing = [...new Set(missingTc)];
  const warnings: string[] = [];
  if (uniqMissing.length > 0) {
    warnings.push(
      `Faltó el TC del BCRA para ${uniqMissing.length} fecha(s). ` +
      `Los movimientos quedaron sin TC de referencia. Podés editarlos manualmente uno por uno.`
    );
  }
  if (errors.length > 0) {
    warnings.push(`${errors.length} error(es) al actualizar: ${errors[0]}`);
  }

  return NextResponse.json({
    ok: true,
    updated_movements: updated,
    total_movements: movs.length,
    missing_tc_count: uniqMissing.length,
    missing_tc_dates_sample: uniqMissing.slice(0, 10),
    warnings,
    statement_updated: true,
    fuente_tc: fetch_tc ? "bcra" : "ninguno"
  });
}
