import { createAdminClient } from "@/lib/supabase/server";
import { getAccessToken } from "./connection";
import { updateDailyBudget, updateStatus } from "./api";
import { DEFAULT_RULES, evaluateRules, type Rule, type ProjectCtx, type Entities, type PastAction } from "./rules";
import type { InsightRow } from "./insights";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Reglas del proyecto; si no tiene, se crean las por defecto. */
export async function getRules(projectId: string): Promise<Rule[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("ad_rules").select("*").eq("project_id", projectId).order("created_at");
  if (data && data.length) return data as Rule[];
  const seed = DEFAULT_RULES.map(r => ({ ...r, project_id: projectId }));
  const { data: created } = await admin.from("ad_rules").insert(seed).select("*");
  return (created ?? []) as Rule[];
}

/**
 * Evalúa las reglas del proyecto y crea acciones propuestas.
 * En modo auto, las reglas marcadas "auto" se ejecutan en el acto.
 */
export async function proposeActions(projectId: string) {
  const admin = createAdminClient();
  const { data: project } = await admin.from("ad_projects").select("*").eq("id", projectId).maybeSingle();
  if (!project || project.automation_mode === "off") return { proposed: 0, executed: 0, failed: 0 };

  const d14 = new Date(); d14.setUTCDate(d14.getUTCDate() - 14);
  const d30 = new Date(); d30.setUTCDate(d30.getUTCDate() - 30);
  const [rules, ins, camps, sets, ads, past] = await Promise.all([
    getRules(projectId),
    admin.from("ad_insights_daily").select("*").eq("project_id", projectId).gte("date", iso(d14)),
    admin.from("ad_campaigns").select("id, name, effective_status, daily_budget").eq("project_id", projectId),
    admin.from("ad_adsets").select("id, name, campaign_id, effective_status, daily_budget, learning_stage").eq("project_id", projectId),
    admin.from("ad_ads").select("id, name, adset_id, effective_status").eq("project_id", projectId),
    admin.from("ad_actions").select("type, level, entity_id, status, executed_by, proposed_at, executed_at").eq("project_id", projectId).gte("proposed_at", d30.toISOString())
  ]);

  // Propuestas viejas sin decidir pierden vigencia (48 h)
  const stale = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  await admin.from("ad_actions").update({ status: "expired", decided_at: new Date().toISOString() })
    .eq("project_id", projectId).eq("status", "proposed").lt("proposed_at", stale);

  const ctx: ProjectCtx = {
    id: project.id, currency: project.currency, goal_type: project.goal_type, goal_value: project.goal_value,
    min_daily_budget: project.min_daily_budget, max_daily_budget: project.max_daily_budget, automation_mode: project.automation_mode
  };
  const ents: Entities = {
    campaigns: (camps.data ?? []).map((c: any) => ({ ...c, daily_budget: c.daily_budget != null ? Number(c.daily_budget) : null })),
    adsets: (sets.data ?? []).map((a: any) => ({ ...a, daily_budget: a.daily_budget != null ? Number(a.daily_budget) : null })),
    ads: (ads.data ?? []) as any
  };
  const drafts = evaluateRules(ctx, rules, (ins.data ?? []) as InsightRow[], ents, (past.data ?? []) as PastAction[]);

  // No duplicar propuestas abiertas sobre la misma entidad
  const { data: open } = await admin.from("ad_actions").select("entity_id, type").eq("project_id", projectId).in("status", ["proposed", "approved"]);
  const openKeys = new Set((open ?? []).map((o: any) => `${o.type}:${o.entity_id}`));
  const fresh = drafts.filter(d => !openKeys.has(`${d.type}:${d.entity_id}`));
  if (!fresh.length) return { proposed: 0, executed: 0, failed: 0 };

  const { data: inserted } = await admin.from("ad_actions").insert(fresh.map(d => ({
    project_id: d.project_id, rule_id: d.rule_id, rule_type: d.rule_type, type: d.type, level: d.level,
    entity_id: d.entity_id, entity_name: d.entity_name, payload: d.payload, reason: d.reason,
    status: d.auto ? "approved" : "proposed", proposed_at: new Date().toISOString(),
    decided_at: d.auto ? new Date().toISOString() : null,
    expires_at: d.auto ? null : new Date(Date.now() + 48 * 3600 * 1000).toISOString()
  }))).select("id, status");

  let executed = 0, failed = 0;
  for (const a of (inserted ?? []).filter((x: any) => x.status === "approved")) {
    const r = await executeAction(a.id, "auto");
    if (r.ok) executed++; else failed++;
  }
  return { proposed: fresh.length - executed - failed, executed, failed };
}

