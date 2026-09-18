import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/meta/http";
import { createAdminClient } from "@/lib/supabase/server";
import { getRules } from "@/lib/meta/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RuleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  mode: z.enum(["manual", "auto"]).optional(),
  config: z.record(z.any()).optional()
});

async function ownProject(userId: string, projectId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("ad_projects").select("id").eq("id", projectId).eq("user_id", userId).maybeSingle();
  return !!data;
}

/** GET /api/meta/rules?project=… */
export async function GET(req: NextRequest) {
  const { user, res } = await requireUser();
  if (!user) return res!;
  const projectId = req.nextUrl.searchParams.get("project");
  if (!projectId || !(await ownProject(user.id, projectId))) return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true, rules: await getRules(projectId) });
}

/** PUT /api/meta/rules { projectId, rules: [{ id, enabled, mode, config, name }] } */
export async function PUT(req: NextRequest) {
  const { user, res } = await requireUser();
  if (!user) return res!;
  const body = await req.json().catch(() => ({}));
  const parsed = z.object({ projectId: z.string().uuid(), rules: z.array(RuleSchema) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos", issues: parsed.error.issues }, { status: 400 });
  if (!(await ownProject(user.id, parsed.data.projectId))) return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });

  const admin = createAdminClient();
  for (const r of parsed.data.rules) {
    const { id, ...patch } = r;
    await admin.from("ad_rules").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).eq("project_id", parsed.data.projectId);
  }
  return NextResponse.json({ ok: true, rules: await getRules(parsed.data.projectId) });
}
