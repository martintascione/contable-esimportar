/** Normalización de una fila de insights de Meta a nuestro esquema ad_insights_daily. */

const PURCHASE_TYPES = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"];

/** Prioridad para detectar el "resultado" cuando el proyecto no fija result_action_type. */
const RESULT_PRIORITY = [
  "purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase",
  "lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead",
  "complete_registration", "offsite_conversion.fb_pixel_complete_registration",
  "onsite_conversion.messaging_conversation_started_7d",
  "initiate_checkout", "add_to_cart", "landing_page_view", "link_click"
];

type Action = { action_type: string; value: string };

function pick(list: Action[] | undefined, types: string[]): { type: string; value: number } | null {
  if (!list) return null;
  for (const t of types) {
    const a = list.find(x => x.action_type === t);
    if (a) return { type: t, value: Number(a.value) || 0 };
  }
  return null;
}

export function normalizeInsight(row: any, level: "campaign" | "adset" | "ad", resultActionType?: string | null) {
  const entity_id = level === "campaign" ? row.campaign_id : level === "adset" ? row.adset_id : row.ad_id;
  const spend = Number(row.spend) || 0;

  const purchase = pick(row.actions, PURCHASE_TYPES);
  const purchaseValue = pick(row.action_values, PURCHASE_TYPES);
  const purchases = purchase?.value ?? 0;
  const purchase_value = purchaseValue?.value ?? 0;

  const resultTypes = resultActionType ? [resultActionType, ...RESULT_PRIORITY] : RESULT_PRIORITY;
  const result = pick(row.actions, resultTypes);
  const results = result?.value ?? 0;
  const result_type = result?.type ?? resultActionType ?? null;

  const roasApi = Array.isArray(row.purchase_roas) ? Number(row.purchase_roas[0]?.value) : NaN;
  const roas = Number.isFinite(roasApi) ? roasApi : (spend > 0 && purchase_value > 0 ? purchase_value / spend : null);

  return {
    level,
    entity_id: String(entity_id),
    date: row.date_start,
    spend,
    impressions: Number(row.impressions) || 0,
    reach: Number(row.reach) || 0,
    clicks: Number(row.clicks) || 0,
    link_clicks: Number(row.inline_link_clicks) || 0,
    frequency: row.frequency != null ? Number(row.frequency) : null,
    cpm: row.cpm != null ? Number(row.cpm) : null,
    ctr: row.ctr != null ? Number(row.ctr) : null,
    cpc: row.cpc != null ? Number(row.cpc) : null,
    results,
    result_type,
    cost_per_result: results > 0 ? spend / results : null,
    purchases,
    purchase_value,
    roas,
    raw: { actions: row.actions ?? null, action_values: row.action_values ?? null }
  };
}

export type InsightRow = ReturnType<typeof normalizeInsight> & { project_id: string };

/** Suma un conjunto de filas diarias y recalcula ratios. */
export function aggregate(rows: Pick<InsightRow, "spend"|"impressions"|"reach"|"clicks"|"link_clicks"|"results"|"purchases"|"purchase_value">[]) {
  const s = rows.reduce((a, r) => ({
    spend: a.spend + Number(r.spend || 0),
    impressions: a.impressions + Number(r.impressions || 0),
    reach: a.reach + Number(r.reach || 0),
    clicks: a.clicks + Number(r.clicks || 0),
    link_clicks: a.link_clicks + Number(r.link_clicks || 0),
    results: a.results + Number(r.results || 0),
    purchases: a.purchases + Number(r.purchases || 0),
    purchase_value: a.purchase_value + Number(r.purchase_value || 0)
  }), { spend: 0, impressions: 0, reach: 0, clicks: 0, link_clicks: 0, results: 0, purchases: 0, purchase_value: 0 });
  return {
    ...s,
    cpm: s.impressions ? (s.spend / s.impressions) * 1000 : null,
    ctr: s.impressions ? (s.clicks / s.impressions) * 100 : null,
    cpc: s.clicks ? s.spend / s.clicks : null,
    cost_per_result: s.results ? s.spend / s.results : null,
    roas: s.spend && s.purchase_value ? s.purchase_value / s.spend : null,
    frequency: s.reach ? s.impressions / s.reach : null
  };
}