/** Ejecuta una acción aprobada contra la API de Meta y registra el resultado. */
export async function executeAction(actionId: string, by: "user" | "auto") {
  const admin = createAdminClient();
  const { data: a } = await admin.from("ad_actions").select("*, ad_projects!inner(user_id, currency)").eq("id", actionId).maybeSingle();
  if (!a) return { ok: false, error: "Acción no encontrada" };
  if (!["approved", "proposed"].includes(a.status)) return { ok: false, error: `La acción está en estado ${a.status}` };

  try {
    const conn = await getAccessToken((a as any).ad_projects.user_id);
    if (!conn) throw new Error("Sin conexión con Meta");
    let result: any;
    if (a.type === "pause") result = await updateStatus(conn.token, a.entity_id, "PAUSED");
    else if (a.type === "activate") result = await updateStatus(conn.token, a.entity_id, "ACTIVE");
    else if (a.type === "set_budget") {
      const next = Number(a.payload?.daily_budget);
      if (!next || next <= 0) throw new Error("Presupuesto inválido");
      result = await updateDailyBudget(conn.token, a.entity_id, next * 100); // Meta usa unidades menores
    } else throw new Error(`Tipo de acción desconocido: ${a.type}`);

    // Reflejar en nuestro espejo para no esperar al próximo sync
    const table = a.level === "ad" ? "ad_ads" : a.level === "adset" ? "ad_adsets" : "ad_campaigns";
    if (a.type === "set_budget") await admin.from(table).update({ daily_budget: a.payload.daily_budget }).eq("id", a.entity_id);
    else await admin.from(table).update({ status: a.type === "pause" ? "PAUSED" : "ACTIVE", effective_status: a.type === "pause" ? "PAUSED" : "ACTIVE" }).eq("id", a.entity_id);

    await admin.from("ad_actions").update({
      status: "executed", executed_at: new Date().toISOString(), executed_by: by, result: result ?? { ok: true }, error: null,
      decided_at: a.decided_at ?? new Date().toISOString()
    }).eq("id", actionId);
    return { ok: true };
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    await admin.from("ad_actions").update({ status: "failed", executed_at: new Date().toISOString(), executed_by: by, error: msg }).eq("id", actionId);
    return { ok: false, error: msg };
  }
}

export async function decideAction(actionId: string, decision: "approve" | "reject", userId: string) {
  const admin = createAdminClient();
  const { data: a } = await admin.from("ad_actions").select("id, status, ad_projects!inner(user_id)").eq("id", actionId).maybeSingle();
  if (!a || (a as any).ad_projects.user_id !== userId) return { ok: false, error: "No encontrada" };
  if (a.status !== "proposed") return { ok: false, error: `Ya está ${a.status}` };
  if (decision === "reject") {
    await admin.from("ad_actions").update({ status: "rejected", decided_at: new Date().toISOString() }).eq("id", actionId);
    return { ok: true };
  }
  await admin.from("ad_actions").update({ status: "approved", decided_at: new Date().toISOString() }).eq("id", actionId);
  return executeAction(actionId, "user");
}

// ---------------- Resumen diario ----------------

