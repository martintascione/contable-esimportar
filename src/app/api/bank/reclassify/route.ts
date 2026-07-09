import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";
import { findCuitInText, onlyDigits, removeCuitFromText, looksLikeTransfer } from "@/lib/cuit";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/bank/reclassify
 * Re-procesa TODOS los movimientos bancarios de la empresa activa:
 *   - Extrae CUIT de la descripción con regex (valida checksum).
 *   - Extrae nombre de contraparte sacando el CUIT del texto.
 *   - Detecta si es transferencia.
 *   - Cruza el CUIT contra las empresas del usuario → marca es_cuenta_propia.
 *
 * No toca invoice_id, estado, monto ni fecha. Solo las columnas nuevas.
 * Pensado para correr después de cargar la migración 0003.
 */
export async function POST() {
  const { user, companyId, role } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });
  if (role !== "admin") return NextResponse.json({ error: "Solo admin puede reclasificar" }, { status: 403 });

  const admin = createAdminClient();

  // CUITs propios del usuario
  const propios = new Set<string>();
  const { data: mem } = await admin
    .from("company_members").select("companies:companies(cuit)").eq("user_id", user.id);
  (mem ?? []).forEach((r: any) => {
    const c = onlyDigits(r.companies?.cuit);
    if (c.length === 11) propios.add(c);
  });
  const { data: owned } = await admin.from("companies").select("cuit").eq("owner_id", user.id);
  (owned ?? []).forEach((r: any) => {
    const c = onlyDigits(r.cuit);
    if (c.length === 11) propios.add(c);
  });

  // Traer todos los movimientos de la empresa activa
  const { data: movements, error } = await admin
    .from("bank_movements")
    .select("id, descripcion, referencia, cuit_contraparte, nombre_contraparte")
    .eq("company_id", companyId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!movements?.length) {
    return NextResponse.json({ ok: true, total: 0, updated: 0, propias: 0, conCuit: 0 });
  }

  let updated = 0;
  let propiasCount = 0;
  let conCuitCount = 0;

  // Actualizaciones individuales (idealmente batch, pero Supabase JS no lo soporta limpio sin rpc)
  for (const m of movements) {
    const text = `${m.descripcion ?? ""} ${m.referencia ?? ""}`;
    const cuit = findCuitInText(text);
    const esTransf = looksLikeTransfer(m.descripcion);
    const esPropia = Boolean(cuit && propios.has(cuit));
    const nombre = cuit
      ? (m.nombre_contraparte?.trim() || removeCuitFromText(m.descripcion ?? "", cuit).slice(0, 180) || null)
      : (m.nombre_contraparte ?? null);

    const patch: any = {
      es_transferencia: esTransf,
      es_cuenta_propia: esPropia
    };
    if (cuit) { patch.cuit_contraparte = cuit; conCuitCount++; }
    if (nombre) patch.nombre_contraparte = nombre;
    if (esPropia) propiasCount++;

    const { error: upErr } = await admin
      .from("bank_movements").update(patch).eq("id", m.id);
    if (!upErr) updated++;
  }

  return NextResponse.json({
    ok: true,
    total: movements.length,
    updated,
    conCuit: conCuitCount,
    propias: propiasCount,
    propiaCuits: Array.from(propios)
  });
}
