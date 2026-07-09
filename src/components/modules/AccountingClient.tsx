"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/ui/Topbar";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icons";
import { Kpi } from "@/components/ui/Kpi";
import { money } from "@/lib/format";

type Account = {
  id: string;
  code: string;
  name: string;
  type: "activo" | "pasivo" | "patrimonio_neto" | "ingreso" | "egreso";
  parent_id: string | null;
  is_imputable: boolean;
  active?: boolean;
};

type Line = {
  id: string;
  account_id: string;
  descripcion: string | null;
  debe: number;
  haber: number;
  ord: number;
  accounts?: { code: string; name: string; type: string };
};

type Entry = {
  id: string;
  numero: number;
  fecha: string;
  concepto: string;
  source: string;
  total_debe: number;
  total_haber: number;
  status: string;
  journal_entry_lines: Line[];
};

const TYPE_LABEL: Record<Account["type"], string> = {
  activo: "Activo",
  pasivo: "Pasivo",
  patrimonio_neto: "Patrimonio Neto",
  ingreso: "Ingreso",
  egreso: "Egreso"
};
const TYPE_TONE: Record<Account["type"], any> = {
  activo: "success",
  pasivo: "warning",
  patrimonio_neto: "info",
  ingreso: "compra",
  egreso: "danger"
};

