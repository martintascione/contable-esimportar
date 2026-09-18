import { createAdminClient } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";
import { getConnection } from "@/lib/meta/connection";
import { getSecret } from "@/lib/secrets";
import { AdsClient } from "@/components/modules/AdsClient";

export const dynamic = "force-dynamic";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function AdsPage({ searchParams }: { searchParams: { p?: string; error?: string; connected?: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();
  const [connection, projectsRes, appId] = await Promise.all([
    getConnection(user.id),
    admin.from("ad_projects").select("*").eq("user_id", user.id).order("created_at", { ascending: true }),
    getSecret("META_APP_ID")
  ]);
  const projects = (projectsRes.data ?? []) as any[];

  const since30 = new Date(); since30.setUTCDate(since30.getUTCDate() - 30);
  const since = iso(since30);

  // Selección: ?p=<id> | "all" | (default) primer proyecto, o "all" si hay varios
  let selected: string = searchParams.p ?? (projects.length > 1 ? "all" : projects[0]?.id ?? "all");
  if (selected !== "all" && !projects.some(p => p.id === selected)) selected = projects[0]?.id ?? "all";

  let campaigns: any[] = [], adsets: any[] = [], ads: any[] = [], insights: any[] = [], alerts: any[] = [], lastRun: any = null;
  let overview: any[] = [];
  let actions: any[] = [], rules: any[] = [], summary: any = null, pendingByProject: Record<string, number> = {};

  if (selected !== "all") {
    const d30 = new Date(); d30.setUTCDate(d30.getUTCDate() - 30);
    const [c, s, a, i, al, r, ac, ru, su] = await Promise.all([
      admin.from("ad_campaigns").select("id, name, status, effective_status, objective, daily_budget, lifetime_budget").eq("project_id", selected).order("name"),
      admin.from("ad_adsets").select("id, campaign_id, name, status, effective_status, daily_budget, lifetime_budget, optimization_goal, learning_stage").eq("project_id", selected).order("name"),
      admin.from("ad_ads").select("id, adset_id, campaign_id, name, status, effective_status, thumbnail_url").eq("project_id", selected).order("name"),
      admin.from("ad_insights_daily")
        .select("level, entity_id, date, spend, impressions, reach, clicks, link_clicks, frequency, results, result_type, purchases, purchase_value")
        .eq("project_id", selected).gte("date", since).order("date"),
      admin.from("ad_alerts").select("*").eq("project_id", selected).eq("status", "open").order("created_at", { ascending: false }),
      admin.from("ad_sync_runs").select("*").eq("project_id", selected).order("started_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("ad_actions").select("*").eq("project_id", selected).gte("proposed_at", d30.toISOString()).order("proposed_at", { ascending: false }).limit(200),
      admin.from("ad_rules").select("*").eq("project_id", selected).order("created_at"),
      admin.from("ad_daily_summaries").select("date, text, content, emailed_at").eq("project_id", selected).order("date", { ascending: false }).limit(1).maybeSingle()
    ]);
    campaigns = c.data ?? []; adsets = s.data ?? []; ads = a.data ?? []; insights = i.data ?? []; alerts = al.data ?? []; lastRun = r.data;
    actions = ac.data ?? []; rules = ru.data ?? []; summary = su.data ?? null;
  } else if (projects.length) {
    const ids = projects.map(p => p.id);
    const [i, al, pend] = await Promise.all([
      admin.from("ad_insights_daily")
        .select("project_id, date, spend, impressions, reach, clicks, link_clicks, results, purchases, purchase_value")
        .in("project_id", ids).eq("level", "campaign").gte("date", since),
      admin.from("ad_alerts").select("project_id, severity").in("project_id", ids).eq("status", "open"),
      admin.from("ad_actions").select("project_id").in("project_id", ids).eq("status", "proposed")
    ]);
    overview = i.data ?? [];
    alerts = al.data ?? [];
    for (const row of pend.data ?? []) pendingByProject[row.project_id] = (pendingByProject[row.project_id] ?? 0) + 1;
  }

  return (
    <AdsClient
      user={{ id: user.id }}
      connection={connection}
      appConfigured={!!appId}
      projects={projects}
      selected={selected}
      campaigns={campaigns}
      adsets={adsets}
      ads={ads}
      insights={insights}
      overview={overview}
      alerts={alerts}
      lastRun={lastRun}
      actions={actions}
      rules={rules}
      summary={summary}
      pendingByProject={pendingByProject}
      flash={{ error: searchParams.error ?? null, connected: searchParams.connected === "1" }}
    />
  );
}