export async function buildDailySummary(projectId: string, date = iso(new Date())) {
  const admin = createAdminClient();
  const { data: project } = await admin.from("ad_projects").select("*").eq("id", projectId).maybeSingle();
  if (!project) return null;
  const dayStart = new Date(date + "T00:00:00Z"); const dayEnd = new Date(dayStart.getTime() + 86400000);
  const yday = iso(new Date(dayStart.getTime() - 86400000));

  const [ins, acts, alerts] = await Promise.all([
    admin.from("ad_insights_daily").select("spend, results, purchases, purchase_value").eq("project_id", projectId).eq("level", "campaign").eq("date", yday),
    admin.from("ad_actions").select("type, level, entity_name, payload, reason, status, executed_by").eq("project_id", projectId)
      .gte("proposed_at", new Date(dayStart.getTime() - 86400000).toISOString()).lt("proposed_at", dayEnd.toISOString()),
    admin.from("ad_alerts").select("id").eq("project_id", projectId).eq("status", "open")
  ]);
  const rows = ins.data ?? [];
  const spend = rows.reduce((s: number, r: any) => s + Number(r.spend), 0);
  const results = rows.reduce((s: number, r: any) => s + Number(r.results), 0);
  const value = rows.reduce((s: number, r: any) => s + Number(r.purchase_value), 0);
  const cur = project.currency;
  const money = (n: number | null) => n == null ? "—" : new Intl.NumberFormat("es-AR", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(n);

  const executed = (acts.data ?? []).filter((a: any) => a.status === "executed");
  const proposed = (acts.data ?? []).filter((a: any) => a.status === "proposed");
  const failed = (acts.data ?? []).filter((a: any) => a.status === "failed");
  const describe = (a: any) =>
    a.type === "pause" ? `Pausado: ${a.entity_name}` :
    a.type === "activate" ? `Reactivado: ${a.entity_name}` :
    `Presupuesto ${a.payload?.pct > 0 ? "+" : ""}${a.payload?.pct}% en ${a.entity_name}: ${money(Number(a.payload?.from_daily_budget))} → ${money(Number(a.payload?.daily_budget))}/día`;

  const lines = [
    `${project.name} · resumen del ${yday}`,
    `Gasto ${money(spend)} · ${results} resultados · costo por resultado ${money(results ? spend / results : null)}${value ? ` · ROAS ${(value / spend).toFixed(2)}x` : ""}`,
    executed.length ? `Acciones ejecutadas (${executed.length}):\n${executed.map((a: any) => `  • ${describe(a)} — ${a.reason}`).join("\n")}` : "Sin acciones ejecutadas.",
    proposed.length ? `Pendientes de aprobación (${proposed.length}):\n${proposed.map((a: any) => `  • ${describe(a)}`).join("\n")}` : "",
    failed.length ? `Fallidas (${failed.length}): ${failed.map((a: any) => a.entity_name).join(", ")}` : "",
    `${(alerts.data ?? []).length} alertas abiertas.`
  ].filter(Boolean);

  const content = { spend, results, cpa: results ? spend / results : null, roas: value && spend ? value / spend : null, executed, proposed, failed, alerts: (alerts.data ?? []).length };
  await admin.from("ad_daily_summaries").upsert({ project_id: projectId, date, content, text: lines.join("\n") }, { onConflict: "project_id,date" });
  return { content, text: lines.join("\n"), project };
}

/** Envía el resumen por email (Resend) si hay API key y destinatario. */
export async function emailDailySummary(projectId: string, date = iso(new Date())) {
  const { getSecret } = await import("@/lib/secrets");
  const key = await getSecret("RESEND_API_KEY");
  if (!key) return { sent: false, reason: "sin RESEND_API_KEY" };
  const admin = createAdminClient();
  const { data: s } = await admin.from("ad_daily_summaries").select("id, text, emailed_at, ad_projects!inner(name, notify_email, user_id)").eq("project_id", projectId).eq("date", date).maybeSingle();
  if (!s || s.emailed_at) return { sent: false, reason: "ya enviado o sin resumen" };
  const p: any = (s as any).ad_projects;
  let to = p.notify_email;
  if (!to) {
    const { data: u } = await admin.auth.admin.getUserById(p.user_id);
    to = u?.user?.email;
  }
  if (!to) return { sent: false, reason: "sin destinatario" };
  const from = (await getSecret("RESEND_FROM")) || "Meta Ads <onboarding@resend.dev>";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject: `Meta Ads · ${p.name} · resumen diario`, text: s.text })
  });
  if (!r.ok) return { sent: false, reason: `Resend HTTP ${r.status}` };
  await admin.from("ad_daily_summaries").update({ emailed_at: new Date().toISOString() }).eq("id", s.id);
  return { sent: true };
}
