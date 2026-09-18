import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/meta/http";
import { createAdminClient } from "@/lib/supabase/server";
import { decideAction, proposeActions } from "@/lib/meta/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/meta/actions
 *   { id, decision: "approve" | "reject" }            → decide una acción
 *   { projectId, decision: "approve_all" }           → aprueba y ejecuta todas las propuestas
 *   { projectId, evaluate: true }                    → re-evalúa reglas ahora
 */
export async function POST(req: NextRequest) {
  const { user, res } = await requireUser();
  if (!user) return res!;
  const body = await req.json().catch(() => ({}));
  const admin = createAdminClient();

  if (body.id && (body.decision === "approve" || body.decision === "reject")) {
    const r = await decideAction(body.id, body.decision, user.id);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  if (body.projectId) {
    const { data: p } = await admin.from("ad_projects").select("id").eq("id", body.projectId).eq("user_id", user.id).maybeSingle();
    if (!p) return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });

    if (body.evaluate) {
      const r = await proposeActions(p.id);
      return NextResponse.json({ ok: true, ...r });
    }
    if (body.decision === "approve_all") {
      const { data: list } = await admin.from("ad_actions").select("id").eq("project_id", p.id).eq("status", "proposed");
      const results = [];
      for (const a of list ?? []) results.push({ id: a.id, ...(await decideAction(a.id, "approve", user.id)) });
      return NextResponse.json({ ok: true, results });
    }
  }
  return NextResponse.json({ error: "Petición inválida" }, { status: 400 });
}
