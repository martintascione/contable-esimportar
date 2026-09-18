"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icons";

export type Action = {
  id: string; type: "pause" | "activate" | "set_budget"; level: string; entity_id: string; entity_name: string | null;
  payload: any; reason: string | null; status: string; rule_type: string | null; executed_by: string | null;
  proposed_at: string; decided_at: string | null; executed_at: string | null; error: string | null;
};
export type Rule = { id: string; name: string; type: string; config: Record<string, any>; enabled: boolean; mode: "manual" | "auto" };
export type Summary = { date: string; text: string; content: any; emailed_at: string | null } | null;

function money(n: number | null | undefined, cur: string) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  try { return new Intl.NumberFormat("es-AR", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(Number(n)); } catch { return `${cur} ${n}`; }
}
function when(s: string | null) {
  if (!s) return "";
  const d = new Date(s);
  const pad = (n: number) => String(n).padStart(2, "0");
  // Hora de Buenos Aires, calculada a mano para que servidor y cliente rendericen lo mismo
  const ba = new Date(d.getTime() - 3 * 3600 * 1000);
  return `${pad(ba.getUTCDate())}/${pad(ba.getUTCMonth() + 1)} ${pad(ba.getUTCHours())}:${pad(ba.getUTCMinutes())}`;
}
const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  proposed: { label: "Pendiente", tone: "warning" }, approved: { label: "Aprobada", tone: "info" },
  executed: { label: "Ejecutada", tone: "success" }, rejected: { label: "Rechazada", tone: "default" },
  failed: { label: "Falló", tone: "danger" }, expired: { label: "Vencida", tone: "default" }
};
const RULE_LABEL: Record<string, string> = { pause_bad_ad: "Pausar malos", budget_down: "Bajar presupuesto", budget_up: "Escalar ganadores", reactivate: "Reactivar" };

export function ActionTitle({ a, cur }: { a: Action; cur: string }) {
  const lvl = a.level === "ad" ? "anuncio" : a.level === "adset" ? "conjunto" : "campaña";
  if (a.type === "pause") return <>Pausar {lvl} <b>{a.entity_name}</b></>;
  if (a.type === "activate") return <>Reactivar {lvl} <b>{a.entity_name}</b></>;
  const pct = Number(a.payload?.pct ?? 0);
  return <>{pct > 0 ? "Subir" : "Bajar"} presupuesto {pct > 0 ? "+" : ""}{pct}% en <b>{a.entity_name}</b>: {money(a.payload?.from_daily_budget, cur)} → <b>{money(a.payload?.daily_budget, cur)}</b>/día</>;
}

