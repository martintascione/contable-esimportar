"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/ui/Topbar";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icons";
import { AdsChart } from "@/components/ui/AdsChart";
import { ActionsCard, AutomationSwitch, RulesCard, SummaryCard, type Action, type Rule, type Summary } from "./AdsAutomation";

// ---------- Tipos ----------
type Connection = { id: string; meta_user_name: string | null; status: string; last_error: string | null; token_expires_at: string | null } | null;
type Project = {
  id: string; name: string; ad_account_id: string; ad_account_name: string | null; business_name: string | null;
  currency: string; pixel_id: string | null; goal_type: "cpa" | "roas"; goal_value: number | null;
  result_action_type: string | null; automation_mode: string; status: string; sales_source: string;
  webhook_token: string | null; last_sync_at: string | null; last_sync_error: string | null;
  min_daily_budget: number | null; max_daily_budget: number | null; notify_email: string | null;
};
type Row = { level?: string; entity_id?: string; project_id?: string; date: string; spend: number; impressions: number; reach: number; clicks: number; link_clicks: number; frequency?: number | null; results: number; result_type?: string | null; purchases: number; purchase_value: number };
type Alert = { id: string; type: string; severity: string; level: string; entity_id: string; entity_name: string | null; message: string; created_at: string; project_id?: string };

type Props = {
  user: { id: string };
  connection: Connection;
  appConfigured: boolean;
  projects: Project[];
  selected: string;
  campaigns: any[]; adsets: any[]; ads: any[];
  insights: Row[];
  overview: Row[];
  alerts: Alert[];
  lastRun: any;
  actions: Action[];
  rules: Rule[];
  summary: Summary;
  pendingByProject: Record<string, number>;
  flash: { error: string | null; connected: boolean };
};

