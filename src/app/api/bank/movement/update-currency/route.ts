import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";
import { getTcBCRA, type Moneda } from "@/lib/bcra";

export const runtime = "nodejs";

/**
 * POST /api/bank/movement/update-currency
 * Body: {
 *   movement_id: string,
 *   moneda: 'ARS'|'USD'|'EUR',
 *   tipo_cambio_referencia?: number,   // opcional; si no viene y moneda!=ARS → BCRA
 *   fuente?: 'manual' | 'bcra'         // solo informativo
 * }
 *
 * Cambia la moneda de un movimiento y guarda un TC de REFERENCIA (informativo).
 * NO recalcula 'monto' — el monto sigue siendo el importe original en la moneda
 * elegida.
 */
export async function POST(req: NextRequest) {
  const { user, companyId } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });

  const body = await req.json();
  const { movement_id, moneda, tipo_cambio_referencia } = body ?? {};
  if (!movement_id) return NextResponse.json({ error: "Falta movement_id" }, { status: 400 });
  if (!["ARS", "USD", "EUR"].includes(moneda)) {
    return NextResponse.json({ error: "Moneda inválida" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Ownership
  const { data: mov } = await admin
    .from("bank_movements")
    .select("id, company_id, fecha")
    .eq("id", movement_id)
    .maybeSingle();
  if (!mov) return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 });
  if (mov.company_id !== companyId) return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });

  // Determinar TC de referencia
  let tcRef: number | null = null;
  let fuente: string | null = null;

  if (moneda !== "ARS") {
    if (typeof tipo_cambio_referencia === "number" && tipo_cambio_referencia > 0) {
      tcRef = tipo_cambio_referencia;
      fuente = "manual";
    } else {
      // Consultar BCRA para la fecha del movimiento
      tcRef = await getTcBCRA(mov.fecha, moneda as Moneda);
      fuente = tcRef ? "bcra" : null;
    }
  }

  const { data: updated, error } = await admin
    .from("bank_movements")
    .update({
      moneda,
      tipo_cambio_referencia: tcRef,
      tipo_cambio_referencia_fuente: fuente
    })
    .eq("id", movement_id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    movement: updated,
    tc_referencia: tcRef,
    fuente_tc: fuente
  });
}
