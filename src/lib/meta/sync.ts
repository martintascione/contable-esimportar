import { createAdminClient } from "@/lib/supabase/server";
import { getAccessToken, markConnectionError } from "./connection";
import { fetchInsights, listAds, listAdsets, listCampaigns, MetaApiError } from "./api";
import { normalizeInsight, type InsightRow } from "./insights";
import { computeAlerts } from "./alerts";
import { buildDailySummary, emailDailySummary, proposeActions } from "./actions";

const minor = (v: any) => (v == null || v === "" ? null : Number(v) / 100);
const iso = (d: Date) => d.toISOString().slice(0, 10);

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * Sincroniza un proyecto: estructura (campañas/conjuntos/anuncios) + insights diarios + alertas.
 * Primera vez: 30 días. Después: últimos 7 días (Meta reatribuye conversiones hacia atrás).
 */
export async function syncProject(projectId: string, trigger: "cron" | "manual" = "cron") {
  const admin = createAdminClient();
  const { data: project } = await admin.from("ad_projects").select("*").eq("id", projectId).maybeSingle();
  if (!project) throw new Error("Proyecto no encontrado");

  const { data: run } = await admin.from("ad_sync_runs")
    .insert({ project_id: projectId, trigger }).select("id").single();

  const stats: any = {};
  try {
    const conn = await getAccessToken(project.user_id);
    if (!conn) throw new Error("No hay conexión con Meta. Conectá Meta Ads primero.");
    const token = conn.token;
    const act = project.ad_account_id;

    // ---- Estructura ----
    const [campaigns, adsets, ads] = await Promise.all([
      listCampaigns(token, act), listAdsets(token, act), listAds(token, act)
    ]);
    stats.campaigns = campaigns.length; stats.adsets = adsets.length; stats.ads = ads.length;

    if (campaigns.length) await admin.from("ad_campaigns").upsert(campaigns.map((c: any) => ({
      id: c.id, project_id: projectId, name: c.name, status: c.status, effective_status: c.effective_status,
      objective: c.objective, daily_budget: minor(c.daily_budget), lifetime_budget: minor(c.lifetime_budget),
      created_time: c.created_time ?? null, raw: c, updated_at: new Date().toISOString()
    })), { onConflict: "id" });

    if (adsets.length) await admin.from("ad_adsets").upsert(adsets.map((a: any) => ({
      id: a.id, project_id: projectId, campaign_id: a.campaign_id ?? null, name: a.name, status: a.status,
      effective_status: a.effective_status, daily_budget: minor(a.daily_budget), lifetime_budget: minor(a.lifetime_budget),
      optimization_goal: a.optimization_goal ?? null, learning_stage: a.learning_stage_info?.status ?? null,
      created_time: a.created_time ?? null, raw: a, updated_at: new Date().toISOString()
    })), { onConflict: "id" });

    if (ads.length) await admin.from("ad_ads").upsert(ads.map((a: any) => ({
      id: a.id, project_id: projectId, adset_id: a.adset_id ?? null, campaign_id: a.campaign_id ?? null,
      name: a.name, status: a.status, effective_status: a.effective_status,
      creative_id: a.creative?.id ?? null, thumbnail_url: a.creative?.thumbnail_url ?? null,
      created_time: a.created_time ?? null, raw: a, updated_at: new Date().toISOString()
    })), { onConflict: "id" });

    // ---- Insights ----
    const today = new Date();
    const since = new Date(today);
    since.setUTCDate(today.getUTCDate() - (project.last_sync_at ? 7 : 30));
    const range = { since: iso(since), until: iso(today) };
    stats.range = range;

    let inserted = 0;
    for (const level of ["campaign", "adset", "ad"] as const) {
      const raw = await fetchInsights(token, act, level, range.since, range.until);
      const rows = raw.map(r => ({ ...normalizeInsight(r, level, project.result_action_type), project_id: projectId }))
        .filter(r => r.entity_id && r.entity_id !== "undefined");
      for (const part of chunk(rows, 500)) {
        const { error } = await admin.from("ad_insights_daily")
          .upsert(part.map(r => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: "project_id,level,entity_id,date" });
        if (error) throw new Error("insights upsert: " + error.message);
        inserted += part.length;
      }
    }
    stats.insight_rows = inserted;

    // ---- Alertas (sobre los últimos 14 días en base) ----
    const d14 = new Date(today); d14.setUTCDate(today.getUTCDate() - 14);
    const { data: recent } = await admin.from("ad_insights_daily")
      .select("*").eq("project_id", projectId).gte("date", iso(d14));
    const drafts = computeAlerts(
      { id: projectId, name: project.name, currency: project.currency, goal_type: project.goal_type, goal_value: project.goal_value },
      (recent ?? []) as InsightRow[],
      ads.map((a: any) => ({ id: a.id, name: a.name, effective_status: a.effective_status })),
      adsets.map((a: any) => ({ id: a.id, name: a.name, effective_status: a.effective_status }))
    );

    const { data: open } = await admin.from("ad_alerts")
      .select("id, type, entity_id").eq("project_id", projectId).eq("status", "open");
    const still = new Set(drafts.map(d => `${d.type}:${d.entity_id}`));
    const toResolve = (open ?? []).filter((o: any) => !still.has(`${o.type}:${o.entity_id}`)).map((o: any) => o.id);
    if (toResolve.length) await admin.from("ad_alerts")
      .update({ status: "resolved", resolved_at: new Date().toISOString() }).in("id", toResolve);

    const { data: dismissed } = await admin.from("ad_alerts")
      .select("type, entity_id").eq("project_id", projectId).eq("status", "dismissed");
    const skip = new Set((dismissed ?? []).map((d: any) => `${d.type}:${d.entity_id}`));
    const fresh = drafts.filter(d => !skip.has(`${d.type}:${d.entity_id}`));
    if (fresh.length) await admin.from("ad_alerts")
      .upsert(fresh.map(d => ({ ...d, status: "open" })), { onConflict: "project_id,type,entity_id,status", ignoreDuplicates: true });
    stats.alerts = fresh.length;

    // ---- Reglas → acciones (Etapas 2/3) ----
    try {
      stats.actions = await proposeActions(projectId);
    } catch (e: any) { stats.actions_error = e?.message ?? String(e); }

    // ---- Resumen diario: una vez por día, en la primera corrida después de las 8:00 (hora del proyecto) ----
    try {
      const tz = project.timezone || "America/Argentina/Buenos_Aires";
      const localHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date()));
      const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
      if (localHour >= 8) {
        const { data: existing } = await admin.from("ad_daily_summaries").select("id").eq("project_id", projectId).eq("date", localDate).maybeSingle();
        if (!existing) { await buildDailySummary(projectId, localDate); stats.summary = await emailDailySummary(projectId, localDate); }
      }
    } catch (e: any) { stats.summary_error = e?.message ?? String(e); }

    await admin.from("ad_projects").update({
      last_sync_at: new Date().toISOString(), last_sync_error: null, updated_at: new Date().toISOString()
    }).eq("id", projectId);
    await admin.from("ad_sync_runs").update({ finished_at: new Date().toISOString(), ok: true, stats }).eq("id", run?.id);
    return { ok: true, stats };
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const expired = e instanceof MetaApiError && (e.code === 190 || e.status === 401);
    if (expired) await markConnectionError(project.user_id, msg, true);
    await admin.from("ad_projects").update({ last_sync_error: msg, updated_at: new Date().toISOString() }).eq("id", projectId);
    await admin.from("ad_sync_runs").update({ finished_at: new Date().toISOString(), ok: false, stats, error: msg }).eq("id", run?.id);
    return { ok: false, error: msg, stats };
  }
}

/** Sincroniza todos los proyectos activos (cron horario). */
export async function syncAllProjects(trigger: "cron" | "manual" = "cron") {
  const admin = createAdminClient();
  const { data: projects } = await admin.from("ad_projects").select("id, name").eq("status", "active");
  const results: any[] = [];
  for (const p of projects ?? []) {
    const r = await syncProject(p.id, trigger);
    results.push({ id: p.id, name: p.name, ...r });
  }
  return results;
}
