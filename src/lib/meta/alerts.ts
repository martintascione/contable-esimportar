import { aggregate, type InsightRow } from "./insights";

export type Project = {
  id: string; name: string; currency: string;
  goal_type: "cpa" | "roas"; goal_value: number | null;
};

export type AlertDraft = {
  project_id: string; type: string; severity: "info" | "warning" | "danger" | "success";
  level: "campaign" | "adset" | "ad"; entity_id: string; entity_name: string | null;
  message: string; data: any;
};

type Entity = { id: string; name: string; effective_status?: string | null };

function fmt(n: number | null | undefined, cur: string) {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: cur || "USD", maximumFractionDigits: 2 }).format(n);
}

function windowRows(rows: InsightRow[], level: string, entityId: string, daysBack: number, offset = 0) {
  const end = new Date(); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() - offset);
  const start = new Date(end); start.setUTCDate(end.getUTCDate() - daysBack + 1);
  const s = start.toISOString().slice(0, 10), e = end.toISOString().slice(0, 10);
  return rows.filter(r => r.level === level && r.entity_id === entityId && r.date >= s && r.date <= e);
}

/**
 * Reglas de alerta simples (Etapa 1). Solo detectan y avisan; no ejecutan nada.
 */
export function computeAlerts(project: Project, rows: InsightRow[], ads: Entity[], adsets: Entity[]): AlertDraft[] {
  const out: AlertDraft[] = [];
  const cur = project.currency;
  const goal = project.goal_value && project.goal_value > 0 ? Number(project.goal_value) : null;
  const isCpa = project.goal_type !== "roas";

  const activeAds = ads.filter(a => (a.effective_status ?? "ACTIVE") === "ACTIVE");
  const activeAdsets = adsets.filter(a => (a.effective_status ?? "ACTIVE") === "ACTIVE");

  // Promedio de la cuenta (últimos 7 días) como referencia cuando no hay objetivo
  const d7 = new Date(); d7.setUTCHours(0, 0, 0, 0); d7.setUTCDate(d7.getUTCDate() - 6);
  const since7 = d7.toISOString().slice(0, 10);
  const acct7 = aggregate(rows.filter(r => r.level === "ad" && r.date >= since7));
  const refCpa = goal && isCpa ? goal : acct7.cost_per_result;
  const refRoas = goal && !isCpa ? goal : acct7.roas;

  for (const ad of activeAds) {
    const last3 = aggregate(windowRows(rows, "ad", ad.id, 3));
    const last7 = aggregate(windowRows(rows, "ad", ad.id, 7));
    const prev7 = aggregate(windowRows(rows, "ad", ad.id, 7, 7));

    // 1) Gasto sin resultados (3 días)
    const noResultThreshold = refCpa ? refCpa * 1.5 : 20;
    if (last3.spend >= noResultThreshold && last3.results === 0) {
      out.push({
        project_id: project.id, type: "spend_no_results", severity: "danger", level: "ad",
        entity_id: ad.id, entity_name: ad.name,
        message: `Gastó ${fmt(last3.spend, cur)} en 3 días sin ningún resultado.`,
        data: { spend_3d: last3.spend, threshold: noResultThreshold }
      });
    }

    // 2) Anuncio ganador (7 días)
    if (last7.results >= 5) {
      const winCpa = isCpa && refCpa && last7.cost_per_result != null && last7.cost_per_result <= refCpa * 0.8;
      const winRoas = !isCpa && refRoas && last7.roas != null && last7.roas >= refRoas * 1.2;
      if (winCpa || winRoas) {
        out.push({
          project_id: project.id, type: "winner", severity: "success", level: "ad",
          entity_id: ad.id, entity_name: ad.name,
          message: isCpa
            ? `${last7.results} resultados a ${fmt(last7.cost_per_result, cur)} (objetivo ${fmt(refCpa, cur)}). Candidato a escalar.`
            : `ROAS ${last7.roas?.toFixed(2)}x en 7 días (objetivo ${refRoas?.toFixed(2)}x). Candidato a escalar.`,
          data: { results_7d: last7.results, cpa_7d: last7.cost_per_result, roas_7d: last7.roas }
        });
      }
    }

    // 3) Fatiga de creativo (frecuencia alta o caída de CTR con suba de costo)
    if (last7.spend > 0 && prev7.spend > 0) {
      const freqHigh = (last7.frequency ?? 0) > 3;
      const ctrDrop = last7.ctr != null && prev7.ctr ? (prev7.ctr - last7.ctr) / prev7.ctr : 0;
      const cpaRise = last7.cost_per_result != null && prev7.cost_per_result
        ? (last7.cost_per_result - prev7.cost_per_result) / prev7.cost_per_result : 0;
      if (freqHigh || (ctrDrop > 0.3 && cpaRise > 0.3)) {
        out.push({
          project_id: project.id, type: "creative_fatigue", severity: "warning", level: "ad",
          entity_id: ad.id, entity_name: ad.name,
          message: freqHigh
            ? `Frecuencia ${last7.frequency?.toFixed(1)} en 7 días: la audiencia ya vio mucho este anuncio.`
            : `CTR cayó ${(ctrDrop * 100).toFixed(0)}% y el costo por resultado subió ${(cpaRise * 100).toFixed(0)}% vs. la semana anterior.`,
          data: { frequency: last7.frequency, ctr_drop: ctrDrop, cpa_rise: cpaRise }
        });
      }
    }
  }

  for (const as of activeAdsets) {
    const last7 = aggregate(windowRows(rows, "adset", as.id, 7));
    // 4) CPA por encima del objetivo / ROAS por debajo
    if (isCpa && goal && last7.results >= 2 && last7.cost_per_result != null && last7.cost_per_result > goal * 1.3) {
      out.push({
        project_id: project.id, type: "cpa_above_goal", severity: "warning", level: "adset",
        entity_id: as.id, entity_name: as.name,
        message: `CPA ${fmt(last7.cost_per_result, cur)} vs. objetivo ${fmt(goal, cur)} (+${(((last7.cost_per_result / goal) - 1) * 100).toFixed(0)}%) en 7 días.`,
        data: { cpa_7d: last7.cost_per_result, goal }
      });
    }
    if (!isCpa && goal && last7.spend > 0 && last7.purchases >= 2 && (last7.roas ?? 0) < goal * 0.7) {
      out.push({
        project_id: project.id, type: "cpa_above_goal", severity: "warning", level: "adset",
        entity_id: as.id, entity_name: as.name,
        message: `ROAS ${(last7.roas ?? 0).toFixed(2)}x vs. objetivo ${goal.toFixed(2)}x en 7 días.`,
        data: { roas_7d: last7.roas, goal }
      });
    }
  }

  return out;
}