// ---------- Helpers ----------
function agg(rows: Row[]) {
  const s = rows.reduce((a, r) => ({
    spend: a.spend + Number(r.spend || 0), impressions: a.impressions + Number(r.impressions || 0),
    reach: a.reach + Number(r.reach || 0), clicks: a.clicks + Number(r.clicks || 0),
    link_clicks: a.link_clicks + Number(r.link_clicks || 0), results: a.results + Number(r.results || 0),
    purchases: a.purchases + Number(r.purchases || 0), purchase_value: a.purchase_value + Number(r.purchase_value || 0)
  }), { spend: 0, impressions: 0, reach: 0, clicks: 0, link_clicks: 0, results: 0, purchases: 0, purchase_value: 0 });
  return {
    ...s,
    cpm: s.impressions ? s.spend / s.impressions * 1000 : null,
    ctr: s.impressions ? s.clicks / s.impressions * 100 : null,
    cpc: s.clicks ? s.spend / s.clicks : null,
    cpr: s.results ? s.spend / s.results : null,
    roas: s.spend && s.purchase_value ? s.purchase_value / s.spend : null,
    freq: s.reach ? s.impressions / s.reach : null
  };
}
function money(n: number | null | undefined, cur: string, dec = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  try { return new Intl.NumberFormat("es-AR", { style: "currency", currency: cur || "USD", maximumFractionDigits: dec }).format(n); }
  catch { return `${cur} ${n.toFixed(dec)}`; }
}
const num = (n: number | null | undefined, dec = 0) => n == null || !Number.isFinite(n) ? "—" : new Intl.NumberFormat("es-AR", { maximumFractionDigits: dec }).format(n);
const pct = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(2)}%`;
function sinceDate(days: number) { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - days + 1); return d.toISOString().slice(0, 10); }
function timeAgo(s: string | null) {
  if (!s) return "nunca";
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 1) return "recién"; if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60); if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}
const statusTone = (s?: string | null): BadgeTone => s === "ACTIVE" ? "success" : s === "PAUSED" || s === "CAMPAIGN_PAUSED" || s === "ADSET_PAUSED" ? "default" : s ? "warning" : "default";
const statusLabel = (s?: string | null) => s === "ACTIVE" ? "Activo" : s === "PAUSED" ? "Pausado" : s === "CAMPAIGN_PAUSED" ? "Campaña pausada" : s === "ADSET_PAUSED" ? "Conjunto pausado" : s === "IN_PROCESS" ? "En proceso" : s === "WITH_ISSUES" ? "Con problemas" : s ?? "—";
const ALERT_META: Record<string, { label: string; tone: BadgeTone }> = {
  spend_no_results: { label: "Gasto sin resultados", tone: "danger" },
  cpa_above_goal:   { label: "Sobre el objetivo",    tone: "warning" },
  winner:           { label: "Ganador",              tone: "success" },
  creative_fatigue: { label: "Fatiga de creativo",   tone: "warning" }
};
const RESULT_LABEL: Record<string, string> = {
  purchase: "Compras", omni_purchase: "Compras", "offsite_conversion.fb_pixel_purchase": "Compras",
  lead: "Leads", "onsite_conversion.lead_grouped": "Leads", "offsite_conversion.fb_pixel_lead": "Leads",
  complete_registration: "Registros", "onsite_conversion.messaging_conversation_started_7d": "Conversaciones",
  initiate_checkout: "Checkouts", add_to_cart: "Carritos", landing_page_view: "Visitas", link_click: "Clics en enlace"
};

// ---------- Componente ----------
export function AdsClient(p: Props) {
  const router = useRouter();
  const project = p.selected === "all" ? null : p.projects.find(x => x.id === p.selected) ?? null;
  const [period, setPeriod] = useState<7 | 14 | 30>(7);
  const [tab, setTab] = useState<"campaign" | "adset" | "ad">("campaign");
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(
    p.flash.error ? { kind: "error", text: p.flash.error } : p.flash.connected ? { kind: "ok", text: "Meta Ads conectado. Ahora creá un proyecto por cada cuenta publicitaria." } : null
  );
  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>(p.alerts);
  useEffect(() => setAlerts(p.alerts), [p.alerts]);

  const since = sinceDate(period);
  const rows = useMemo(() => p.insights.filter(r => r.date >= since), [p.insights, since]);
  const cur = project?.currency ?? "USD";

  // KPI del proyecto (nivel campaña para no duplicar)
  const totals = useMemo(() => agg(rows.filter(r => r.level === "campaign")), [rows]);
  const prevRows = useMemo(() => {
    const s2 = sinceDate(period * 2);
    return p.insights.filter(r => r.level === "campaign" && r.date >= s2 && r.date < since);
  }, [p.insights, period, since]);
  const prev = useMemo(() => agg(prevRows), [prevRows]);
  const delta = (a: number | null, b: number | null) => a != null && b ? ((a - b) / b) * 100 : null;

  const daily = useMemo(() => {
    const m = new Map<string, { spend: number; results: number }>();
    for (let i = period - 1; i >= 0; i--) { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - i); m.set(d.toISOString().slice(0, 10), { spend: 0, results: 0 }); }
    for (const r of rows) if (r.level === "campaign" && m.has(r.date)) { const e = m.get(r.date)!; e.spend += Number(r.spend); e.results += Number(r.results); }
    return [...m.entries()].map(([date, v]) => ({ date, ...v }));
  }, [rows, period]);

  const resultLabel = useMemo(() => {
    const t = rows.find(r => r.result_type)?.result_type ?? project?.result_action_type;
    return t ? RESULT_LABEL[t] ?? "Resultados" : "Resultados";
  }, [rows, project]);

  // Tabla por nivel
  const tableRows = useMemo(() => {
    const ents = tab === "campaign" ? p.campaigns : tab === "adset" ? p.adsets : p.ads;
    const by = new Map<string, Row[]>();
    for (const r of rows) if (r.level === tab) { if (!by.has(r.entity_id!)) by.set(r.entity_id!, []); by.get(r.entity_id!)!.push(r); }
    return ents.map((e: any) => ({ e, m: agg(by.get(e.id) ?? []) }))
      .sort((a, b) => (b.m.spend - a.m.spend) || ((a.e.effective_status === "ACTIVE" ? 0 : 1) - (b.e.effective_status === "ACTIVE" ? 0 : 1)));
  }, [tab, p.campaigns, p.adsets, p.ads, rows]);

  // Vista "Todos"
  const overviewCards = useMemo(() => p.projects.map(pr => {
    const mine = p.overview.filter(r => r.project_id === pr.id && r.date >= since);
    const m = agg(mine);
    const nAlerts = alerts.filter(a => a.project_id === pr.id).length;
    const danger = alerts.some(a => a.project_id === pr.id && a.severity === "danger");
    return { pr, m, nAlerts, danger };
  }), [p.projects, p.overview, since, alerts]);

  async function sync(projectId?: string) {
    setSyncing(true); setMsg(null);
    try {
      const r = await fetch("/api/meta/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }) });
      const j = await r.json();
      if (!r.ok || j.ok === false) throw new Error(j.error ?? "Error al sincronizar");
      setMsg({ kind: "ok", text: "Sincronización completa." });
      router.refresh();
    } catch (e: any) { setMsg({ kind: "error", text: e.message }); }
    finally { setSyncing(false); }
  }
  async function disconnect() {
    if (!confirm("¿Desconectar Meta Ads? Los proyectos y su historial se conservan.")) return;
    await fetch("/api/meta/disconnect", { method: "POST" });
    router.refresh();
  }
  async function dismiss(id: string) {
    setAlerts(a => a.filter(x => x.id !== id));
    await fetch("/api/meta/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "dismiss" }) });
  }
  const select = (id: string) => router.push(`/ads?p=${id}`);

  const connected = !!p.connection && p.connection.status === "connected";

  return (
    <>
      <Topbar
        title="Meta Ads"
        subtitle={connected ? `Conectado como ${p.connection?.meta_user_name ?? "Meta"}${project ? ` · sync ${timeAgo(project.last_sync_at)}` : ""}` : "Administración y automatización de campañas"}
        right={
          <div className="hidden md:flex items-center gap-2">
            {connected && p.projects.length > 0 && (
              <button className="btn btn-ghost" onClick={() => sync(project?.id)} disabled={syncing}>
                <Icon.Refresh /> {syncing ? "Sincronizando…" : "Sincronizar"}
              </button>
            )}
            {connected && (
              <button className="btn btn-primary" onClick={() => setShowNew(true)}><Icon.Plus /> Nuevo proyecto</button>
            )}
          </div>
        }
      />

      <div className="p-4 md:p-8 space-y-5">
        {msg && (
          <div className={`rounded-xl px-4 py-3 text-[13px] flex items-start justify-between gap-3 ${msg.kind === "ok" ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"}`}>
            <span>{msg.text}</span>
            <button onClick={() => setMsg(null)} className="opacity-70 hover:opacity-100"><Icon.Close /></button>
          </div>
        )}

        {/* Estado de conexión */}
        {!connected && (
          <div className="card p-6 md:p-8">
            <div className="flex flex-col md:flex-row md:items-center gap-5">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                <Icon.Megaphone width={26} height={26} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="sf-display text-[20px] font-semibold">Conectá tu Meta Business</div>
                <div className="text-[13px] text-ink-2 mt-1">
                  Una sola conexión alcanza para ver todas las cuentas publicitarias del Business. El token de larga duración se guarda cifrado en el servidor.
                  {p.connection?.status === "expired" && <span className="text-danger"> La conexión anterior venció: volvé a conectar.</span>}
                  {p.connection?.status === "error" && p.connection.last_error && <span className="text-danger"> Error: {p.connection.last_error}</span>}
                </div>
                {!p.appConfigured && (
                  <div className="text-[13px] mt-2 text-warn">
                    Falta cargar el App ID y App Secret de Meta. <Link href="/settings#apis" className="underline">Ir a Configuración → APIs y secrets</Link>.
                  </div>
                )}
              </div>
              <a className={`btn btn-primary ${!p.appConfigured ? "pointer-events-none opacity-50" : ""}`} href="/api/meta/oauth/start">
                <Icon.Link /> Conectar Meta Ads
              </a>
            </div>
          </div>
        )}

        {connected && p.projects.length === 0 && (
          <div className="card p-6 md:p-8 text-center">
            <div className="sf-display text-[18px] font-semibold">Todavía no hay proyectos</div>
            <div className="text-[13px] text-ink-2 mt-1 mb-4">Creá un proyecto por cada cuenta publicitaria que quieras administrar.</div>
            <button className="btn btn-primary" onClick={() => setShowNew(true)}><Icon.Plus /> Crear primer proyecto</button>
            <div className="mt-4"><button onClick={disconnect} className="text-[12px] text-ink-3 underline">Desconectar Meta</button></div>
          </div>
        )}

        {p.projects.length > 0 && (
          <>
            {/* Selector de proyecto + período */}
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <div className="flex gap-2 overflow-x-auto scroll-clean pb-1 -mx-1 px-1 flex-1">
                <Chip active={p.selected === "all"} onClick={() => select("all")}>Todos</Chip>
                {p.projects.map(pr => (
                  <Chip key={pr.id} active={p.selected === pr.id} onClick={() => select(pr.id)} dot={pr.status !== "active" ? "#86868b" : pr.last_sync_error ? "#f04f6f" : undefined}>
                    {pr.name}
                  </Chip>
                ))}
              </div>
              <div className="flex items-center gap-1 p-1 rounded-xl border border-line bg-white shrink-0 self-start md:self-auto">
                {([7, 14, 30] as const).map(d => (
                  <button key={d} onClick={() => setPeriod(d)} className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition ${period === d ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-[#f0f0f2]"}`}>{d} días</button>
                ))}
              </div>
            </div>

            {/* Acciones mobile */}
            <div className="md:hidden flex gap-2">
              <button className="btn btn-ghost flex-1 justify-center" onClick={() => sync(project?.id)} disabled={syncing}><Icon.Refresh /> {syncing ? "Sincronizando…" : "Sincronizar"}</button>
              <button className="btn btn-primary flex-1 justify-center" onClick={() => setShowNew(true)}><Icon.Plus /> Proyecto</button>
            </div>

            {/* ---------- Vista TODOS ---------- */}
            {!project && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {overviewCards.map(({ pr, m, nAlerts, danger }) => (
                    <button key={pr.id} onClick={() => select(pr.id)} className="card p-5 text-left hover:shadow-lg transition">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[15px] font-semibold truncate">{pr.name}</div>
                          <div className="text-[12px] text-ink-3 truncate">{pr.ad_account_name ?? pr.ad_account_id} · {pr.currency}</div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {(p.pendingByProject[pr.id] ?? 0) > 0 && <Badge tone="info">{p.pendingByProject[pr.id]} por aprobar</Badge>}
                          {nAlerts > 0 && <Badge tone={danger ? "danger" : "warning"}>{nAlerts} alerta{nAlerts > 1 ? "s" : ""}</Badge>}
                          {pr.status !== "active" && <Badge tone="default">Pausado</Badge>}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3 mt-4">
                        <Mini label="Gasto" value={money(m.spend, pr.currency, 0)} />
                        <Mini label="Resultados" value={num(m.results)} />
                        <Mini label={pr.goal_type === "roas" ? "ROAS" : "Costo/res."} value={pr.goal_type === "roas" ? (m.roas ? `${m.roas.toFixed(2)}x` : "—") : money(m.cpr, pr.currency)} tone={goalTone(pr, m)} />
                      </div>
                      <div className="text-[11px] text-ink-3 mt-3">
                        {pr.last_sync_error ? <span className="text-danger">Error de sync: {pr.last_sync_error}</span> : `Sync ${timeAgo(pr.last_sync_at)}`}
                      </div>
                    </button>
                  ))}
                </div>
                <div className="card overflow-hidden">
                  <div className="px-5 py-4 border-b border-line sf-display text-[15px] font-semibold">Comparativa · últimos {period} días</div>
                  <div className="overflow-x-auto scroll-clean">
                    <table className="clean">
                      <thead><tr><th>Proyecto</th><th className="text-right">Gasto</th><th className="text-right">Impresiones</th><th className="text-right">Clics</th><th className="text-right">CPM</th><th className="text-right">CTR</th><th className="text-right">CPC</th><th className="text-right">Resultados</th><th className="text-right">Costo/res.</th><th className="text-right">ROAS</th></tr></thead>
                      <tbody>
                        {overviewCards.map(({ pr, m }) => (
                          <tr key={pr.id} className="hover:bg-surface-2 cursor-pointer" onClick={() => select(pr.id)}>
                            <td className="font-medium">{pr.name}</td>
                            <td className="text-right">{money(m.spend, pr.currency, 0)}</td>
                            <td className="text-right">{num(m.impressions)}</td>
                            <td className="text-right">{num(m.clicks)}</td>
                            <td className="text-right">{money(m.cpm, pr.currency)}</td>
                            <td className="text-right">{pct(m.ctr)}</td>
                            <td className="text-right">{money(m.cpc, pr.currency)}</td>
                            <td className="text-right">{num(m.results)}</td>
                            <td className="text-right">{money(m.cpr, pr.currency)}</td>
                            <td className="text-right">{m.roas ? `${m.roas.toFixed(2)}x` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {/* ---------- Vista PROYECTO ---------- */}
            {project && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="sf-display text-[20px] font-semibold truncate">{project.name}</div>
                    <div className="text-[12px] text-ink-3 truncate">
                      {project.ad_account_name ?? project.ad_account_id} · {project.currency}
                      {project.goal_value ? ` · objetivo ${project.goal_type === "roas" ? `ROAS ${project.goal_value}x` : `CPA ${money(project.goal_value, cur)}`}` : " · sin objetivo"}
                      {project.last_sync_error && <span className="text-danger"> · error de sync: {project.last_sync_error}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="hidden md:block"><AutomationSwitch projectId={project.id} mode={project.automation_mode} pending={p.actions.filter(a => a.status === "proposed").length} /></div>
                    <button className="btn btn-ghost shrink-0" onClick={() => setShowSettings(true)}><Icon.Cog /> <span className="hidden md:inline">Ajustes</span></button>
                  </div>
                </div>
                <div className="md:hidden"><AutomationSwitch projectId={project.id} mode={project.automation_mode} pending={p.actions.filter(a => a.status === "proposed").length} /></div>

                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                  <Kpi label="Gasto" value={money(totals.spend, cur, 0)} delta={delta(totals.spend, prev.spend)} invert />
                  <Kpi label={resultLabel} value={num(totals.results)} delta={delta(totals.results, prev.results)} />
                  <Kpi label="Costo por resultado" value={money(totals.cpr, cur)} delta={delta(totals.cpr, prev.cpr)} invert tone={goalTone(project, totals)} />
                  <Kpi label="CPM" value={money(totals.cpm, cur)} delta={delta(totals.cpm, prev.cpm)} invert />
                  <Kpi label="CTR" value={pct(totals.ctr)} delta={delta(totals.ctr, prev.ctr)} />
                  {totals.purchase_value > 0
                    ? <Kpi label="ROAS" value={totals.roas ? `${totals.roas.toFixed(2)}x` : "—"} delta={delta(totals.roas, prev.roas)} />
                    : <Kpi label="CPC" value={money(totals.cpc, cur)} delta={delta(totals.cpc, prev.cpc)} invert />}
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                  <div className="card p-5 xl:col-span-2">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-1 mb-2">
                      <div className="sf-display text-[15px] font-semibold">Gasto y resultados por día</div>
                      <div className="text-[12px] text-ink-3">vs. {period} días anteriores: {money(prev.spend, cur, 0)} · {num(prev.results)} res.</div>
                    </div>
                    <AdsChart data={daily} currency={cur} />
                  </div>

                  <div className="card p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="sf-display text-[15px] font-semibold">Alertas</div>
                      <Badge tone={alerts.length ? (alerts.some(a => a.severity === "danger") ? "danger" : "warning") : "success"}>{alerts.length ? `${alerts.length} abierta${alerts.length > 1 ? "s" : ""}` : "Todo en orden"}</Badge>
                    </div>
                    <div className="space-y-2 max-h-[340px] overflow-y-auto scroll-clean pr-1">
                      {alerts.length === 0 && <div className="text-[13px] text-ink-3 py-6 text-center">No hay alertas activas. Se recalculan en cada sincronización.</div>}
                      {alerts.map(a => {
                        const meta = ALERT_META[a.type] ?? { label: a.type, tone: "default" as BadgeTone };
                        return (
                          <div key={a.id} className="p-3 rounded-xl border border-line bg-surface-2">
                            <div className="flex items-center justify-between gap-2">
                              <Badge tone={meta.tone}>{meta.label}</Badge>
                              <button onClick={() => dismiss(a.id)} className="text-ink-3 hover:text-ink" title="Descartar"><Icon.Close /></button>
                            </div>
                            <div className="text-[13px] font-medium mt-2 truncate" title={a.entity_name ?? ""}>{a.entity_name ?? a.entity_id} <span className="text-ink-3 font-normal">· {a.level === "ad" ? "anuncio" : a.level === "adset" ? "conjunto" : "campaña"}</span></div>
                            <div className="text-[12px] text-ink-2 mt-0.5">{a.message}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Tabla por nivel */}
                <div className="card overflow-hidden">
                  <div className="flex items-center justify-between px-4 md:px-5 py-3 border-b border-line">
                    <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-2 border border-line">
                      {([["campaign", "Campañas", p.campaigns.length], ["adset", "Conjuntos", p.adsets.length], ["ad", "Anuncios", p.ads.length]] as const).map(([k, l, n]) => (
                        <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition ${tab === k ? "bg-white shadow-sm text-ink" : "text-ink-2"}`}>{l} <span className="text-ink-3">{n}</span></button>
                      ))}
                    </div>
                    <div className="text-[12px] text-ink-3 hidden md:block">Últimos {period} días · ordenado por gasto</div>
                  </div>
                  <div className="overflow-x-auto scroll-clean">
                    <table className="clean">
                      <thead>
                        <tr>
                          <th>Nombre</th><th>Estado</th>
                          {tab !== "ad" && <th className="text-right">Presupuesto</th>}
                          {tab === "adset" && <th>Aprendizaje</th>}
                          <th className="text-right">Gasto</th><th className="text-right">Impr.</th><th className="text-right">CPM</th><th className="text-right">CTR</th><th className="text-right">CPC</th>
                          <th className="text-right">{resultLabel}</th><th className="text-right">Costo/res.</th>
                          {tab === "ad" && <th className="text-right">Frec.</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {tableRows.length === 0 && <tr><td colSpan={12} className="text-center text-ink-3 py-8">Sin datos. Sincronizá el proyecto.</td></tr>}
                        {tableRows.map(({ e, m }) => (
                          <tr key={e.id} className={e.effective_status !== "ACTIVE" ? "opacity-60" : ""}>
                            <td className="truncate max-w-[280px]" title={e.name}>
                              <div className="flex items-center gap-2">
                                {tab === "ad" && e.thumbnail_url && <img src={e.thumbnail_url} alt="" className="w-8 h-8 rounded-md object-cover border border-line shrink-0" />}
                                <div className="min-w-0">
                                  <div className="truncate font-medium">{e.name}</div>
                                  {tab === "campaign" && e.objective && <div className="text-[11px] text-ink-3">{String(e.objective).replace("OUTCOME_", "").toLowerCase()}</div>}
                                </div>
                              </div>
                            </td>
                            <td><Badge tone={statusTone(e.effective_status)}>{statusLabel(e.effective_status)}</Badge></td>
                            {tab !== "ad" && <td className="text-right">{e.daily_budget ? `${money(Number(e.daily_budget), cur, 0)}/día` : e.lifetime_budget ? `${money(Number(e.lifetime_budget), cur, 0)} total` : <span className="text-ink-3">CBO</span>}</td>}
                            {tab === "adset" && <td>{e.learning_stage ? <Badge tone={e.learning_stage === "SUCCESS" ? "success" : e.learning_stage === "FAIL" ? "danger" : "warning"}>{e.learning_stage === "SUCCESS" ? "Listo" : e.learning_stage === "FAIL" ? "Limitado" : "Aprendiendo"}</Badge> : "—"}</td>}
                            <td className="text-right">{money(m.spend, cur, 0)}</td>
                            <td className="text-right">{num(m.impressions)}</td>
                            <td className="text-right">{money(m.cpm, cur)}</td>
                            <td className="text-right">{pct(m.ctr)}</td>
                            <td className="text-right">{money(m.cpc, cur)}</td>
                            <td className="text-right font-medium">{num(m.results)}</td>
                            <td className="text-right">{money(m.cpr, cur)}</td>
                            {tab === "ad" && <td className="text-right">{m.freq ? m.freq.toFixed(2) : "—"}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <ActionsCard projectId={project.id} actions={p.actions} currency={cur} mode={project.automation_mode} />
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <RulesCard projectId={project.id} rules={p.rules} currency={cur} goalType={project.goal_type} projectMode={project.automation_mode} />
                  <SummaryCard projectId={project.id} summary={p.summary} />
                </div>

                <div className="text-[12px] text-ink-3 flex flex-wrap gap-x-4 gap-y-1">
                  <span>Última sincronización: {timeAgo(project.last_sync_at)}{p.lastRun?.stats?.insight_rows != null ? ` · ${p.lastRun.stats.insight_rows} filas` : ""}</span>
                  <span>Automatización: {project.automation_mode === "off" ? "apagada" : project.automation_mode === "manual" ? "con aprobación manual" : "automática"}</span>
                  <button onClick={disconnect} className="underline">Desconectar Meta</button>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); router.push(`/ads?p=${id}`); router.refresh(); }} />}
      {showSettings && project && <ProjectSettingsModal project={project} onClose={() => setShowSettings(false)} onSaved={() => { setShowSettings(false); router.refresh(); }} onDeleted={() => { setShowSettings(false); router.push("/ads"); router.refresh(); }} />}
    </>
  );
}

// ---------- Subcomponentes ----------
function goalTone(pr: Project, m: { cpr: number | null; roas: number | null }): "ok" | "bad" | undefined {
  if (!pr.goal_value) return undefined;
  if (pr.goal_type === "roas") return m.roas == null ? undefined : m.roas >= pr.goal_value ? "ok" : "bad";
  return m.cpr == null ? undefined : m.cpr <= pr.goal_value ? "ok" : "bad";
}

function Chip({ active, onClick, children, dot }: { active: boolean; onClick: () => void; children: React.ReactNode; dot?: string }) {
  return (
    <button onClick={onClick} className={`shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[13px] font-medium border transition ${active ? "bg-ink text-white border-ink" : "bg-white border-line text-ink-2 hover:bg-[#f0f0f2]"}`}>
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: dot }} />}
      {children}
    </button>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: "ok" | "bad" }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-ink-3">{label}</div>
      <div className={`text-[16px] font-semibold tabular-nums ${tone === "ok" ? "text-ok" : tone === "bad" ? "text-danger" : ""}`}>{value}</div>
    </div>
  );
}

function Kpi({ label, value, delta, invert, tone }: { label: string; value: string; delta: number | null; invert?: boolean; tone?: "ok" | "bad" }) {
  const good = delta == null ? null : invert ? delta <= 0 : delta >= 0;
  return (
    <div className="card p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-ink-3 truncate">{label}</div>
      <div className={`text-[22px] md:text-[24px] font-bold tracking-tight tabular-nums mt-1 ${tone === "ok" ? "text-ok" : tone === "bad" ? "text-danger" : ""}`}>{value}</div>
      {delta != null && Number.isFinite(delta) && (
        <div className={`text-[11px] mt-1 ${good ? "text-ok" : "text-danger"}`}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(0)}% vs. anterior</div>
      )}
    </div>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center" style={{ background: "rgba(20,20,25,.4)", backdropFilter: "blur(6px)" }} onClick={onClose}>
      <div className={`bg-white w-full ${wide ? "md:max-w-2xl" : "md:max-w-lg"} md:rounded-3xl rounded-t-3xl max-h-[92vh] overflow-y-auto scroll-clean shadow-2xl`} onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white/90 backdrop-blur px-6 py-4 border-b border-line flex items-center justify-between z-10">
          <div className="sf-display text-[17px] font-semibold">{title}</div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-[#f0f0f2]"><Icon.Close /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <div className="text-[12px] font-medium text-ink-2 mb-1">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-ink-3 mt-1">{hint}</div>}
    </label>
  );
}

const RESULT_OPTIONS = [
  ["", "Automático (según objetivo de campaña)"], ["purchase", "Compras"], ["lead", "Leads"],
  ["complete_registration", "Registros"], ["onsite_conversion.messaging_conversation_started_7d", "Conversaciones (WhatsApp/Messenger)"],
  ["initiate_checkout", "Checkouts iniciados"], ["add_to_cart", "Agregados al carrito"], ["landing_page_view", "Visitas a landing"], ["link_click", "Clics en enlace"]
];

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [accounts, setAccounts] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<any | null>(null);
  const [name, setName] = useState("");
  const [goalType, setGoalType] = useState<"cpa" | "roas">("cpa");
  const [goalValue, setGoalValue] = useState("");
  const [resultType, setResultType] = useState("");
  const [pixel, setPixel] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/meta/accounts", { cache: "no-store" }).then(async r => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudieron listar las cuentas");
      setAccounts(j.accounts);
    }).catch(e => setErr(e.message));
  }, []);

  async function create() {
    if (!sel) return;
    setSaving(true); setErr(null);
    try {
      const r = await fetch("/api/meta/projects", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || sel.name, ad_account_id: sel.id, ad_account_name: sel.name, business_name: sel.business,
          currency: sel.currency, timezone: sel.timezone, pixel_id: pixel || null,
          goal_type: goalType, goal_value: goalValue ? Number(goalValue) : null, result_action_type: resultType || null
        })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo crear el proyecto");
      onCreated(j.project.id);
    } catch (e: any) { setErr(e.message); setSaving(false); }
  }

  return (
    <Modal title="Nuevo proyecto" onClose={onClose} wide>
      {err && <div className="rounded-xl px-4 py-3 text-[13px] bg-danger-soft text-danger mb-4">{err}</div>}
      {!sel ? (
        <>
          <div className="text-[13px] text-ink-2 mb-3">Elegí la cuenta publicitaria que va a administrar este proyecto.</div>
          {!accounts && !err && <div className="text-[13px] text-ink-3 py-8 text-center">Consultando cuentas en Meta…</div>}
          <div className="space-y-2">
            {accounts?.map(a => (
              <button key={a.id} disabled={a.in_use} onClick={() => { setSel(a); setName(a.name); }}
                className={`w-full text-left p-4 rounded-xl border border-line flex items-center justify-between gap-3 ${a.in_use ? "opacity-50 cursor-not-allowed" : "hover:bg-surface-2"}`}>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold truncate">{a.name}</div>
                  <div className="text-[12px] text-ink-3 truncate">{a.id} · {a.currency}{a.business ? ` · ${a.business}` : ""}{a.timezone ? ` · ${a.timezone}` : ""}</div>
                </div>
                {a.in_use ? <Badge tone="default">Ya tiene proyecto</Badge> : a.status === 1 ? <Badge tone="success">Activa</Badge> : <Badge tone="warning">Estado {a.status}</Badge>}
              </button>
            ))}
            {accounts && accounts.length === 0 && <div className="text-[13px] text-ink-3 py-8 text-center">No se encontraron cuentas publicitarias con esta conexión.</div>}
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <div className="p-3 rounded-xl bg-surface-2 border border-line flex items-center justify-between">
            <div className="min-w-0"><div className="text-[13px] font-semibold truncate">{sel.name}</div><div className="text-[11px] text-ink-3">{sel.id} · {sel.currency}</div></div>
            <button className="text-[12px] underline text-ink-2" onClick={() => setSel(null)}>Cambiar</button>
          </div>
          <Field label="Nombre del proyecto"><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Ej. AIRISFIT" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo de objetivo">
              <select className="input" value={goalType} onChange={e => setGoalType(e.target.value as any)}>
                <option value="cpa">CPA (costo por resultado)</option>
                <option value="roas">ROAS (retorno)</option>
              </select>
            </Field>
            <Field label={goalType === "cpa" ? `CPA objetivo (${sel.currency})` : "ROAS objetivo (x)"} hint="Opcional. Se usa para alertas y reglas.">
              <input className="input" type="number" step="0.01" value={goalValue} onChange={e => setGoalValue(e.target.value)} placeholder={goalType === "cpa" ? "Ej. 12" : "Ej. 3"} />
            </Field>
          </div>
          <Field label="Qué cuenta como resultado">
            <select className="input" value={resultType} onChange={e => setResultType(e.target.value)}>
              {RESULT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Pixel ID" hint="Opcional."><input className="input" value={pixel} onChange={e => setPixel(e.target.value)} placeholder="Ej. 123456789012345" /></Field>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" onClick={create} disabled={saving}>{saving ? "Creando y sincronizando…" : "Crear proyecto"}</button>
          </div>
          {saving && <div className="text-[12px] text-ink-3">La primera sincronización trae 30 días de datos; puede tardar hasta un minuto.</div>}
        </div>
      )}
    </Modal>
  );
}

function ProjectSettingsModal({ project, onClose, onSaved, onDeleted }: { project: Project; onClose: () => void; onSaved: () => void; onDeleted: () => void }) {
  const [f, setF] = useState({
    name: project.name, goal_type: project.goal_type, goal_value: project.goal_value?.toString() ?? "",
    result_action_type: project.result_action_type ?? "", pixel_id: project.pixel_id ?? "",
    status: project.status, automation_mode: project.automation_mode, sales_source: project.sales_source,
    min_daily_budget: project.min_daily_budget?.toString() ?? "", max_daily_budget: project.max_daily_budget?.toString() ?? "",
    notify_email: project.notify_email ?? ""
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const webhookUrl = typeof window !== "undefined" ? `${window.location.origin}/api/meta/sales/webhook?project=${project.id}&token=${project.webhook_token ?? ""}` : "";

  async function save(extra: any = {}) {
    setSaving(true); setErr(null);
    try {
      const r = await fetch("/api/meta/projects", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: project.id, name: f.name, goal_type: f.goal_type, goal_value: f.goal_value ? Number(f.goal_value) : null,
          result_action_type: f.result_action_type || null, pixel_id: f.pixel_id || null,
          status: f.status, automation_mode: f.automation_mode, sales_source: f.sales_source,
          min_daily_budget: f.min_daily_budget ? Number(f.min_daily_budget) : null, max_daily_budget: f.max_daily_budget ? Number(f.max_daily_budget) : null,
          notify_email: f.notify_email || null, ...extra
        })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar");
      onSaved();
    } catch (e: any) { setErr(e.message); setSaving(false); }
  }
  async function del() {
    if (!confirm(`¿Eliminar el proyecto "${project.name}" y todo su historial? Esta acción no se puede deshacer.`)) return;
    const r = await fetch(`/api/meta/projects?id=${project.id}`, { method: "DELETE" });
    if (r.ok) onDeleted(); else setErr("No se pudo eliminar");
  }

  return (
    <Modal title="Ajustes del proyecto" onClose={onClose} wide>
      {err && <div className="rounded-xl px-4 py-3 text-[13px] bg-danger-soft text-danger mb-4">{err}</div>}
      <div className="space-y-4">
        <Field label="Nombre"><input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo de objetivo">
            <select className="input" value={f.goal_type} onChange={e => setF({ ...f, goal_type: e.target.value as any })}>
              <option value="cpa">CPA (costo por resultado)</option><option value="roas">ROAS (retorno)</option>
            </select>
          </Field>
          <Field label={f.goal_type === "cpa" ? `CPA objetivo (${project.currency})` : "ROAS objetivo (x)"}>
            <input className="input" type="number" step="0.01" value={f.goal_value} onChange={e => setF({ ...f, goal_value: e.target.value })} />
          </Field>
        </div>
        <Field label="Qué cuenta como resultado" hint="Cambiarlo aplica en la próxima sincronización.">
          <select className="input" value={f.result_action_type} onChange={e => setF({ ...f, result_action_type: e.target.value })}>
            {RESULT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pixel ID"><input className="input" value={f.pixel_id} onChange={e => setF({ ...f, pixel_id: e.target.value })} /></Field>
          <Field label="Estado del proyecto">
            <select className="input" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>
              <option value="active">Activo (se sincroniza cada hora)</option><option value="paused">Pausado</option><option value="archived">Archivado</option>
            </select>
          </Field>
        </div>
        <Field label="Automatización" hint="Apagada: solo alertas. Con aprobación: propone acciones y las ejecuta cuando aprobás. Automática: las reglas marcadas como automáticas se ejecutan solas.">
          <select className="input" value={f.automation_mode} onChange={e => setF({ ...f, automation_mode: e.target.value })}>
            <option value="off">Apagada (solo alertas)</option>
            <option value="manual">Con aprobación manual</option>
            <option value="auto">Automática</option>
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Presupuesto mínimo por conjunto (${project.currency}/día)`} hint="Guardrail: nunca se baja de acá."><input className="input" type="number" step="0.01" value={f.min_daily_budget} onChange={e => setF({ ...f, min_daily_budget: e.target.value })} /></Field>
          <Field label={`Presupuesto máximo por conjunto (${project.currency}/día)`} hint="Guardrail: nunca se escala más allá."><input className="input" type="number" step="0.01" value={f.max_daily_budget} onChange={e => setF({ ...f, max_daily_budget: e.target.value })} /></Field>
        </div>
        <Field label="Email para el resumen diario" hint="Opcional. Por defecto se usa el email de tu usuario. Requiere Resend en Configuración → APIs y secrets."><input className="input" type="email" value={f.notify_email} onChange={e => setF({ ...f, notify_email: e.target.value })} placeholder="vos@dominio.com" /></Field>

        <div className="divider" />
        <Field label="Fuente de ventas" hint="Por defecto se usan las conversiones que reporta Meta. Con webhook podés enviar ventas reales desde otra base para calcular ROAS real.">
          <select className="input" value={f.sales_source} onChange={e => setF({ ...f, sales_source: e.target.value })}>
            <option value="meta">Conversiones de Meta</option><option value="webhook">Ventas reales por webhook/API</option>
          </select>
        </Field>
        {f.sales_source === "webhook" && (
          <div className="p-3 rounded-xl bg-surface-2 border border-line space-y-2">
            <div className="text-[12px] font-medium">Endpoint para recibir ventas (POST, JSON)</div>
            <div className="flex gap-2">
              <input className="input text-[12px]" readOnly value={webhookUrl} />
              <button className="btn btn-ghost shrink-0" onClick={() => { navigator.clipboard.writeText(webhookUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copiado" : "Copiar"}</button>
            </div>
            <div className="text-[11px] text-ink-3">Body: <code>{`{ "external_id": "orden-123", "amount": 49.9, "currency": "USD", "occurred_at": "2026-09-18T12:00:00Z" }`}</code> o <code>{`{ "sales": [ ... ] }`}</code>.</div>
            <button className="text-[12px] underline text-ink-2" onClick={() => save({ regenerate_webhook_token: true })}>Regenerar token</button>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <button className="btn btn-ghost text-danger" onClick={del}><Icon.Trash /> Eliminar proyecto</button>
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" onClick={() => save()} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
