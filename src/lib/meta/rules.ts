import { aggregate, type InsightRow } from "./insights";

/**
 * Motor de reglas (Etapas 2 y 3).
 * Evalúa la cuenta con los insights guardados y propone acciones concretas.
 * Nunca ejecuta nada: eso lo hace actions.ts (con aprobación o en modo auto).
 */

export type RuleType = "pause_bad_ad" | "budget_down" | "budget_up" | "reactivate";

export type RuleConfig = {
  // comunes
  window_days?: number;        // ventana de análisis
  cooldown_days?: number;      // días mínimos entre acciones sobre la misma entidad
  respect_learning?: boolean;  // no tocar conjuntos en fase de aprendizaje
  // pause_bad_ad
  no_result_spend_x?: number;  // gasto sin resultados >= X veces el CPA objetivo
  bad_cpa_x?: number;          // CPA > X veces el objetivo con >= min_results
  min_results?: number;
  // budget_down / budget_up
  pct?: number;                // % de cambio (15–20)
  cpa_x?: number;              // umbral relativo al objetivo (1.3 bajar, 0.8 subir)
  min_results_up?: number;     // resultados mínimos para escalar
  // reactivate
  days_paused?: number;        // días desde la pausa automática
};

export type Rule = {
  id?: string; project_id: string; name: string; type: RuleType; config: RuleConfig; enabled: boolean; mode: "manual" | "auto";
};

export const DEFAULT_RULES: Omit<Rule, "project_id" | "id">[] = [
  {
    name: "Pausar anuncios que no funcionan", type: "pause_bad_ad", enabled: true, mode: "manual",
    config: { window_days: 7, no_result_spend_x: 2, bad_cpa_x: 2, min_results: 3, cooldown_days: 3 }
  },
  {
    name: "Bajar presupuesto cuando el CPA se va del objetivo", type: "budget_down", enabled: true, mode: "manual",
    config: { window_days: 7, pct: 15, cpa_x: 1.3, min_results: 3, cooldown_days: 3, respect_learning: true }
  },
  {
    name: "Escalar conjuntos ganadores", type: "budget_up", enabled: true, mode: "manual",
    config: { window_days: 7, pct: 20, cpa_x: 0.8, min_results_up: 5, cooldown_days: 3, respect_learning: true }
  },
  {
    name: "Reactivar anuncios pausados que merecen otra chance", type: "reactivate", enabled: false, mode: "manual",
    config: { days_paused: 14, cooldown_days: 14 }
  }
];

export type ActionDraft = {
  project_id: string; rule_id: string | null; rule_type: RuleType;
  type: "pause" | "activate" | "set_budget";
  level: "campaign" | "adset" | "ad"; entity_id: string; entity_name: string | null;
  payload: any; reason: string; auto: boolean;
};

export type Entities = {
  campaigns: { id: string; name: string; effective_status: string | null; daily_budget: number | null }[];
  adsets: { id: string; name: string; campaign_id: string | null; effective_status: string | null; daily_budget: number | null; learning_stage: string | null }[];
  ads: { id: string; name: string; adset_id: string | null; effective_status: string | null }[];
};

export type PastAction = { type: string; level: string; entity_id: string; status: string; executed_by: string | null; proposed_at: string; executed_at: string | null };

export type ProjectCtx = {
  id: string; currency: string; goal_type: "cpa" | "roas"; goal_value: number | null;
  min_daily_budget: number | null; max_daily_budget: number | null; automation_mode: string;
};

const fmt = (n: number | null | undefined, cur: string) =>
  n == null ? "—" : new Intl.NumberFormat("es-AR", { style: "currency", currency: cur || "USD", maximumFractionDigits: 2 }).format(n);

function lastDays(rows: InsightRow[], level: string, entityId: string, days: number) {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - days + 1);
  const since = d.toISOString().slice(0, 10);
  return rows.filter(r => r.level === level && r.entity_id === entityId && r.date >= since);
}

function daysSince(iso: string | null) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 86400000;
}

/** ¿Hubo una acción (propuesta o ejecutada) sobre esta entidad dentro del cooldown? */
function inCooldown(past: PastAction[], entityId: string, types: string[], days: number) {
  return past.some(a => a.entity_id === entityId && types.includes(a.type)
    && ["proposed", "approved", "executed"].includes(a.status)
    && daysSince(a.executed_at ?? a.proposed_at) < days);
}

