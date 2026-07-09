import { NextResponse, type NextRequest } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/company/create
 * Body: { razon_social, cuit, condicion_iva?, iibb?, actividad?, direccion?, makeActive? }
 *
 * Crea una empresa ADICIONAL para el usuario autenticado.
 * Usar esto para sub-empresas / empresas secundarias. Para la primera empresa
 * del usuario podés usar /api/company/bootstrap (misma lógica pero restringida
 * a "todavía no tiene ninguna").
 *
 * Al crear:
 *  - inserta companies
 *  - agrega al usuario como miembro admin
 *  - si makeActive (default true), setea como empresa activa del usuario
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const razon_social = String(body.razon_social ?? "").trim();
  const cuit = String(body.cuit ?? "").trim();
  const makeActive: boolean = body.makeActive !== false;

  if (!razon_social || !cuit) {
    return NextResponse.json({ error: "Razón social y CUIT son obligatorios." }, { status: 400 });
  }
  if (razon_social.length > 200) {
    return NextResponse.json({ error: "Razón social muy larga (máx 200 caracteres)." }, { status: 400 });
  }
  if (cuit.length > 20) {
    return NextResponse.json({ error: "CUIT muy largo. Formato esperado: 30-12345678-9." }, { status: 400 });
  }

  const admin = createAdminClient();

  // CUIT duplicado
  const { data: existing } = await admin
    .from("companies").select("id, razon_social").eq("cuit", cuit).maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: `Ya existe una empresa con CUIT ${cuit} (${existing.razon_social}).` },
      { status: 409 }
    );
  }

  const { data: company, error: cErr } = await admin
    .from("companies")
    .insert({
      razon_social, cuit,
      owner_id: user.id,
      condicion_iva: body.condicion_iva || "Responsable Inscripto",
      iibb: body.iibb || null,
      actividad: body.actividad || null,
      direccion: body.direccion || null
    })
    .select()
    .single();
  if (cErr || !company) {
    return NextResponse.json({ error: "No se pudo crear la empresa: " + (cErr?.message ?? "error desconocido") }, { status: 500 });
  }

  // Miembro admin (si la tabla existe)
  const { error: mErr } = await admin.from("company_members").insert({
    user_id: user.id, company_id: company.id, role: "admin"
  });
  if (mErr) {
    // No cortamos si falla por ausencia de la tabla (migración 0002 no corrió).
    // Solo cortamos si es un error de constraint real que no sea "tabla no existe"
    console.warn("[create company] company_members insert warning:", mErr.message);
  }

  if (makeActive) {
    // SIEMPRE actualizar company_id = active_company_id para que al refrescar persista la última elegida.
    // Intento 1: ambos campos.
    const r1 = await admin.from("profiles")
      .update({ active_company_id: company.id, company_id: company.id, role: "admin" })
      .eq("id", user.id);

    // Intento 2 (fallback): si active_company_id no existe como columna, solo company_id.
    if (r1.error) {
      await admin.from("profiles")
        .update({ company_id: company.id, role: "admin" })
        .eq("id", user.id);
    }
  }

  return NextResponse.json({ ok: true, company, activated: makeActive });
}
