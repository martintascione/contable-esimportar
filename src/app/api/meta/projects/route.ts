import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/meta/http";
import { createAdminClient } from "@/lib/supabase/server";
import { getConnection } from "@/lib/meta/connection";
import { randomToken } from "@/lib/crypto";
import { syncProject } from "@/lib/meta/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  name: z.string().min(1).max(80),
  ad_account_id: z.string().regex(/^act_\d+$/),
  ad_account_name: z.string().optional().nullable(),
  business_name: z.string().optional().nullable(),
  currency: z.string().min(3).max(3),
  timezone: z.string().optional().nullable(),
  pixel_id: z.string().optional().nullable(),
  goal_type: z.enum(["cpa", "roas"]).default("cpa"),
  goal_value: z.number().positive().optional().nullable(),
  result_action_type: z.string().optional().nullable()
});

const UpdateSchema = CreateSchema.partial().extend({
  id: z.string().uuid(),
  automation_mode: z.enum(["off", "manual", "auto"]).optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
  sales_source: z.enum(["meta", "webhook"]).optional(),
  regenerate_webhook_token: z.boolean().optional(),
  min_daily_budget: z.number().positive().optional().nullable(),
  max_daily_budget: z.number().positive().optional().nullable(),
  notify_email: z.string().email().optional().nullable()
});

/** POST /api/meta/projects — crea un proyecto y dispara la primera sincronización. */
export async function POST(req: NextRequest) {
  const { user, res } = await requireUser();
  if (!user) return res!;
  const body = CreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "Datos inválidos", issues: body.error.issues }, { status: 400 });

  const conn = await getConnection(user.id);
  const admin = createAdminClient();
  const { data, error } = await admin.from("ad_projects").insert({
    ...body.data,
    user_id: user.id,
    connection_id: conn?.id ?? null,
    webhook_token: randomToken(24)
  }).select("*").single();
  if (error) {
    const msg = error.code === "23505" ? "Ya existe un proyecto para esa cuenta publicitaria." : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Primera sincronización (30 días) en el mismo request.
  const sync = await syncProject(data.id, "manual");
  return NextResponse.json({ ok: true, project: data, sync });
}

/** PATCH /api/meta/projects — actualiza objetivo, estado, automatización, etc. */
export async function PATCH(req: NextRequest) {
  const { user, res } = await requireUser();
  if (!user) return res!;
  const body = UpdateSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "Datos inválidos", issues: body.error.issues }, { status: 400 });
  const { id, regenerate_webhook_token, ...rest } = body.data;
  const patch: any = { ...rest, updated_at: new Date().toISOString() };
  if (regenerate_webhook_token) patch.webhook_token = randomToken(24);

  const admin = createAdminClient();
  const { data, error } = await admin.from("ad_projects").update(patch)
    .eq("id", id).eq("user_id", user.id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, project: data });
}

/** DELETE /api/meta/projects?id=… — elimina el proyecto y todos sus datos. */
export async function DELETE(req: NextRequest) {
  const { user, res } = await requireUser();
  if (!user) return res!;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
  const admin = createAdminClient();
  const { error } = await admin.from("ad_projects").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
