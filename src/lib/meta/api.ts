import { getSecret } from "@/lib/secrets";

/**
 * Cliente mínimo de la Marketing API de Meta (Graph API).
 * Solo server-side. Nunca importar desde componentes cliente.
 */
export const META_SCOPES = ["ads_management", "ads_read", "business_management", "read_insights"];

export async function graphVersion() {
  return (await getSecret("META_GRAPH_VERSION")) || "v21.0";
}

export async function graphBase() {
  return `https://graph.facebook.com/${await graphVersion()}`;
}

export class MetaApiError extends Error {
  code?: number; subcode?: number; type?: string; status: number;
  constructor(msg: string, status: number, err?: any) {
    super(msg);
    this.status = status;
    this.code = err?.code; this.subcode = err?.error_subcode; this.type = err?.type;
  }
}

export async function graphGet<T = any>(path: string, params: Record<string, any>, token: string): Promise<T> {
  const base = await graphBase();
  const url = new URL(`${base}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  url.searchParams.set("access_token", token);
  const res = await fetch(url.toString(), { cache: "no-store" });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    throw new MetaApiError(e.message || `Meta API HTTP ${res.status}`, res.status, e);
  }
  return json as T;
}

export async function graphPost<T = any>(path: string, body: Record<string, any>, token: string): Promise<T> {
  const base = await graphBase();
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) continue;
    form.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  form.set("access_token", token);
  const res = await fetch(`${base}/${path.replace(/^\//, "")}`, { method: "POST", body: form, cache: "no-store" });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    throw new MetaApiError(e.message || `Meta API HTTP ${res.status}`, res.status, e);
  }
  return json as T;
}

/** Recorre todas las páginas de un edge (data + paging.next). */
export async function graphGetAll<T = any>(path: string, params: Record<string, any>, token: string, maxPages = 50): Promise<T[]> {
  const out: T[] = [];
  let page = await graphGet<{ data: T[]; paging?: { next?: string } }>(path, { limit: 500, ...params }, token);
  out.push(...(page.data ?? []));
  let n = 1;
  while (page.paging?.next && n < maxPages) {
    const res = await fetch(page.paging.next, { cache: "no-store" });
    page = await res.json();
    if ((page as any).error) throw new MetaApiError((page as any).error.message, res.status, (page as any).error);
    out.push(...(page.data ?? []));
    n++;
  }
  return out;
}

// ---------- OAuth ----------

export async function oauthDialogUrl(redirectUri: string, state: string) {
  const appId = await getSecret("META_APP_ID");
  if (!appId) throw new Error("Falta META_APP_ID. Cargalo en Configuración → APIs y secrets.");
  const v = await graphVersion();
  const u = new URL(`https://www.facebook.com/${v}/dialog/oauth`);
  u.searchParams.set("client_id", appId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("scope", META_SCOPES.join(","));
  u.searchParams.set("response_type", "code");
  return u.toString();
}

export async function exchangeCodeForLongLivedToken(code: string, redirectUri: string) {
  const appId = await getSecret("META_APP_ID");
  const appSecret = await getSecret("META_APP_SECRET");
  if (!appId || !appSecret) throw new Error("Faltan META_APP_ID / META_APP_SECRET en Configuración → APIs y secrets.");
  const base = await graphBase();

  // 1) code -> short-lived token
  const u1 = new URL(`${base}/oauth/access_token`);
  u1.searchParams.set("client_id", appId);
  u1.searchParams.set("client_secret", appSecret);
  u1.searchParams.set("redirect_uri", redirectUri);
  u1.searchParams.set("code", code);
  const r1 = await fetch(u1.toString(), { cache: "no-store" });
  const j1: any = await r1.json();
  if (j1.error) throw new MetaApiError(j1.error.message, r1.status, j1.error);

  // 2) short-lived -> long-lived (~60 días)
  const u2 = new URL(`${base}/oauth/access_token`);
  u2.searchParams.set("grant_type", "fb_exchange_token");
  u2.searchParams.set("client_id", appId);
  u2.searchParams.set("client_secret", appSecret);
  u2.searchParams.set("fb_exchange_token", j1.access_token);
  const r2 = await fetch(u2.toString(), { cache: "no-store" });
  const j2: any = await r2.json();
  if (j2.error) throw new MetaApiError(j2.error.message, r2.status, j2.error);

  const token: string = j2.access_token;
  const expiresIn: number | undefined = j2.expires_in;
  const me = await graphGet<{ id: string; name: string }>("me", { fields: "id,name" }, token);
  const perms = await graphGet<{ data: { permission: string; status: string }[] }>("me/permissions", {}, token).catch(() => ({ data: [] }));

  return {
    token,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    metaUserId: me.id,
    metaUserName: me.name,
    scopes: perms.data.filter(p => p.status === "granted").map(p => p.permission)
  };
}

// ---------- Cuentas ----------

export type AdAccount = {
  id: string; account_id: string; name: string; currency: string;
  timezone_name?: string; account_status?: number; business?: { id: string; name: string };
};

export async function listAdAccounts(token: string): Promise<AdAccount[]> {
  const fields = "id,account_id,name,currency,timezone_name,account_status,business";
  const own = await graphGetAll<AdAccount>("me/adaccounts", { fields }, token);
  const map = new Map(own.map(a => [a.id, a]));
  // Cuentas de los Business a los que pertenece el usuario
  try {
    const biz = await graphGetAll<{ id: string; name: string }>("me/businesses", { fields: "id,name" }, token);
    for (const b of biz) {
      const owned = await graphGetAll<AdAccount>(`${b.id}/owned_ad_accounts`, { fields }, token).catch(() => []);
      const client = await graphGetAll<AdAccount>(`${b.id}/client_ad_accounts`, { fields }, token).catch(() => []);
      for (const a of [...owned, ...client]) if (!map.has(a.id)) map.set(a.id, { ...a, business: a.business ?? b });
    }
  } catch { /* business_management puede no estar concedido */ }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listPixels(token: string, adAccountId: string) {
  return graphGetAll<{ id: string; name: string }>(`${adAccountId}/adspixels`, { fields: "id,name" }, token).catch(() => []);
}

// ---------- Estructura ----------

export const CAMPAIGN_FIELDS = "id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time";
export const ADSET_FIELDS    = "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,optimization_goal,learning_stage_info,created_time";
export const AD_FIELDS       = "id,name,status,effective_status,adset_id,campaign_id,created_time,creative{id,thumbnail_url}";

export async function listCampaigns(token: string, act: string) {
  return graphGetAll<any>(`${act}/campaigns`, { fields: CAMPAIGN_FIELDS }, token);
}
export async function listAdsets(token: string, act: string) {
  return graphGetAll<any>(`${act}/adsets`, { fields: ADSET_FIELDS }, token);
}
export async function listAds(token: string, act: string) {
  return graphGetAll<any>(`${act}/ads`, { fields: AD_FIELDS }, token);
}

// ---------- Insights ----------

export const INSIGHT_FIELDS = [
  "campaign_id","adset_id","ad_id","date_start","date_stop",
  "spend","impressions","reach","clicks","inline_link_clicks","frequency","cpm","ctr","cpc",
  "actions","action_values","cost_per_action_type","purchase_roas"
].join(",");

export async function fetchInsights(token: string, act: string, level: "campaign" | "adset" | "ad", since: string, until: string) {
  return graphGetAll<any>(`${act}/insights`, {
    level,
    fields: INSIGHT_FIELDS,
    time_increment: 1,
    time_range: { since, until },
    limit: 500
  }, token);
}

// ---------- Mutaciones (Etapa 2) ----------

export async function updateStatus(token: string, id: string, status: "ACTIVE" | "PAUSED") {
  return graphPost(id, { status }, token);
}
export async function updateDailyBudget(token: string, id: string, dailyBudgetMinorUnits: number) {
  return graphPost(id, { daily_budget: Math.round(dailyBudgetMinorUnits) }, token);
}
