import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";

export const runtime = "nodejs";

/**
 * POST /api/company/publish
 * Body: { action: "enable" | "disable" | "regenerate" }
 *
 * enable     → genera un slug (si no tiene) y activa la publicación
 * disable    → desactiva la publicación (conserva el slug)
 * regenerate → revoca el slug actual y genera uno nuevo (invalida links compartidos)
 */
export async function POST(req: NextRequest) {
  const { user, companyId, role } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });
  if (role !== "admin") return NextResponse.json({ error: "Solo admin puede publicar" }, { status: 403 });

  const { action } = await req.json().catch(() => ({}));
  if (!["enable", "disable", "regenerate"].includes(action)) {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: company, error: selErr } = await admin
    .from("companies").select("id, razon_social, public_slug, public_enabled").eq("id", companyId).maybeSingle();

  if (selErr) {
    const msg = selErr.message || "";
    if (/column .* does not exist|public_slug|public_enabled/i.test(msg)) {
      return NextResponse.json({
        error: "Falta la migración SQL 0007. Corré supabase/migrations/0007_public_slug.sql en Supabase → SQL Editor y probá de nuevo."
      }, { status: 500 });
    }
    return NextResponse.json({ error: "Error leyendo la empresa: " + msg }, { status: 500 });
  }
  if (!company) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });

  let slug = company.public_slug as string | null;
  let enabled = company.public_enabled ?? false;
  let published_at: string | null = null;

  if (action === "disable") {
    enabled = false;
  } else if (action === "regenerate") {
    slug = await generateUniqueSlug(admin, company.razon_social);
    enabled = true;
    published_at = new Date().toISOString();
  } else { // enable
    if (!slug) slug = await generateUniqueSlug(admin, company.razon_social);
    enabled = true;
    if (!company.public_enabled) published_at = new Date().toISOString();
  }

  const updates: any = { public_slug: slug, public_enabled: enabled };
  if (published_at) updates.public_published_at = published_at;

  const { error } = await admin.from("companies").update(updates).eq("id", companyId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, slug, enabled });
}

async function generateUniqueSlug(admin: any, razonSocial: string): Promise<string> {
  const base = razonSocial
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // sacar tildes
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "empresa";

  for (let i = 0; i < 10; i++) {
    const suffix = Math.random().toString(36).slice(2, 8);
    const candidate = `${base}-${suffix}`;
    const { data } = await admin.from("companies").select("id").eq("public_slug", candidate).maybeSingle();
    if (!data) return candidate;
  }
  // fallback extremo
  return `empresa-${Date.now().toString(36)}`;
}
