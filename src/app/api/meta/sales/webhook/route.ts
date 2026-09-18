import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const SaleSchema = z.object({
  external_id: z.string().optional(),
  amount: z.number().nonnegative(),
  currency: z.string().optional(),
  occurred_at: z.string().optional(),
  meta: z.any().optional()
});
const BodySchema = z.union([SaleSchema, z.object({ sales: z.array(SaleSchema) })]);

/**
 * POST /api/meta/sales/webhook?project=<id>&token=<webhook_token>
 * Recibe ventas reales de otra base (p.ej. AIRISFIT) para calcular ROAS real.
 * Body: { external_id, amount, currency, occurred_at } o { sales: [...] }
 */
export async function POST(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("project");
  const token = req.nextUrl.searchParams.get("token") ?? req.headers.get("x-webhook-token");
  if (!projectId || !token) return NextResponse.json({ error: "Faltan project/token" }, { status: 400 });

  const admin = createAdminClient();
  const { data: project } = await admin.from("ad_projects").select("id, currency, webhook_token").eq("id", projectId).maybeSingle();
  if (!project || project.webhook_token !== token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Body inválido", issues: parsed.error.issues }, { status: 400 });
  const sales = "sales" in parsed.data ? parsed.data.sales : [parsed.data];

  const rows = sales.map(s => ({
    project_id: project.id,
    external_id: s.external_id ?? null,
    amount: s.amount,
    currency: s.currency ?? project.currency,
    occurred_at: s.occurred_at ?? new Date().toISOString(),
    source: "webhook",
    meta: s.meta ?? null
  }));
  const { error } = await admin.from("ad_sales").upsert(rows, { onConflict: "project_id,external_id", ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, received: rows.length });
}
