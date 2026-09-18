import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/meta/http";
import { createAdminClient } from "@/lib/supabase/server";
import { buildDailySummary, emailDailySummary } from "@/lib/meta/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/meta/summary { projectId, email?: boolean } — genera (y opcionalmente envía) el resumen de hoy. */
export async function POST(req: NextRequest) {
  const { user, res } = await requireUser();
  if (!user) return res!;
  const { projectId, email } = await req.json().catch(() => ({}));
  const admin = createAdminClient();
  const { data: p } = await admin.from("ad_projects").select("id").eq("id", projectId ?? "").eq("user_id", user.id).maybeSingle();
  if (!p) return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  const s = await buildDailySummary(p.id);
  const mail = email ? await emailDailySummary(p.id) : null;
  return NextResponse.json({ ok: true, text: s?.text ?? null, content: s?.content ?? null, mail });
}