export function evaluateRules(project: ProjectCtx, rules: Rule[], rows: InsightRow[], ents: Entities, past: PastAction[]): ActionDraft[] {
  const out: ActionDraft[] = [];
  const cur = project.currency;
  const goal = project.goal_value && project.goal_value > 0 ? Number(project.goal_value) : null;
  const isCpa = project.goal_type !== "roas";

  // Sin objetivo no hay referencia confiable para pausar/escalar: usamos el promedio de la cuenta (7 días).
  const d7 = new Date(); d7.setUTCHours(0, 0, 0, 0); d7.setUTCDate(d7.getUTCDate() - 6);
  const s7 = d7.toISOString().slice(0, 10);
  const acct = aggregate(rows.filter(r => r.level === "campaign" && r.date >= s7));
  const refCpa = isCpa ? (goal ?? acct.cost_per_result) : null;
  const refRoas = !isCpa ? (goal ?? acct.roas) : null;
  const hasRef = isCpa ? !!refCpa : !!refRoas;
  if (!hasRef) return out;

  const adsetById = new Map(ents.adsets.map(a => [a.id, a]));
  const campaignById = new Map(ents.campaigns.map(c => [c.id, c]));

  /** Peor/mejor que la referencia, normalizado: >1 = peor que el objetivo, <1 = mejor. */
  const ratio = (m: { cost_per_result: number | null; roas: number | null }) => {
    if (isCpa) return m.cost_per_result != null && refCpa ? m.cost_per_result / refCpa : null;
    return m.roas != null && refRoas ? refRoas / m.roas : null;
  };
  const perf = (m: { cost_per_result: number | null; roas: number | null }) =>
    isCpa ? `CPA ${fmt(m.cost_per_result, cur)} (obj. ${fmt(refCpa, cur)})` : `ROAS ${(m.roas ?? 0).toFixed(2)}x (obj. ${refRoas?.toFixed(2)}x)`;

  for (const rule of rules.filter(r => r.enabled)) {
    const c = rule.config ?? {};
    const auto = project.automation_mode === "auto" && rule.mode === "auto";
    const cooldown = c.cooldown_days ?? 3;

    // ---------------- 1) Pausar anuncios malos ----------------
    if (rule.type === "pause_bad_ad") {
      for (const ad of ents.ads.filter(a => a.effective_status === "ACTIVE")) {
        if (inCooldown(past, ad.id, ["pause", "activate"], cooldown)) continue;
        const w = aggregate(lastDays(rows, "ad", ad.id, c.window_days ?? 7));
        const w3 = aggregate(lastDays(rows, "ad", ad.id, 3));
        const noResSpend = (c.no_result_spend_x ?? 2) * (isCpa ? (refCpa ?? 0) : (acct.spend / Math.max(1, acct.purchases)));
        let reason: string | null = null;
        if (w3.results === 0 && w3.spend >= noResSpend && noResSpend > 0) {
          reason = `Gastó ${fmt(w3.spend, cur)} en 3 días sin resultados (umbral ${fmt(noResSpend, cur)}).`;
        } else if (w.results >= (c.min_results ?? 3)) {
          const r = ratio(w);
          if (r != null && r > (c.bad_cpa_x ?? 2)) reason = `${perf(w)} en ${c.window_days ?? 7} días: ${(r * 100 - 100).toFixed(0)}% peor que el objetivo.`;
        }
        if (reason) out.push({
          project_id: project.id, rule_id: rule.id ?? null, rule_type: rule.type, type: "pause", level: "ad",
          entity_id: ad.id, entity_name: ad.name, payload: { from_status: "ACTIVE", to_status: "PAUSED", spend_7d: w.spend, results_7d: w.results },
          reason, auto
        });
      }
    }

    // ---------------- 2/3) Presupuesto por conjunto (o campaña si es CBO) ----------------
    if (rule.type === "budget_down" || rule.type === "budget_up") {
      const up = rule.type === "budget_up";
      const pct = Math.min(Math.max(c.pct ?? (up ? 20 : 15), 5), 30);
      for (const as of ents.adsets.filter(a => a.effective_status === "ACTIVE")) {
        if ((c.respect_learning ?? true) && as.learning_stage === "LEARNING") continue;
        // CBO: el presupuesto vive en la campaña
        const camp = as.campaign_id ? campaignById.get(as.campaign_id) : null;
        const target = as.daily_budget ? { level: "adset" as const, id: as.id, name: as.name, budget: as.daily_budget }
          : camp?.daily_budget ? { level: "campaign" as const, id: camp.id, name: camp.name, budget: camp.daily_budget } : null;
        if (!target) continue;
        if (inCooldown(past, target.id, ["set_budget"], cooldown)) continue;

        const w = aggregate(lastDays(rows, "adset", as.id, c.window_days ?? 7));
        const r = ratio(w);
        if (r == null) continue;

        let fire = false, reason = "";
        if (up && w.results >= (c.min_results_up ?? 5) && r <= (c.cpa_x ?? 0.8)) {
          fire = true; reason = `${w.results} resultados y ${perf(w)} en ${c.window_days ?? 7} días: ${(100 - r * 100).toFixed(0)}% mejor que el objetivo. Escalar +${pct}%.`;
        }
        if (!up && w.results >= (c.min_results ?? 3) && r >= (c.cpa_x ?? 1.3)) {
          fire = true; reason = `${perf(w)} en ${c.window_days ?? 7} días: ${(r * 100 - 100).toFixed(0)}% peor que el objetivo. Bajar −${pct}%.`;
        }
        if (!fire) continue;

        let next = target.budget * (up ? 1 + pct / 100 : 1 - pct / 100);
        if (project.max_daily_budget && next > project.max_daily_budget) next = project.max_daily_budget;
        if (project.min_daily_budget && next < project.min_daily_budget) next = project.min_daily_budget;
        next = Math.round(next * 100) / 100;
        if (Math.abs(next - target.budget) < 0.01) continue; // ya está en el límite

        out.push({
          project_id: project.id, rule_id: rule.id ?? null, rule_type: rule.type, type: "set_budget", level: target.level,
          entity_id: target.id, entity_name: target.level === "campaign" ? `${target.name} (CBO)` : target.name,
          payload: { from_daily_budget: target.budget, daily_budget: next, pct: up ? pct : -pct, adset_id: as.id, results: w.results, cpa: w.cost_per_result, roas: w.roas },
          reason, auto
        });
      }
    }

    // ---------------- 4) Reactivar anuncios que pausamos hace tiempo ----------------
    if (rule.type === "reactivate") {
      const pausedByUs = past.filter(a => a.type === "pause" && a.level === "ad" && a.status === "executed" && daysSince(a.executed_at) >= (c.days_paused ?? 14));
      for (const pa of pausedByUs) {
        const ad = ents.ads.find(a => a.id === pa.entity_id);
        if (!ad || ad.effective_status !== "PAUSED") continue;
        if (inCooldown(past, ad.id, ["activate"], cooldown)) continue;
        const as = ad.adset_id ? adsetById.get(ad.adset_id) : null;
        if (!as || as.effective_status !== "ACTIVE") continue;
        const w = aggregate(lastDays(rows, "adset", as.id, 7));
        const r = ratio(w);
        if (r == null || r > 1) continue; // el conjunto tiene que estar rindiendo bien
        out.push({
          project_id: project.id, rule_id: rule.id ?? null, rule_type: rule.type, type: "activate", level: "ad",
          entity_id: ad.id, entity_name: ad.name, payload: { from_status: "PAUSED", to_status: "ACTIVE" },
          reason: `Pausado hace ${Math.floor(daysSince(pa.executed_at))} días; el conjunto "${as.name}" hoy rinde ${perf(w)}. Probar de nuevo.`,
          auto
        });
      }
    }
  }

  // Una sola acción por entidad por evaluación (prioridad: pausar > bajar > subir > reactivar)
  const prio: Record<string, number> = { pause: 0, set_budget: 1, activate: 2 };
  const seen = new Set<string>();
  return out.sort((a, b) => prio[a.type] - prio[b.type]).filter(a => {
    const k = `${a.level}:${a.entity_id}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
}