/** Modo de automatización del proyecto (off / manual / auto). */
export function AutomationSwitch({ projectId, mode, pending }: { projectId: string; mode: string; pending: number }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  async function set(m: string) {
    if (m === "auto" && !confirm("En modo automático las reglas marcadas como automáticas se ejecutan en Meta sin pedirte aprobación. ¿Activar?")) return;
    setSaving(true);
    await fetch("/api/meta/projects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: projectId, automation_mode: m }) });
    setSaving(false); router.refresh();
  }
  return (
    <div className="flex items-center gap-1 p-1 rounded-xl border border-line bg-white">
      {([["off", "Apagada"], ["manual", "Con aprobación"], ["auto", "Automática"]] as const).map(([k, l]) => (
        <button key={k} disabled={saving} onClick={() => set(k)}
          className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition ${mode === k ? (k === "auto" ? "bg-ok-soft text-ok" : k === "manual" ? "bg-brand-soft text-brand" : "bg-[#ececf0] text-ink") : "text-ink-2 hover:bg-[#f0f0f2]"}`}>
          {l}{k === "manual" && pending > 0 && mode === "manual" ? ` · ${pending}` : ""}
        </button>
      ))}
    </div>
  );
}

/** Bandeja de acciones propuestas + historial. */
export function ActionsCard({ projectId, actions, currency, mode }: { projectId: string; actions: Action[]; currency: string; mode: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [err, setErr] = useState<string | null>(null);
  const pending = actions.filter(a => a.status === "proposed");
  const history = actions.filter(a => a.status !== "proposed");

  async function post(body: any, key: string) {
    setBusy(key); setErr(null);
    try {
      const r = await fetch("/api/meta/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || j.ok === false) throw new Error(j.error ?? "Error");
      router.refresh();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(null); }
  }

  return (
    <div className="card p-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-3">
        <div>
          <div className="sf-display text-[15px] font-semibold">Acciones</div>
          <div className="text-[12px] text-ink-3">
            {mode === "off" ? "Automatización apagada: no se proponen acciones." : mode === "manual" ? "Se proponen en cada sincronización; se ejecutan en Meta solo si las aprobás." : "Las reglas automáticas se ejecutan solas; el resto pide aprobación."}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-2 border border-line">
            <button onClick={() => setTab("pending")} className={`px-3 py-1.5 rounded-lg text-[13px] font-medium ${tab === "pending" ? "bg-white shadow-sm" : "text-ink-2"}`}>Pendientes <span className="text-ink-3">{pending.length}</span></button>
            <button onClick={() => setTab("history")} className={`px-3 py-1.5 rounded-lg text-[13px] font-medium ${tab === "history" ? "bg-white shadow-sm" : "text-ink-2"}`}>Historial <span className="text-ink-3">{history.length}</span></button>
          </div>
          {mode !== "off" && (
            <button className="btn btn-ghost" style={{ padding: "6px 12px" }} disabled={!!busy} onClick={() => post({ projectId, evaluate: true }, "eval")}>
              <Icon.Sparkles /> {busy === "eval" ? "Evaluando…" : "Evaluar ahora"}
            </button>
          )}
        </div>
      </div>
      {err && <div className="text-[13px] text-danger mb-3">{err}</div>}

      {tab === "pending" && (
        <>
          {pending.length === 0 && <div className="text-[13px] text-ink-3 py-8 text-center">No hay acciones pendientes.</div>}
          {pending.length > 1 && (
            <div className="flex justify-end mb-2">
              <button className="btn btn-primary" style={{ padding: "6px 12px" }} disabled={!!busy} onClick={() => { if (confirm(`¿Aprobar y ejecutar las ${pending.length} acciones en Meta?`)) post({ projectId, decision: "approve_all" }, "all"); }}>
                <Icon.Check /> {busy === "all" ? "Ejecutando…" : `Aprobar todas (${pending.length})`}
              </button>
            </div>
          )}
          <div className="space-y-2">
            {pending.map(a => (
              <div key={a.id} className="p-4 rounded-xl border border-line bg-surface-2">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge tone={a.type === "pause" ? "danger" : a.type === "activate" ? "info" : Number(a.payload?.pct) > 0 ? "success" : "warning"}>{RULE_LABEL[a.rule_type ?? ""] ?? a.type}</Badge>
                      <span className="text-[11px] text-ink-3" suppressHydrationWarning>{when(a.proposed_at)}</span>
                    </div>
                    <div className="text-[14px]"><ActionTitle a={a} cur={currency} /></div>
                    <div className="text-[12px] text-ink-2 mt-1">{a.reason}</div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button className="btn btn-ghost" style={{ padding: "6px 12px" }} disabled={!!busy} onClick={() => post({ id: a.id, decision: "reject" }, a.id)}>Rechazar</button>
                    <button className="btn btn-primary" style={{ padding: "6px 12px" }} disabled={!!busy} onClick={() => post({ id: a.id, decision: "approve" }, a.id)}><Icon.Check /> {busy === a.id ? "…" : "Aprobar"}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "history" && (
        <div className="overflow-x-auto scroll-clean -mx-5">
          <table className="clean">
            <thead><tr><th>Fecha</th><th>Acción</th><th>Estado</th><th>Por</th></tr></thead>
            <tbody>
              {history.length === 0 && <tr><td colSpan={4} className="text-center text-ink-3 py-8">Todavía no hay acciones registradas.</td></tr>}
              {history.map(a => (
                <tr key={a.id}>
                  <td className="text-ink-2" suppressHydrationWarning>{when(a.executed_at ?? a.decided_at ?? a.proposed_at)}</td>
                  <td className="truncate max-w-[520px]"><div className="truncate"><ActionTitle a={a} cur={currency} /></div>{a.error && <div className="text-[11px] text-danger">{a.error}</div>}</td>
                  <td><Badge tone={STATUS[a.status]?.tone ?? "default"}>{STATUS[a.status]?.label ?? a.status}</Badge></td>
                  <td className="text-ink-2">{a.executed_by === "auto" ? "Automático" : a.executed_by === "user" ? "Vos" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Reglas del proyecto (editables). */
export function RulesCard({ projectId, rules: initial, currency, goalType, projectMode }: { projectId: string; rules: Rule[]; currency: string; goalType: string; projectMode: string }) {
  const router = useRouter();
  const [rules, setRules] = useState<Rule[]>(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  function patch(id: string, p: Partial<Rule>) { setRules(rs => rs.map(r => r.id === id ? { ...r, ...p } : r)); setDirty(true); }
  function cfg(id: string, k: string, v: any) { setRules(rs => rs.map(r => r.id === id ? { ...r, config: { ...r.config, [k]: v } } : r)); setDirty(true); }
  async function save() {
    setSaving(true);
    await fetch("/api/meta/rules", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, rules: rules.map(r => ({ id: r.id, name: r.name, enabled: r.enabled, mode: r.mode, config: r.config })) }) });
    setSaving(false); setDirty(false); router.refresh();
  }
  async function seed() {
    setSaving(true);
    const r = await fetch(`/api/meta/rules?project=${projectId}`, { cache: "no-store" });
    const j = await r.json(); setRules(j.rules ?? []); setSaving(false);
  }
  const objLabel = goalType === "roas" ? "ROAS objetivo" : "CPA objetivo";

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="sf-display text-[15px] font-semibold">Reglas</div>
          <div className="text-[12px] text-ink-3">Cada regla puede pedir aprobación o ejecutarse sola (solo cuando el proyecto está en modo automático).</div>
        </div>
        {dirty && <button className="btn btn-primary" style={{ padding: "6px 12px" }} onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>}
      </div>
      {rules.length === 0 && (
        <div className="text-[13px] text-ink-3 py-6 text-center">
          Este proyecto todavía no tiene reglas. <button className="underline" onClick={seed}>Crear las reglas por defecto</button>
        </div>
      )}
      <div className="space-y-2">
        {rules.map(r => (
          <div key={r.id} className={`rounded-xl border border-line ${r.enabled ? "bg-surface-2" : "bg-white opacity-70"}`}>
            <div className="flex items-center gap-3 p-3">
              <button onClick={() => patch(r.id, { enabled: !r.enabled })} className={`w-10 h-6 rounded-full relative transition shrink-0 ${r.enabled ? "bg-ok" : "bg-[#d2d2d7]"}`} title={r.enabled ? "Desactivar" : "Activar"}>
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition ${r.enabled ? "left-[18px]" : "left-0.5"}`} />
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold truncate">{r.name}</div>
                <div className="text-[11px] text-ink-3">{RULE_LABEL[r.type] ?? r.type}</div>
              </div>
              <select className="input text-[12px]" style={{ padding: "5px 8px", width: "auto", maxWidth: 150 }} value={r.mode} onChange={e => patch(r.id, { mode: e.target.value as any })} disabled={!r.enabled}>
                <option value="manual">Pide aprobación</option>
                <option value="auto">Automática</option>
              </select>
              <button className="w-8 h-8 rounded-lg hover:bg-[#ececf0] flex items-center justify-center text-ink-3" onClick={() => setOpen(open === r.id ? null : r.id)}><Icon.Chevron style={{ transform: open === r.id ? "rotate(90deg)" : undefined }} /></button>
            </div>
            {open === r.id && (
              <div className="px-3 pb-3 grid grid-cols-2 md:grid-cols-4 gap-2 border-t border-line pt-3">
                {r.type === "pause_bad_ad" && <>
                  <NumField value={r.config.window_days} onChange={v => cfg(r.id, "window_days", v)} label="Ventana (días)" />
                  <NumField value={r.config.no_result_spend_x} onChange={v => cfg(r.id, "no_result_spend_x", v)} label={`Sin resultados: gasto ≥ X × ${objLabel}`} step={0.5} hint="Ej. 2 = gastó el doble del objetivo en 3 días sin resultados" />
                  <NumField value={r.config.bad_cpa_x} onChange={v => cfg(r.id, "bad_cpa_x", v)} label="Costo ≥ X × objetivo" step={0.1} hint="con al menos los resultados de abajo" />
                  <NumField value={r.config.min_results} onChange={v => cfg(r.id, "min_results", v)} label="Resultados mínimos" />
                  <NumField value={r.config.cooldown_days} onChange={v => cfg(r.id, "cooldown_days", v)} label="Espera entre acciones (días)" />
                </>}
                {(r.type === "budget_down" || r.type === "budget_up") && <>
                  <NumField value={r.config.pct} onChange={v => cfg(r.id, "pct", v)} label="Cambio de presupuesto (%)" hint="Recomendado 15–20" />
                  <NumField value={r.config.cpa_x} onChange={v => cfg(r.id, "cpa_x", v)} label={r.type === "budget_up" ? "Costo ≤ X × objetivo" : "Costo ≥ X × objetivo"} step={0.05} />
                  <NumField value={r.config[r.type === "budget_up" ? "min_results_up" : "min_results"]} onChange={v => cfg(r.id, r.type === "budget_up" ? "min_results_up" : "min_results", v)} label="Resultados mínimos en la ventana" />
                  <NumField value={r.config.window_days} onChange={v => cfg(r.id, "window_days", v)} label="Ventana (días)" hint="3–7" />
                  <NumField value={r.config.cooldown_days} onChange={v => cfg(r.id, "cooldown_days", v)} label="Espera entre cambios (días)" hint="3–7, respeta la fase de aprendizaje" />
                  <label className="flex items-center gap-2 text-[12px] col-span-2 mt-4">
                    <input type="checkbox" checked={r.config.respect_learning ?? true} onChange={e => cfg(r.id, "respect_learning", e.target.checked)} /> No tocar conjuntos en fase de aprendizaje
                  </label>
                </>}
                {r.type === "reactivate" && <>
                  <NumField value={r.config.days_paused} onChange={v => cfg(r.id, "days_paused", v)} label="Días desde la pausa" />
                  <NumField value={r.config.cooldown_days} onChange={v => cfg(r.id, "cooldown_days", v)} label="Espera entre reactivaciones (días)" />
                </>}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="text-[11px] text-ink-3 mt-3">Guardrails: los cambios de presupuesto respetan el piso y techo por conjunto definidos en Ajustes del proyecto ({currency}). Una sola acción por entidad por evaluación; las propuestas vencen a las 48 h.</div>
    </div>
  );
}

/** Resumen diario. */
export function SummaryCard({ projectId, summary }: { projectId: string; summary: Summary }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(summary?.text ?? null);
  async function gen(email: boolean) {
    setBusy(true);
    const r = await fetch("/api/meta/summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, email }) });
    const j = await r.json(); setText(j.text ?? null); setBusy(false); router.refresh();
  }
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="sf-display text-[15px] font-semibold">Resumen diario</div>
          <div className="text-[12px] text-ink-3">{summary ? `Último: ${summary.date}${summary.emailed_at ? " · enviado por email" : ""}` : "Se genera cada mañana con la primera sincronización."}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost" style={{ padding: "6px 12px" }} onClick={() => gen(false)} disabled={busy}>{busy ? "…" : "Generar ahora"}</button>
          <button className="btn btn-ghost" style={{ padding: "6px 12px" }} onClick={() => gen(true)} disabled={busy} title="Requiere RESEND_API_KEY en Configuración">Enviar email</button>
        </div>
      </div>
      {text ? <pre className="text-[12px] leading-relaxed whitespace-pre-wrap font-sans text-ink-2 bg-surface-2 border border-line rounded-xl p-4">{text}</pre>
        : <div className="text-[13px] text-ink-3 py-6 text-center">Todavía no hay resumen.</div>}
    </div>
  );
}

function NumField({ label, step = 1, hint, value, onChange }: { label: string; step?: number; hint?: string; value: any; onChange: (v: number | undefined) => void }) {
  return (
    <label className="block">
      <div className="text-[11px] text-ink-3 mb-1">{label}</div>
      <input type="number" step={step} className="input" style={{ padding: "6px 10px" }} value={value ?? ""} onChange={e => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
      {hint && <div className="text-[10px] text-ink-3 mt-0.5">{hint}</div>}
    </label>
  );
}
