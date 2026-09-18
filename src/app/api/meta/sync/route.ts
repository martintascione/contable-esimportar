import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/meta/http";
import { getSecret } from "@/lib/secrets";
import { syncAllProjects, syncProject } from "@/lib/meta/sync";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/meta/sync — llamado por Vercel Cron cada hora (header Authorization: Bearer CRON_SECRET).
 * Sincroniza todos los proyectos activos.
 */
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const auth = req.headers.get("authorization") ?? "";
  const qs = req.nextUrl.searchParams.get("secret");
  if (!secret || (auth !== `Bearer ${secret}` && qs !== secret)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const results = await syncAllProjects("cron");
  return NextResponse.json({ ok: true, results });
}

/** POST /api/meta/sync { projectId? } — sincronización manual desde la UI. */
export async function POST(req: NextRequest) {
  const { user, res } = await requireUser();
  if (!user) return res!;
  const body = await req.json().catch(() => ({}));
  const admin = createAdminClient();

  if (body.projectId) {
    const { data } = await admin.from("ad_projects").select("id").eq("id", body.projectId).eq("user_id", user.id).maybeSingle();
    if (!data) return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
    const r = await syncProject(data.id, "manual");
    return NextResponse.json(r, { status: r.ok ? 200 : 502 });
  }

  const { data: projects } = await admin.from("ad_projects").select("id, name").eq("user_id", user.id).eq("status", "active");
  const results = [];
  for (const p of projects ?? []) results.push({ id: p.id, name: p.name, ...(await syncProject(p.id, "manual")) });
  return NextResponse.json({ ok: true, results });
}
