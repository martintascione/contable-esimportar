import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";
import { onlyDigits, isValidCuit } from "@/lib/cuit";

export const runtime = "nodejs";

/**
 * GET /api/partners
 * Lista los socios de la empresa activa.
 */
export async function GET() {
  const { user, companyId } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("company_partners")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ partners: data ?? [] });
}

/**
 * POST /api/partners
 * Body: { nombre, cuit?, dni?, relacion?, porcentaje?, observaciones? }
 */
export async function POST(req: NextRequest) {
  const { user, companyId, role } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });
  if (role !== "admin") return NextResponse.json({ error: "Solo el admin puede agregar socios" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const nombre = String(body.nombre ?? "").trim();
  if (!nombre) return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });

  let cuit: string | null = body.cuit ? onlyDigits(body.cuit) : null;
  if (cuit && cuit.length !== 11) return NextResponse.json({ error: "CUIT debe tener 11 dígitos" }, { status: 400 });
  if (cuit && !isValidCuit(cuit)) return NextResponse.json({ error: "CUIT inválido (checksum incorrecto)" }, { status: 400 });

  const dni = body.dni ? onlyDigits(body.dni) : null;
  const admin = createAdminClient();

  const { data, error } = await admin.from("company_partners").insert({
    company_id: companyId,
    nombre,
    cuit,
    dni,
    relacion: body.relacion || "socio",
    porcentaje: body.porcentaje ?? null,
    observaciones: body.observaciones ?? null,
    created_by: user.id
  }).select().single();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Ya existe un socio con ese CUIT" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, partner: data });
}
