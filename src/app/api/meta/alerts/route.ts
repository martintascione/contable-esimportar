import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/meta/http";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** POST /api/meta/alerts { id, action: "dismiss" | "reopen" } */
export async function POST(req: NextRequest) {
  const { user, res } = await requireUser();
  if (!user) return res!;
  const { id, action } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
  const admin = createAdminClient();
  const { data: alert } = await admin.from("ad_alerts").select("id, project_id, ad_projects!inner(user_id)").eq("id", id).maybeSingle();
  if (!alert || (alert as any).ad_projects?.user_id !== user.id) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  const status = action === "reopen" ? "open" : "dismissed";
  const { error } = await admin.from("ad_alerts").update({ status, resolved_at: status === "open" ? null : new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