export function AccountingClient({
  accounts: initialAccounts,
  entries: initialEntries,
  canEdit,
  hasCompany,
  company
}: {
  accounts: Account[];
  entries: Entry[];
  canEdit: boolean;
  hasCompany: boolean;
  company: { razon_social: string; cuit: string } | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"diario" | "plan" | "mayor" | "balance">("diario");
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [entries, setEntries] = useState<Entry[]>(initialEntries);

  const [openNewEntry, setOpenNewEntry] = useState(false);
  const [openNewAccount, setOpenNewAccount] = useState(false);

  if (!hasCompany) {
    return (
      <>
        <Topbar title="Contabilidad" />
        <div className="p-8">
          <div className="card p-6 border-l-4" style={{ borderLeftColor: "var(--accent)" }}>
            <div className="sf-display text-[16px] font-semibold mb-1">Primero creá tu empresa</div>
            <div className="text-[13px] text-ink-2 mb-3">
              La contabilidad se lleva por empresa. Andá a <a className="link" href="/settings">Configuración</a> para crearla.
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar
        title="Contabilidad"
        subtitle={company ? `${company.razon_social} · ${company.cuit}` : ""}
        right={canEdit && (
          <>
            {tab === "plan" && (
              <button className="btn btn-ghost" onClick={() => setOpenNewAccount(true)}>
                <Icon.Plus/> Nueva cuenta
              </button>
            )}
            {tab === "diario" && (
              <button className="btn btn-primary" onClick={() => setOpenNewEntry(true)}>
                <Icon.Plus/> Nuevo asiento
              </button>
            )}
          </>
        )}
      />
      <div className="p-8 space-y-6">
        {/* Tabs */}
        <div className="card p-1 flex gap-1 overflow-x-auto scroll-clean">
          {(["diario","plan","mayor","balance"] as const).map(t => (
            <button key={t}
                    onClick={() => setTab(t)}
                    className={`tab whitespace-nowrap ${tab === t ? "active" : ""}`}>
              {labelFor(t)}
            </button>
          ))}
        </div>

        {tab === "diario"  && <DiarioTab  accounts={accounts} entries={entries} canEdit={canEdit}
                                        onDeleted={(id) => setEntries(e => e.filter(x => x.id !== id))} />}
        {tab === "plan"    && <PlanTab    accounts={accounts} canEdit={canEdit}
                                        onChange={setAccounts}
                                        onSeeded={() => router.refresh()} />}
        {tab === "mayor"   && <MayorTab   accounts={accounts} entries={entries} />}
        {tab === "balance" && <BalanceTab accounts={accounts} entries={entries} />}
      </div>

      {openNewEntry && (
        <NewEntryModal
          accounts={accounts.filter(a => a.is_imputable)}
          onClose={() => setOpenNewEntry(false)}
          onCreated={(e) => { setEntries(prev => [e as any, ...prev]); setOpenNewEntry(false); router.refresh(); }}
        />
      )}
      {openNewAccount && (
        <NewAccountModal
          parents={accounts.filter(a => !a.is_imputable)}
          onClose={() => setOpenNewAccount(false)}
          onCreated={(a) => { setAccounts(prev => [...prev, a as any].sort((x, y) => x.code.localeCompare(y.code))); setOpenNewAccount(false); }}
        />
      )}
    </>
  );
}

function labelFor(t: "diario" | "plan" | "mayor" | "balance") {
  return t === "diario" ? "Libro Diario"
       : t === "plan"   ? "Plan de Cuentas"
       : t === "mayor"  ? "Libro Mayor"
       :                  "Balance de Sumas y Saldos";
}

// ============================================================================
// LIBRO DIARIO
// ============================================================================
function DiarioTab({ accounts, entries, canEdit, onDeleted }: {
  accounts: Account[]; entries: Entry[]; canEdit: boolean; onDeleted: (id: string) => void;
}) {
  async function deleteEntry(id: string, num: number) {
    if (!confirm(`¿Eliminar el asiento Nº ${num}? Esta acción no se puede deshacer.`)) return;
    const r = await fetch("/api/accounting/entries/delete", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id })
    });
    if (r.ok) onDeleted(id);
  }

  return (
    <>
      {entries.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center bg-brand-soft text-brand mb-4">
            <Icon.File/>
          </div>
          <div className="sf-display text-[18px] font-semibold mb-1">Todavía no cargaste asientos</div>
          <div className="text-[13px] text-ink-2 mb-3 max-w-md mx-auto">
            Empezá creando un asiento manual desde el botón de arriba. Antes asegurate de tener el plan de cuentas cargado.
          </div>
          {accounts.length === 0 && (
            <div className="text-[12px] text-ink-3">
              Tip: andá a la pestaña <b>Plan de Cuentas</b> y cargá el plan estándar para arrancar rápido.
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map(e => (
            <div key={e.id} className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-line flex items-center justify-between gap-3 bg-surface-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone="info">Nº {e.numero}</Badge>
                    <div className="sf-display text-[15px] font-semibold truncate">{e.concepto}</div>
                  </div>
                  <div className="text-[12px] text-ink-3 mt-0.5">
                    {e.fecha} · {e.source === "manual" ? "Manual" : e.source}
                  </div>
                </div>
                <div className="text-[12px] text-ink-2 shrink-0 text-right">
                  <div>Debe <b className="text-ink-1 font-mono">{money(Number(e.total_debe))}</b></div>
                  <div>Haber <b className="text-ink-1 font-mono">{money(Number(e.total_haber))}</b></div>
                </div>
                {canEdit && (
                  <button className="btn btn-ghost shrink-0" style={{padding:"6px 10px", color:"#f04f6f"}}
                          onClick={() => deleteEntry(e.id, e.numero)}>
                    <Icon.Close/>
                  </button>
                )}
              </div>
              <table className="clean">
                <thead>
                  <tr>
                    <th>Cuenta</th>
                    <th>Detalle</th>
                    <th className="text-right">Debe</th>
                    <th className="text-right">Haber</th>
                  </tr>
                </thead>
                <tbody>
                  {(e.journal_entry_lines ?? []).slice().sort((a,b) => a.ord - b.ord).map(l => (
                    <tr key={l.id}>
                      <td className="font-medium" title={l.accounts?.name}>
                        <span className="font-mono text-[12px] text-ink-3 mr-2">{l.accounts?.code}</span>
                        {l.accounts?.name}
                      </td>
                      <td className="text-ink-2">{l.descripcion ?? "—"}</td>
                      <td className="text-right font-mono">{Number(l.debe) > 0 ? money(Number(l.debe)) : ""}</td>
                      <td className="text-right font-mono">{Number(l.haber) > 0 ? money(Number(l.haber)) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ============================================================================
// PLAN DE CUENTAS
// ============================================================================
function PlanTab({
  accounts, canEdit, onChange, onSeeded
}: { accounts: Account[]; canEdit: boolean; onChange: (a: Account[]) => void; onSeeded: () => void }) {
  const [seeding, setSeeding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function seedDefault() {
    if (!confirm("Cargar el plan de cuentas estándar argentino para esta empresa?\n\nNo se duplican las que ya existan.")) return;
    setSeeding(true); setMsg(null);
    try {
      const r = await fetch("/api/accounting/accounts/seed", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setMsg(`✓ ${d.created} cuentas creadas, ${d.skipped} ya existían`);
      onSeeded();
    } catch (e: any) { setMsg("Error: " + e.message); }
    finally { setSeeding(false); }
  }

  async function deleteAccount(id: string, name: string) {
    if (!confirm(`¿Eliminar la cuenta "${name}"?\n\nSi tiene movimientos, se archivará en lugar de borrarse.`)) return;
    const r = await fetch("/api/accounting/accounts/delete", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id })
    });
    const d = await r.json();
    if (r.ok) onChange(accounts.filter(a => a.id !== id));
  }

  if (accounts.length === 0) {
    return (
      <div className="card p-12 text-center">
        <div className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center bg-brand-soft text-brand mb-4">
          <Icon.Folder/>
        </div>
        <div className="sf-display text-[18px] font-semibold mb-1">Tu plan de cuentas está vacío</div>
        <div className="text-[13px] text-ink-2 mb-5 max-w-md mx-auto">
          Cargá el plan estándar argentino para empezar (60+ cuentas predefinidas) o creá las tuyas manualmente.
        </div>
        {canEdit && (
          <button className="btn btn-primary" onClick={seedDefault} disabled={seeding}>
            <Icon.Sparkles/> {seeding ? "Cargando…" : "Cargar plan estándar"}
          </button>
        )}
        {msg && <div className="mt-3 text-[12px]">{msg}</div>}
      </div>
    );
  }

  // Agrupar por tipo
  const groups: Record<string, Account[]> = {};
  for (const a of accounts) {
    (groups[a.type] ??= []).push(a);
  }

  return (
    <div className="space-y-3">
      {msg && <div className="card p-3 text-[12px]">{msg}</div>}
      {(["activo","pasivo","patrimonio_neto","ingreso","egreso"] as const).map(t => {
        const list = groups[t] ?? [];
        if (!list.length) return null;
        return (
          <div key={t} className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-line bg-surface-2 flex items-center justify-between">
              <div className="sf-display text-[15px] font-semibold">{TYPE_LABEL[t]}</div>
              <Badge tone={TYPE_TONE[t]}>{list.length} cuentas</Badge>
            </div>
            <table className="clean">
              <thead>
                <tr><th>Código</th><th>Cuenta</th><th>Tipo</th><th></th></tr>
              </thead>
              <tbody>
                {list.map(a => (
                  <tr key={a.id}>
                    <td className="font-mono text-[12px] text-ink-2">{a.code}</td>
                    <td className={a.is_imputable ? "" : "font-semibold"}>
                      {!a.is_imputable && <span className="mr-2 text-[10px] uppercase tracking-wider text-ink-3">grupo</span>}
                      {a.name}
                    </td>
                    <td className="text-ink-2">{TYPE_LABEL[a.type]}</td>
                    <td className="text-right">
                      {canEdit && (
                        <button className="btn btn-ghost" style={{padding:"4px 8px", color:"#f04f6f"}}
                                onClick={() => deleteAccount(a.id, a.name)}>
                          <Icon.Close/>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// LIBRO MAYOR — movimientos de una cuenta + saldo progresivo
// ============================================================================
function MayorTab({ accounts, entries }: { accounts: Account[]; entries: Entry[] }) {
  const imputables = accounts.filter(a => a.is_imputable);
  const [accountId, setAccountId] = useState<string>("");

  const movimientos = useMemo(() => {
    if (!accountId) return [];
    const rows: { fecha: string; numero: number; concepto: string; debe: number; haber: number; saldo: number; descripcion: string | null }[] = [];
    let saldo = 0;
    const sorted = entries.slice().sort((a, b) => a.fecha.localeCompare(b.fecha) || a.numero - b.numero);
    for (const e of sorted) {
      for (const l of (e.journal_entry_lines ?? [])) {
        if (l.account_id !== accountId) continue;
        const debe = Number(l.debe) || 0;
        const haber = Number(l.haber) || 0;
        saldo += debe - haber;
        rows.push({
          fecha: e.fecha, numero: e.numero, concepto: e.concepto,
          debe, haber, saldo, descripcion: l.descripcion
        });
      }
    }
    return rows;
  }, [accountId, entries]);

  const totales = useMemo(() => {
    const debe = movimientos.reduce((a, b) => a + b.debe, 0);
    const haber = movimientos.reduce((a, b) => a + b.haber, 0);
    return { debe, haber, saldo: debe - haber };
  }, [movimientos]);

  const account = accounts.find(a => a.id === accountId);

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <div className="text-[12px] font-medium text-ink-2 mb-1">Cuenta a consultar</div>
        <select className="input" value={accountId} onChange={e => setAccountId(e.target.value)}>
          <option value="">— Elegí una cuenta —</option>
          {imputables.map(a => (
            <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
          ))}
        </select>
      </div>

      {accountId && account && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Kpi label="Total Debe"  value={money(totales.debe)}  hint={`${movimientos.length} movimientos`} />
            <Kpi label="Total Haber" value={money(totales.haber)} hint=" " />
            <Kpi label="Saldo"       value={money(Math.abs(totales.saldo))}
                 hint={totales.saldo >= 0 ? "Deudor" : "Acreedor"} />
          </div>

          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-line bg-surface-2">
              <div className="sf-display text-[15px] font-semibold">{account.code} — {account.name}</div>
              <div className="text-[12px] text-ink-3">{TYPE_LABEL[account.type]}</div>
            </div>
            <table className="clean">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Asiento</th>
                  <th>Concepto</th>
                  <th className="text-right">Debe</th>
                  <th className="text-right">Haber</th>
                  <th className="text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {movimientos.map((m, i) => (
                  <tr key={i}>
                    <td className="text-ink-2">{m.fecha}</td>
                    <td className="font-mono text-[12px]">Nº {m.numero}</td>
                    <td className="font-medium">{m.concepto}{m.descripcion ? ` — ${m.descripcion}` : ""}</td>
                    <td className="text-right font-mono">{m.debe > 0 ? money(m.debe) : ""}</td>
                    <td className="text-right font-mono">{m.haber > 0 ? money(m.haber) : ""}</td>
                    <td className="text-right font-mono font-semibold"
                        style={{ color: m.saldo >= 0 ? "#176a4a" : "#9c2944" }}>
                      {money(Math.abs(m.saldo))} {m.saldo >= 0 ? "D" : "A"}
                    </td>
                  </tr>
                ))}
                {!movimientos.length && (
                  <tr><td colSpan={6} className="text-center py-8 text-ink-3">Sin movimientos en esta cuenta.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// BALANCE DE SUMAS Y SALDOS
// ============================================================================
function BalanceTab({ accounts, entries }: { accounts: Account[]; entries: Entry[] }) {
  const rows = useMemo(() => {
    const map = new Map<string, { debe: number; haber: number }>();
    for (const e of entries) {
      for (const l of (e.journal_entry_lines ?? [])) {
        const cur = map.get(l.account_id) ?? { debe: 0, haber: 0 };
        cur.debe += Number(l.debe) || 0;
        cur.haber += Number(l.haber) || 0;
        map.set(l.account_id, cur);
      }
    }
    return accounts
      .filter(a => a.is_imputable)
      .map(a => {
        const t = map.get(a.id) ?? { debe: 0, haber: 0 };
        const saldo = t.debe - t.haber;
        return {
          ...a,
          debe: t.debe, haber: t.haber,
          saldoDeudor:   saldo > 0 ? saldo : 0,
          saldoAcreedor: saldo < 0 ? -saldo : 0
        };
      })
      .filter(r => r.debe > 0 || r.haber > 0)
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [accounts, entries]);

  const tot = useMemo(() => rows.reduce((acc, r) => ({
    debe: acc.debe + r.debe,
    haber: acc.haber + r.haber,
    deudor: acc.deudor + r.saldoDeudor,
    acreedor: acc.acreedor + r.saldoAcreedor
  }), { debe: 0, haber: 0, deudor: 0, acreedor: 0 }), [rows]);

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-line bg-surface-2">
        <div className="sf-display text-[15px] font-semibold">Balance de sumas y saldos</div>
        <div className="text-[12px] text-ink-3">{rows.length} cuentas con movimiento</div>
      </div>
      <table className="clean">
        <thead>
          <tr>
            <th>Código</th>
            <th>Cuenta</th>
            <th className="text-right">Debe</th>
            <th className="text-right">Haber</th>
            <th className="text-right">Saldo Deudor</th>
            <th className="text-right">Saldo Acreedor</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="font-mono text-[12px] text-ink-2">{r.code}</td>
              <td className="font-medium">{r.name}</td>
              <td className="text-right font-mono">{money(r.debe)}</td>
              <td className="text-right font-mono">{money(r.haber)}</td>
              <td className="text-right font-mono" style={{ color: r.saldoDeudor > 0 ? "#176a4a" : "#86868b" }}>
                {r.saldoDeudor > 0 ? money(r.saldoDeudor) : ""}
              </td>
              <td className="text-right font-mono" style={{ color: r.saldoAcreedor > 0 ? "#9c2944" : "#86868b" }}>
                {r.saldoAcreedor > 0 ? money(r.saldoAcreedor) : ""}
              </td>
            </tr>
          ))}
          <tr style={{ background: "var(--surface-2)", borderTop: "2px solid var(--line-2)" }}>
            <td colSpan={2} className="font-bold">TOTALES</td>
            <td className="text-right font-mono font-bold">{money(tot.debe)}</td>
            <td className="text-right font-mono font-bold">{money(tot.haber)}</td>
            <td className="text-right font-mono font-bold">{money(tot.deudor)}</td>
            <td className="text-right font-mono font-bold">{money(tot.acreedor)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// MODAL: NUEVO ASIENTO
// ============================================================================
function NewEntryModal({
  accounts, onClose, onCreated
}: { accounts: Account[]; onClose: () => void; onCreated: (e: any) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [fecha, setFecha] = useState(today);
  const [concepto, setConcepto] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [lines, setLines] = useState<{ account_id: string; descripcion: string; debe: string; haber: string }[]>([
    { account_id: "", descripcion: "", debe: "", haber: "" },
    { account_id: "", descripcion: "", debe: "", haber: "" }
  ]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const totalDebe = lines.reduce((a, l) => a + (Number(l.debe.replace(",", ".")) || 0), 0);
  const totalHaber = lines.reduce((a, l) => a + (Number(l.haber.replace(",", ".")) || 0), 0);
  const balance = totalDebe - totalHaber;
  const balanced = Math.abs(balance) < 0.01 && totalDebe > 0;

  function setLine(i: number, patch: Partial<typeof lines[0]>) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }
  function addLine() { setLines(prev => [...prev, { account_id: "", descripcion: "", debe: "", haber: "" }]); }
  function removeLine(i: number) { if (lines.length > 2) setLines(prev => prev.filter((_, idx) => idx !== i)); }

  async function save() {
    setErr(null);
    if (!concepto.trim()) return setErr("El concepto es obligatorio.");
    if (!fecha) return setErr("La fecha es obligatoria.");

    const cleaned = lines.map(l => ({
      account_id: l.account_id,
      descripcion: l.descripcion.trim() || null,
      debe:  Number(l.debe.replace(",", "."))  || 0,
      haber: Number(l.haber.replace(",", ".")) || 0
    }));

    setSaving(true);
    try {
      const r = await fetch("/api/accounting/entries", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ fecha, concepto: concepto.trim(), observaciones: observaciones.trim() || null, lines: cleaned })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      onCreated(d.entry);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="modal-back" onClick={onClose}/>
      <div className="fixed inset-6 card soft p-6 z-30 fade-in overflow-y-auto scroll-clean">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-[12px] uppercase tracking-wider text-ink-3">Libro Diario</div>
            <div className="sf-display text-[22px] font-semibold mt-1">Nuevo asiento</div>
          </div>
          <button className="btn btn-ghost" style={{padding:"6px 10px"}} onClick={onClose}><Icon.Close/></button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div>
            <div className="text-[11px] font-medium text-ink-2 mb-1">Fecha *</div>
            <input className="input" type="date" value={fecha} onChange={e => setFecha(e.target.value)}/>
          </div>
          <div className="md:col-span-2">
            <div className="text-[11px] font-medium text-ink-2 mb-1">Concepto *</div>
            <input className="input" value={concepto} onChange={e => setConcepto(e.target.value)} placeholder="Ej: Venta a cliente X"/>
          </div>
        </div>

        <div className="card overflow-hidden mb-3">
          <table className="clean">
            <thead>
              <tr>
                <th style={{width: "30%"}}>Cuenta</th>
                <th>Detalle</th>
                <th className="text-right" style={{width: "130px"}}>Debe</th>
                <th className="text-right" style={{width: "130px"}}>Haber</th>
                <th style={{width: "40px"}}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <select className="input" value={l.account_id} onChange={e => setLine(i, { account_id: e.target.value })}>
                      <option value="">— Cuenta —</option>
                      {accounts.map(a => (
                        <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className="input" value={l.descripcion} onChange={e => setLine(i, { descripcion: e.target.value })} placeholder="Detalle (opcional)"/>
                  </td>
                  <td>
                    <input className="input text-right" inputMode="decimal" value={l.debe}
                           onChange={e => setLine(i, { debe: e.target.value.replace(/[^\d.,]/g, ""), haber: "" })}/>
                  </td>
                  <td>
                    <input className="input text-right" inputMode="decimal" value={l.haber}
                           onChange={e => setLine(i, { haber: e.target.value.replace(/[^\d.,]/g, ""), debe: "" })}/>
                  </td>
                  <td className="text-right">
                    {lines.length > 2 && (
                      <button onClick={() => removeLine(i)} className="text-ink-3 hover:text-danger px-2"><Icon.Close/></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mb-4">
          <button className="btn btn-ghost" onClick={addLine}><Icon.Plus/> Agregar línea</button>
          <div className="flex items-center gap-4 text-[13px]">
            <span>Debe <b className="font-mono ml-1">{money(totalDebe)}</b></span>
            <span>Haber <b className="font-mono ml-1">{money(totalHaber)}</b></span>
            <Badge tone={balanced ? "success" : "danger"}>
              {balanced
                ? "✓ Balancea"
                : `Diferencia: ${money(Math.abs(balance))}`}
            </Badge>
          </div>
        </div>

        <div>
          <div className="text-[11px] font-medium text-ink-2 mb-1">Observaciones</div>
          <textarea className="input" rows={2} value={observaciones} onChange={e => setObservaciones(e.target.value)}/>
        </div>

        {err && <div className="mt-3 p-2.5 rounded-lg bg-[#fdeaef] text-[#9c2944] text-[12px]">{err}</div>}

        <div className="flex justify-end gap-2 mt-5">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !balanced}>
            <Icon.Check/> {saving ? "Guardando…" : "Guardar asiento"}
          </button>
        </div>
      </div>
    </>
  );
}

// ============================================================================
// MODAL: NUEVA CUENTA
// ============================================================================
function NewAccountModal({
  parents, onClose, onCreated
}: { parents: Account[]; onClose: () => void; onCreated: (a: any) => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<Account["type"]>("activo");
  const [parent_id, setParentId] = useState<string>("");
  const [is_imputable, setImputable] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (!code.trim() || !name.trim()) return setErr("Código y nombre obligatorios.");
    setSaving(true);
    try {
      const r = await fetch("/api/accounting/accounts", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          type,
          parent_id: parent_id || null,
          is_imputable
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      onCreated(d.account);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="modal-back" onClick={onClose}/>
      <div className="fixed right-6 top-6 bottom-6 w-[480px] card soft p-6 z-30 fade-in overflow-y-auto scroll-clean">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-[12px] uppercase tracking-wider text-ink-3">Plan de Cuentas</div>
            <div className="sf-display text-[20px] font-semibold mt-1">Nueva cuenta</div>
          </div>
          <button className="btn btn-ghost" style={{padding:"6px 10px"}} onClick={onClose}><Icon.Close/></button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] font-medium text-ink-2 mb-1">Código *</div>
              <input className="input font-mono" value={code} onChange={e => setCode(e.target.value)} placeholder="1.1.99"/>
            </div>
            <div>
              <div className="text-[11px] font-medium text-ink-2 mb-1">Tipo *</div>
              <select className="input" value={type} onChange={e => setType(e.target.value as any)}>
                <option value="activo">Activo</option>
                <option value="pasivo">Pasivo</option>
                <option value="patrimonio_neto">Patrimonio Neto</option>
                <option value="ingreso">Ingreso</option>
                <option value="egreso">Egreso</option>
              </select>
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-ink-2 mb-1">Nombre *</div>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Caja chica"/>
          </div>
          <div>
            <div className="text-[11px] font-medium text-ink-2 mb-1">Cuenta padre (opcional)</div>
            <select className="input" value={parent_id} onChange={e => setParentId(e.target.value)}>
              <option value="">— Sin padre —</option>
              {parents.map(a => (
                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={is_imputable} onChange={e => setImputable(e.target.checked)}/>
            Cuenta imputable (se pueden hacer asientos en ella)
          </label>

          {err && <div className="p-2.5 rounded-lg bg-[#fdeaef] text-[#9c2944] text-[12px]">{err}</div>}

          <div className="flex justify-end gap-2 mt-4">
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              <Icon.Check/> {saving ? "Guardando…" : "Crear cuenta"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
