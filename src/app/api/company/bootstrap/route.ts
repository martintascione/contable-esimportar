import { NextResponse, type NextRequest } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/company/bootstrap
 * Crea la primera empresa del usuario. Defensivo contra el estado de la migración 0002:
 *   - Si existen active_company_id / company_members, los usa.
 *   - Si no existen, actualiza solo company_id y sigue funcionando.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const razon_social = String(body.razon_social ?? "").trim();
  const cuit = String(body.cuit ?? "").trim();
  if (!razon_social || !cuit) return NextResponse.json({ error: "Razón social y CUIT son obligatorios." }, { status: 400 });
  if (razon_social.length > 200) return NextResponse.json({ error: "Razón social muy larga (máx 200)." }, { status: 400 });
  if (cuit.length > 20) return NextResponse.json({ error: "CUIT muy largo. Formato: 30-12345678-9." }, { status: 400 });

  const admin = createAdminClient();

  // Perfil — crear si no existe
  const { data: profile } = await admin
    .from("profiles").select("id, company_id, role, email, full_name").eq("id", user.id).maybeSingle();

  if (!profile) {
    const { error: insProfileErr } = await admin.from("profiles").insert({
      id: user.id,
      email: user.email ?? null,
      full_name: (user.user_metadata as any)?.full_name ?? null,
      role: "admin"
    });
    if (insProfileErr) return NextResponse.json({ error: "No se pudo crear tu perfil: " + insProfileErr.message }, { status: 500 });
  } else if (profile.company_id) {
    return NextResponse.json(
      { error: "Ya tenés una empresa. Usá el botón 'Crear nueva empresa' en el switcher." },
      { status: 409 }
    );
  }

  // ¿El usuario tiene una empresa HUÉRFANA creada antes y nunca asociada?
  // (por ej. si bootstrap falló a mitad en una corrida anterior)
  const { data: orphan } = await admin
    .from("companies").select("*").eq("owner_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (orphan && !profile?.company_id) {
    // Re-asociar en vez de crear una nueva
    const updates: any = { company_id: orphan.id, role: "admin" };
    const { error: upErr1 } = await admin.from("profiles").update({ ...updates, active_company_id: orphan.id }).eq("id", user.id);
    if (upErr1) {
      await admin.from("profiles").update(updates).eq("id", user.id);
    }
    await admin.from("company_members").insert({ user_id: user.id, company_id: orphan.id, role: "admin" }).then(() => {}).catch(() => {});
    return NextResponse.json({
      ok: true,
      company: orphan,
      recovered: true,
      message: "Encontramos una empresa creada anteriormente y la vinculamos a tu usuario."
    });
  }

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
    return NextResponse.json({ error: "No se pudo crear la empresa: " + (cErr?.message ?? "error") }, { status: 500 });
  }

  // Intentar insertar en company_members (puede no existir si el SQL 0002 no corrió)
  let membersOk = true;
  const { error: mErr } = await admin.from("company_members").insert({
    user_id: user.id, company_id: company.id, role: "admin"
  });
  if (mErr) {
    membersOk = false;
    console.warn("[bootstrap] company_members insert falló (¿falta migrar SQL 0002?):", mErr.message);
  }

  // Intentar actualizar profile con ambas columnas; si active_company_id no existe, caer a solo company_id
  const warnings: string[] = [];
  let upErr: any = null;
  {
    const r = await admin.from("profiles")
      .update({ company_id: company.id, active_company_id: company.id, role: "admin" })
      .eq("id", user.id);
    upErr = r.error;
  }
  if (upErr) {
    // Intentar sin active_company_id
    const r2 = await admin.from("profiles")
      .update({ company_id: company.id, role: "admin" })
      .eq("id", user.id);
    if (r2.error) {
      return NextResponse.json({ error: "Empresa creada pero no se pudo asociar tu perfil: " + r2.error.message, company }, { status: 500 });
    }
    warnings.push("La migración 0002 (multi-empresa) todavía no fue ejecutada. Corré supabase/migrations/0002_multi_company.sql en SQL Editor.");
  }
  if (!membersOk) warnings.push("No pude registrar tu membresía en company_members. Tu empresa funciona, pero el switch entre empresas no estará disponible hasta correr la migración 0002.");

  return NextResponse.json({ ok: true, company, warnings });
}
