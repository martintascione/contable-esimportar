"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/ui/Topbar";
import { Kpi } from "@/components/ui/Kpi";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icons";
import { money } from "@/lib/format";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { createClient } from "@/lib/supabase/client";
import type { BankMovement, Invoice } from "@/lib/supabase/types";

type MovementEnriched = BankMovement & {
  banco?: string | null;
  cuenta?: string | null;
  cuit_contraparte?: string | null;
  nombre_contraparte?: string | null;
  es_transferencia?: boolean | null;
  es_cuenta_propia?: boolean | null;
  socio_nombre?: string | null;
  socio_relacion?: string | null;
};
type Statement = {
  id: string;
  banco: string;
  cuenta: string | null;
  cbu: string | null;
  periodo_desde: string | null;
  periodo_hasta: string | null;
  storage_path?: string | null;
  original_filename?: string | null;
  created_at: string;
};
type Partner = {
  id: string;
  nombre: string;
  cuit: string | null;
  dni: string | null;
  relacion: string;
  porcentaje: number | null;
  observaciones: string | null;
};
type BankFileReview = {
  id: string;
  company_id: string;
  storage_path: string;
  entity_type: string;
  reviewed_by: string;
  reviewed_at: string;
  note: string | null;
  status: "ok" | "con_observacion" | "con_error";
};
type Reviewer = { id: string; email: string | null; full_name: string | null };
type Props = {
  movements: MovementEnriched[];
  invoices: Pick<Invoice, "id" | "comprobante" | "razon_social" | "cuit" | "fecha" | "tipo" | "total">[];
  statements: Statement[];
  partners?: Partner[];
  fileReviews?: BankFileReview[];
  reviewers?: Reviewer[];
};

const MESES_ABREV = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
function ymKey(fecha: string) { return fecha?.slice(0, 7) ?? ""; } // "YYYY-MM"
function formatCuitDisplay(c?: string | null) {
  if (!c) return "";
  const d = c.replace(/\D/g, "");
  if (d.length !== 11) return c;
  return `${d.slice(0,2)}-${d.slice(2,10)}-${d.slice(10)}`;
}
function ymLabel(ym: string) {
  if (!ym) return "—";
  const [y, m] = ym.split("-");
  return `${MESES_ABREV[Number(m) - 1] ?? ""} ${y}`;
}

export function BankClient({ movements: initial, invoices, statements, partners: initialPartners = [], fileReviews: initialReviews = [], reviewers = [] }: Props) {
  const router = useRouter();
  const [movements, setMovements] = useState<MovementEnriched[]>(initial);
  const [fileReviews, setFileReviews] = useState<BankFileReview[]>(initialReviews);
  const [showFilesModal, setShowFilesModal] = useState(false);
  const [banco, setBanco] = useState<string>("__todos__");
  const [periodo, setPeriodo] = useState<string>("__todos__"); // "__todos__" | "YYYY-MM"
  const [tipoParte, setTipoParte] = useState<"todos" | "propia" | "tercero" | "socios" | "sin_cuit">("todos");
  const [monedaFiltro, setMonedaFiltro] = useState<"todas" | "ARS" | "USD" | "EUR">("todas");
  const [q, setQ] = useState("");
  const [modal, setModal] = useState<MovementEnriched | null>(null);
  const [reclassifying, setReclassifying] = useState(false);
  const [reclassMsg, setReclassMsg] = useState<string | null>(null);
  const [partners, setPartners] = useState<Partner[]>(initialPartners);
  const [addingPartner, setAddingPartner] = useState(false);

  async function reclassify() {
    setReclassifying(true); setReclassMsg(null);
    try {
      const r = await fetch("/api/bank/reclassify", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setReclassMsg(`${d.updated} movimientos procesados · ${d.conCuit} con CUIT detectado · ${d.propias} de cuenta propia`);
      // Refrescar la página para leer los valores actualizados
      setTimeout(() => router.refresh(), 600);
    } catch (e: any) {
      setReclassMsg("Error: " + e.message);
    } finally { setReclassifying(false); }
  }

  // Bancos dinámicos: desde los movimientos reales + los statements
  const bancos = useMemo(() => {
    const set = new Set<string>();
    movements.forEach(m => { if (m.banco) set.add(m.banco); });
    statements.forEach(s => { if (s.banco) set.add(s.banco); });
    return Array.from(set).sort();
  }, [movements, statements]);

  // Meses disponibles para el banco actualmente seleccionado
  const mesesDelBanco = useMemo(() => {
    const source = banco === "__todos__"
      ? movements
      : movements.filter(m => m.banco === banco);
    const map = new Map<string, number>();
    source.forEach(m => {
      const k = ymKey(m.fecha);
      if (!k) return;
      map.set(k, (map.get(k) ?? 0) + 1);
    });
    return Array.from(map.entries())
      .map(([ym, count]) => ({ ym, count }))
      .sort((a, b) => b.ym.localeCompare(a.ym)); // más recientes primero
  }, [movements, banco]);

  // Si el período actual no existe para el banco recién elegido, caer a "todos"
  const periodoEfectivo = useMemo(() => {
    if (periodo === "__todos__") return "__todos__";
    return mesesDelBanco.some(m => m.ym === periodo) ? periodo : "__todos__";
  }, [periodo, mesesDelBanco]);

  // Set de CUITs y DNIs de socios para detección rápida
  const partnerCuits = useMemo(() => {
    const s = new Set<string>();
    for (const p of partners) {
      if (p.cuit) s.add(normCuit(p.cuit));
      if (p.dni) s.add(normCuit(p.dni));
    }
    return s;
  }, [partners]);

  // Mapa de CUIT/DNI → info del socio (para mostrar nombre en la tabla)
  const partnerByDoc = useMemo(() => {
    const m = new Map<string, Partner>();
    for (const p of partners) {
      if (p.cuit) m.set(normCuit(p.cuit), p);
      if (p.dni) m.set(normCuit(p.dni), p);
    }
    return m;
  }, [partners]);

  // Detecta si un movimiento es de un socio (por match con CUIT o DNI cargado)
  function isPartnerMovement(m: MovementEnriched): Partner | null {
    if (!m.cuit_contraparte) return null;
    const c = normCuit(m.cuit_contraparte);
    if (partnerByDoc.has(c)) return partnerByDoc.get(c)!;
    // Fallback: si el CUIT termina en un DNI del socio
    for (const [doc, p] of partnerByDoc.entries()) {
      if (doc.length <= 8 && c.endsWith(doc)) return p;
    }
    return null;
  }

  const filteredBase = useMemo(() => {
    let rows = movements;
    if (banco !== "__todos__") rows = rows.filter(m => m.banco === banco);
    if (periodoEfectivo !== "__todos__") rows = rows.filter(m => ymKey(m.fecha) === periodoEfectivo);
    if (tipoParte === "propia")   rows = rows.filter(m => m.es_cuenta_propia);
    if (tipoParte === "tercero")  rows = rows.filter(m => m.cuit_contraparte && !m.es_cuenta_propia && !isPartnerMovement(m));
    if (tipoParte === "socios")   rows = rows.filter(m => isPartnerMovement(m) !== null);
    if (tipoParte === "sin_cuit") rows = rows.filter(m => !m.cuit_contraparte);
    // Filtro por moneda: importante porque los montos no son homogéneos
    if (monedaFiltro !== "todas") {
      rows = rows.filter(m => (m.moneda ?? "ARS") === monedaFiltro);
    }
    if (q) {
      const s = q.toLowerCase();
      rows = rows.filter(m =>
        (m.descripcion + (m.referencia ?? "") + (m.nombre_contraparte ?? "") + (m.cuit_contraparte ?? ""))
          .toLowerCase().includes(s)
      );
    }
    // Enriquecer cada movimiento con la info del socio si coincide
    const enriched = rows.map(m => {
      const socio = isPartnerMovement(m);
      if (!socio) return m;
      return { ...m, socio_nombre: socio.nombre, socio_relacion: socio.relacion };
    });
    return enriched.slice().sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [movements, banco, periodoEfectivo, tipoParte, monedaFiltro, q, partnerByDoc]);

  // Totales SEPARADOS por moneda — porque ARS y USD no se pueden sumar juntos.
  // Devuelve un objeto por moneda con {ingresos, egresos, saldo, count}.
  const totalesPorMoneda = useMemo(() => {
    const map = new Map<string, { ingresos: number; egresos: number; saldo: number; count: number }>();
    for (const m of filteredBase) {
      const mn = (m.moneda ?? "ARS") as string;
      if (!map.has(mn)) map.set(mn, { ingresos: 0, egresos: 0, saldo: 0, count: 0 });
      const agg = map.get(mn)!;
      const monto = Number(m.monto);
      if (m.tipo === "ingreso") agg.ingresos += monto;
      else agg.egresos += monto;
      agg.saldo = agg.ingresos - agg.egresos;
      agg.count++;
    }
    return map;
  }, [filteredBase]);

  const totales = useMemo(() => {
    const conc = filteredBase.filter(m => m.estado === "conciliado").length;
    const pend = filteredBase.filter(m => m.estado === "pendiente").length;
    // Cuando hay una sola moneda en la vista, exponemos los totales "planos"
    // para que la UI vieja siga funcionando.
    const monedas = Array.from(totalesPorMoneda.keys());
    const monedaUnica = monedas.length === 1 ? monedas[0] : null;
    const primero = monedaUnica ? totalesPorMoneda.get(monedaUnica)! : { ingresos: 0, egresos: 0, saldo: 0, count: 0 };
    return {
      ingresos: primero.ingresos,
      egresos: primero.egresos,
      saldo: primero.saldo,
      conc,
      pend,
      total: filteredBase.length,
      monedaUnica
    };
  }, [filteredBase, totalesPorMoneda]);

  // Agrupar por mes para la vista cuando "todos los meses" está seleccionado dentro de un banco
  const agrupadoPorMes = useMemo(() => {
    const map = new Map<string, MovementEnriched[]>();
    filteredBase.forEach(m => {
      const k = ymKey(m.fecha);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    });
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filteredBase]);

  const suggestions = (m: MovementEnriched) => {
    const tipoBuscado = m.tipo === "ingreso" ? "venta" : "compra";
    return invoices
      .filter(f => f.tipo === tipoBuscado)
      .map(f => ({ ...f, diff: Math.abs(Number(f.total) - Number(m.monto)) / Math.max(1, Number(m.monto)) }))
      .filter(f => f.diff < 0.15)
      .sort((a, b) => a.diff - b.diff)
      .slice(0, 5);
  };

  async function linkMovement(mov: MovementEnriched, inv: any) {
    const supabase = createClient();
    await supabase.from("bank_movements").update({ estado: "conciliado", invoice_id: inv.id }).eq("id", mov.id);
    setMovements(prev => prev.map(m => m.id === mov.id ? { ...m, estado: "conciliado", invoice_id: inv.id, referencia: inv.comprobante } : m));
    setModal(null);
  }

  const bancoActivoLabel = banco === "__todos__" ? "Todos los bancos" : banco;
  const periodoActivoLabel = periodoEfectivo === "__todos__" ? "Todos los meses" : ymLabel(periodoEfectivo);

  // Banco para subir: si no hay banco elegido, dejamos el input del dropzone vacío para que lo detecte la IA
  const bancoParaUpload = banco === "__todos__" ? "" : banco;

  return (
    <>
      <Topbar
        title="Conciliación bancaria"
        subtitle={`${bancoActivoLabel} · ${periodoActivoLabel}`}
        right={<>
          <button className="btn btn-ghost"><Icon.Download /> Exportar</button>
        </>}
      />
      <div className="p-8 space-y-6">

        {/* Tabs de bancos — "carpeta" dinámica por banco */}
        <div className="card p-3">
          <div className="flex items-center gap-2 overflow-x-auto scroll-clean">
            <TabPill active={banco === "__todos__"} onClick={() => { setBanco("__todos__"); setPeriodo("__todos__"); }}>
              <Icon.Bank /> Todos los bancos
              <span className="ml-1 text-ink-3 text-[11px]">· {movements.length}</span>
            </TabPill>
            {bancos.map(b => {
              const count = movements.filter(m => m.banco === b).length;
              return (
                <TabPill key={b} active={banco === b} onClick={() => { setBanco(b); setPeriodo("__todos__"); }}>
                  {b}
                  <span className="ml-1 text-ink-3 text-[11px]">· {count}</span>
                </TabPill>
              );
            })}
            {bancos.length === 0 && (
              <div className="text-[12px] text-ink-3 px-2 py-1.5">
                Todavía no cargaste extractos. Arrastrá un PDF abajo.
              </div>
            )}
          </div>
        </div>

        {/* Tabs de meses — dinámicos según el banco */}
        {mesesDelBanco.length > 0 && (
          <div className="card p-3">
            <div className="flex items-center gap-2 overflow-x-auto scroll-clean">
              <TabPill active={periodoEfectivo === "__todos__"} onClick={() => setPeriodo("__todos__")} small>
                Todos los meses
                <span className="ml-1 text-ink-3 text-[10px]">· {mesesDelBanco.reduce((a, b) => a + b.count, 0)}</span>
              </TabPill>
              {mesesDelBanco.map(m => (
                <TabPill key={m.ym} active={periodoEfectivo === m.ym} onClick={() => setPeriodo(m.ym)} small>
                  {ymLabel(m.ym)}
                  <span className="ml-1 text-ink-3 text-[10px]">· {m.count}</span>
                </TabPill>
              ))}
            </div>
          </div>
        )}

        {/* Dropzone de carga */}
        <BankDropzone banco={bancoParaUpload} onDone={() => router.refresh()} />

        {/* KPIs — separados por moneda (ARS y USD no se pueden sumar juntos) */}
        <KpisPorMoneda
          totalesPorMoneda={totalesPorMoneda}
          totalMovimientos={totales.total}
          conciliados={totales.conc}
          pendientes={totales.pend}
          contextLabel={`${bancoActivoLabel} · ${periodoActivoLabel}`}
        />

        {/* Filtro de contraparte + búsqueda + reclasificar */}
        <div className="card p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1 p-1 rounded-xl" style={{ background: "#ececf0" }}>
              {[
                { k: "todos",    t: "Todas" },
                { k: "tercero",  t: "Terceros" },
                { k: "propia",   t: "Cuenta propia" },
                { k: "socios",   t: `Socios${partners.length > 0 ? ` (${partners.length})` : ""}` },
                { k: "sin_cuit", t: "Sin CUIT" }
              ].map(o => (
                <div key={o.k} className={`tab ${tipoParte === o.k ? "active" : ""}`}
                     onClick={() => setTipoParte(o.k as any)}>{o.t}</div>
              ))}
            </div>
            {/* Filtro por moneda — sólo aparece si hay al menos un mov no-ARS en la vista */}
            {(() => {
              const monedasEnMovs = new Set(movements.map(m => (m.moneda ?? "ARS") as string));
              if (monedasEnMovs.size <= 1) return null;
              const opts = [{ k: "todas", t: "Todas monedas" }] as { k: string; t: string }[];
              if (monedasEnMovs.has("ARS")) opts.push({ k: "ARS", t: "ARS $" });
              if (monedasEnMovs.has("USD")) opts.push({ k: "USD", t: "USD u$s" });
              if (monedasEnMovs.has("EUR")) opts.push({ k: "EUR", t: "EUR €" });
              return (
                <div className="flex gap-1 p-1 rounded-xl" style={{ background: "#ececf0" }}>
                  {opts.map(o => (
                    <div key={o.k} className={`tab ${monedaFiltro === o.k ? "active" : ""}`}
                         onClick={() => setMonedaFiltro(o.k as any)}>{o.t}</div>
                  ))}
                </div>
              );
            })()}
            <div className="flex-1 relative min-w-[240px]">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"><Icon.Search /></div>
              <input className="input pl-9" placeholder="Buscar por descripción, contraparte, CUIT…" value={q} onChange={e => setQ(e.target.value)} />
            </div>
            <button className="btn btn-ghost" onClick={reclassify} disabled={reclassifying}>
              <Icon.Sparkles/> {reclassifying ? "Reclasificando…" : "Reclasificar CUITs"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-line" style={{ paddingTop: 10 }}>
            {(() => {
              const conArchivo = statements.filter(s => s.storage_path).length;
              const sinArchivo = statements.length - conArchivo;
              return <>
                <button
                  className="btn btn-ghost"
                  onClick={() => setShowFilesModal(true)}
                  title="Ver los extractos bancarios originales para auditoría manual"
                >
                  <Icon.Folder /> Extractos originales
                  <span className="ml-1 chip" style={{ background:"var(--accent-soft)", color:"var(--accent)", fontSize:11, padding:"1px 8px" }}>
                    {conArchivo}
                  </span>
                </button>
                {sinArchivo > 0 && (
                  <span className="chip" style={{ background:"#fcf0dd", color:"#b4730e", fontSize:11 }}
                        title="Extractos cargados sin PDF/CSV asociado — no se pueden auditar visualmente">
                    {sinArchivo} sin archivo
                  </span>
                )}
                <div className="text-[11px] text-ink-3">
                  Auditoría contable · revisá los PDF/CSV que la IA usó para armar los movimientos
                </div>
              </>;
            })()}
          </div>
        </div>
        {reclassMsg && (
          <div className="text-[12px] px-3 text-ink-2">{reclassMsg}</div>
        )}

        {/* Vista: si "todos los meses" + banco único o todos → agrupamos por mes. Si hay mes elegido → tabla plana. */}
        {periodoEfectivo === "__todos__" && agrupadoPorMes.length > 1 ? (
          agrupadoPorMes.map(([ym, rows]) => (
            <MovementsTable
              key={ym}
              title={ymLabel(ym)}
              subtitle={`${rows.length} movimientos`}
              rows={rows}
              onPending={setModal}
            />
          ))
        ) : (
          <MovementsTable
            title={`Movimientos · ${bancoActivoLabel} · ${periodoActivoLabel}`}
            subtitle={filteredBase.length ? `${filteredBase.length} movimientos` : ""}
            rows={filteredBase}
            onPending={setModal}
          />
        )}

        {/* Retiros e Ingresos de Socios */}
        <PartnersBlock
          partners={partners}
          movements={filteredBase}
          onAdd={() => setAddingPartner(true)}
          onDeleted={(id) => setPartners(prev => prev.filter(p => p.id !== id))}
        />

        {/* Extractos cargados (histórico) */}
        {statements.length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-line">
              <div className="sf-display text-[15px] font-semibold">Extractos cargados</div>
              <div className="text-[12px] text-ink-3">Cada uno se procesó por IA. {statements.length} en total.</div>
            </div>
            <table className="clean">
              <thead>
                <tr><th>Banco</th><th>Cuenta</th><th>Período</th><th>Cargado</th></tr>
              </thead>
              <tbody>
                {statements.map(s => (
                  <tr key={s.id}>
                    <td className="font-medium">{s.banco}</td>
                    <td className="text-ink-2">{s.cuenta ?? s.cbu ?? "—"}</td>
                    <td className="text-ink-2">
                      {s.periodo_desde && s.periodo_hasta
                        ? `${s.periodo_desde} → ${s.periodo_hasta}`
                        : "—"}
                    </td>
                    <td className="text-ink-3">{new Date(s.created_at).toLocaleDateString("es-AR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {addingPartner && (
        <AddPartnerModal
          onClose={() => setAddingPartner(false)}
          onCreated={(p) => { setPartners(prev => [...prev, p]); setAddingPartner(false); }}
        />
      )}

      {showFilesModal && (
        <BankFilesModal
          statements={statements}
          movements={movements}
          currentBanco={banco === "__todos__" ? null : banco}
          currentPeriodo={periodoEfectivo === "__todos__" ? null : periodoEfectivo}
          contextLabel={`${bancoActivoLabel} · ${periodoActivoLabel}`}
          reviews={fileReviews}
          reviewers={reviewers}
          onReviewChange={(path, review) => {
            setFileReviews(prev => {
              const filtered = prev.filter(r => r.storage_path !== path);
              return review ? [...filtered, review] : filtered;
            });
          }}
          onClose={() => setShowFilesModal(false)}
          onJumpToMovements={(bancoTarget, periodoTarget) => {
            setShowFilesModal(false);
            setBanco(bancoTarget ?? "__todos__");
            setPeriodo(periodoTarget ?? "__todos__");
            // Scroll al listado
            setTimeout(() => window.scrollTo({ top: 400, behavior: "smooth" }), 100);
          }}
        />
      )}

      {modal && (
        <>
          <div className="modal-back" onClick={() => setModal(null)} />
          <div className="fixed right-6 top-6 bottom-6 w-[440px] card soft p-6 z-20 fade-in overflow-y-auto scroll-clean">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-[12px] uppercase tracking-wider text-ink-3">Movimiento pendiente</div>
                <div className="sf-display text-[18px] font-semibold mt-1">{modal.descripcion}</div>
                <div className="text-[13px] mt-1 text-ink-2">
                  {modal.fecha} · {modal.tipo === "ingreso" ? "+" : "−"}{money(modal.monto)}
                  {modal.banco ? ` · ${modal.banco}` : ""}
                </div>
              </div>
              <button className="btn btn-ghost" style={{ padding: "6px 10px" }} onClick={() => setModal(null)}><Icon.Close /></button>
            </div>
            <div className="divider my-3" />
            <div className="text-[13px] font-medium mb-2 text-ink-2">Facturas sugeridas</div>
            {suggestions(modal).length ? suggestions(modal).map(f => (
              <div key={f.id} className="card p-4 mb-2 flex items-center justify-between hover:bg-[#fafafb]" style={{ boxShadow: "none" }}>
                <div>
                  <div className="text-[14px] font-semibold">{f.razon_social}</div>
                  <div className="text-[12px] text-ink-2">{f.comprobante} · {f.fecha} · CUIT {f.cuit}</div>
                </div>
                <div className="text-right">
                  <div className="text-[14px] font-semibold">{money(f.total)}</div>
                  <button className="link text-[12px]" onClick={() => linkMovement(modal, f)}>Vincular</button>
                </div>
              </div>
            )) : (
              <div className="text-[13px] text-ink-3">No encontramos facturas con montos cercanos. Podés marcarlo como gasto bancario.</div>
            )}
          </div>
        </>
      )}
    </>
  );
}

// ----- subcomponentes -----

function TabPill({
  active, onClick, children, small
}: { active: boolean; onClick: () => void; children: React.ReactNode; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex items-center gap-1.5 whitespace-nowrap rounded-xl transition-colors",
        small ? "px-2.5 py-1 text-[12px]" : "px-3 py-1.5 text-[13px]",
        active
          ? "bg-ink-1 text-white font-semibold"
          : "bg-surface-2 text-ink-2 hover:bg-[#ececf0]"
      ].join(" ")}
      style={active ? { background: "var(--text)", color: "#fff" } : undefined}
    >
      {children}
    </button>
  );
}

function MovementsTable({
  title, subtitle, rows, onPending
}: {
  title: string;
  subtitle?: string;
  rows: MovementEnriched[];
  onPending: (m: MovementEnriched) => void;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-line">
        <div>
          <div className="sf-display text-[15px] font-semibold">{title}</div>
          {subtitle && <div className="text-[12px] text-ink-3">{subtitle}</div>}
        </div>
        <div className="text-[12px] text-ink-3">Click en <span className="font-semibold text-warn">Pendiente</span> para vincular.</div>
      </div>
      <div className="overflow-x-auto scroll-clean">
        <table className="clean">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Banco</th>
              <th>Descripción</th>
              <th>Contraparte</th>
              <th>Tipo</th>
              <th className="text-right">Importe</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(m => (
              <tr key={m.id}>
                <td className="text-ink-2">{m.fecha}</td>
                <td className="text-ink-2">{m.banco ?? "—"}</td>
                <td className="font-medium truncate" title={`${m.descripcion}${m.referencia ? "  · ref " + m.referencia : ""}`}
                    style={{ maxWidth: 360 }}>
                  {m.descripcion}
                  {m.referencia && <span className="ml-2 text-[12px] text-ink-3">· ref {m.referencia}</span>}
                </td>
                <td className="truncate" style={{ maxWidth: 260 }}
                    title={m.nombre_contraparte ? `${m.nombre_contraparte}${m.cuit_contraparte ? " · CUIT " + formatCuitDisplay(m.cuit_contraparte) : ""}` : ""}>
                  {m.cuit_contraparte ? (
                    <div className="flex flex-col" style={{ lineHeight: 1.2 }}>
                      <span className="text-[13px] font-medium truncate">
                        {m.nombre_contraparte || "—"}
                        {m.socio_nombre && <span className="ml-2"><Badge tone="warning">Socio</Badge></span>}
                        {!m.socio_nombre && m.es_cuenta_propia && <span className="ml-2"><Badge tone="info">Propia</Badge></span>}
                        {!m.socio_nombre && !m.es_cuenta_propia && m.es_transferencia && <span className="ml-2"><Badge tone="default">Tercero</Badge></span>}
                      </span>
                      <span className="text-[11px] text-ink-3 font-mono">
                        {formatCuitDisplay(m.cuit_contraparte)}
                        {m.socio_nombre && <span className="ml-2 text-[11px] text-ink-3">· {m.socio_nombre}{m.socio_relacion ? ` (${m.socio_relacion})` : ""}</span>}
                      </span>
                    </div>
                  ) : (
                    <span className="text-[12px] text-ink-3">—</span>
                  )}
                </td>
                <td><Badge tone={m.tipo as any}>{m.tipo === "ingreso" ? "Ingreso" : "Egreso"}</Badge></td>
                <td className="text-right font-semibold" style={{ color: m.tipo === "ingreso" ? "#30a46c" : "var(--text)" }}>
                  <div className="flex flex-col items-end" style={{ lineHeight: 1.2 }}>
                    <span>
                      {m.tipo === "ingreso" ? "+ " : "− "}
                      {fmtMoneda(Number(m.monto), (m.moneda ?? "ARS") as string)}
                    </span>
                    {(m.moneda === "USD" || m.moneda === "EUR") && m.tipo_cambio_referencia && (
                      <span className="text-[10px] text-ink-3 font-normal"
                            title={`TC ${m.tipo_cambio_referencia_fuente === "bcra" ? "BCRA" : "manual"} del ${m.fecha}`}>
                        TC ref. ${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2 }).format(Number(m.tipo_cambio_referencia))}
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  {m.estado === "conciliado" && <Badge tone="conciliado"><Icon.Check /> Conciliado</Badge>}
                  {m.estado === "pendiente" && <Badge tone="pendiente">Pendiente</Badge>}
                  {(m.estado === "impuesto" || m.estado === "gasto_bancario") && <Badge tone="impuesto">Gasto bancario</Badge>}
                </td>
                <td className="text-right">
                  {m.estado === "pendiente" && (
                    <button className="btn btn-ghost" style={{ padding: "6px 12px" }} onClick={() => onPending(m)}>
                      <Icon.Link /> Vincular
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={8} className="text-center py-10 text-ink-3">No hay movimientos con estos filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// Retiros e Ingresos de Socios
// ============================================================================

function normCuit(v?: string | null) { return (v ?? "").replace(/\D/g, ""); }

function PartnersBlock({
  partners, movements, onAdd, onDeleted
}: {
  partners: Partner[];
  movements: MovementEnriched[];
  onAdd: () => void;
  onDeleted: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  // Para cada socio, calcular ingresos y egresos matcheando cuit_contraparte
  const rows = useMemo(() => partners.map(p => {
    const cuit = normCuit(p.cuit);
    const matchDocs = [cuit, p.dni].filter(Boolean) as string[];
    const movs = movements.filter(m => {
      const mc = normCuit(m.cuit_contraparte);
      return mc && matchDocs.some(d => mc.endsWith(d) || d === mc);
    });
    const ingresos = movs.filter(m => m.tipo === "ingreso").reduce((a, b) => a + Number(b.monto), 0);
    const egresos  = movs.filter(m => m.tipo === "egreso").reduce((a, b) => a + Number(b.monto), 0);
    // Regla contable:
    //   egresos (plata que le dimos al socio) - ingresos (plata que el socio trajo) = saldo deudor del socio
    const saldo = egresos - ingresos;
    return { partner: p, movs, ingresos, egresos, saldo };
  }), [partners, movements]);

  // Totales consolidados de todos los socios
  const totales = useMemo(() => {
    const aportes = rows.reduce((a, r) => a + r.ingresos, 0);
    const retiros = rows.reduce((a, r) => a + r.egresos, 0);
    const saldoNeto = retiros - aportes;
    const movs = rows.reduce((a, r) => a + r.movs.length, 0);
    return { aportes, retiros, saldoNeto, movs };
  }, [rows]);

  async function deletePartner(id: string, nombre: string) {
    if (!confirm(`¿Eliminar al socio "${nombre}"? Los movimientos bancarios no se tocan.`)) return;
    const r = await fetch("/api/partners/delete", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id })
    });
    if (r.ok) onDeleted(id);
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-line flex items-center justify-between">
        <div>
          <div className="sf-display text-[15px] font-semibold">Cuenta corriente de socios</div>
          <div className="text-[12px] text-ink-3">
            Aportes (ingresos hacia la empresa) y retiros (egresos hacia el socio) detectados por CUIT/DNI.
          </div>
        </div>
        <button className="btn btn-primary" onClick={onAdd}>
          <Icon.Plus/> Agregar socio
        </button>
      </div>

      {partners.length === 0 ? (
        <div className="p-10 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center bg-brand-soft text-brand mb-3">
            <Icon.User/>
          </div>
          <div className="sf-display text-[15px] font-semibold mb-1">Todavía no cargaste socios</div>
          <div className="text-[12px] text-ink-2 mb-4 max-w-md mx-auto">
            Agregá a los socios, administradores o apoderados con su CUIT. Vamos a detectar los movimientos bancarios hacia/desde ellos y calcular el saldo automáticamente.
          </div>
          <button className="btn btn-primary" onClick={onAdd}>
            <Icon.Plus/> Agregar el primer socio
          </button>
        </div>
      ) : (
        <>
          {/* Resumen consolidado — 3 KPIs grandes */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-5" style={{ background: "#fafafa" }}>
            <SummaryCard
              label="Aportes de socios"
              subtitle={`${rows.filter(r => r.ingresos > 0).length} socios aportaron`}
              amount={totales.aportes}
              tone="ingreso"
              iconArrow="down"
              hint="Ingresó a la empresa"
            />
            <SummaryCard
              label="Retiros a socios"
              subtitle={`${rows.filter(r => r.egresos > 0).length} socios recibieron`}
              amount={totales.retiros}
              tone="egreso"
              iconArrow="up"
              hint="Salió de la empresa"
            />
            <SummaryCard
              label={totales.saldoNeto > 0 ? "Deuda neta de socios" : totales.saldoNeto < 0 ? "Deuda neta a socios" : "Saldo neto"}
              subtitle={
                totales.saldoNeto > 0
                  ? "Los socios retiraron más de lo que aportaron"
                  : totales.saldoNeto < 0
                    ? "Los socios aportaron más de lo que retiraron"
                    : "Aportes = Retiros"
              }
              amount={Math.abs(totales.saldoNeto)}
              tone={totales.saldoNeto === 0 ? "neutral" : totales.saldoNeto > 0 ? "ingreso" : "egreso"}
              iconArrow={totales.saldoNeto === 0 ? "eq" : totales.saldoNeto > 0 ? "up" : "down"}
              hint={`${totales.movs} movimientos totales`}
            />
          </div>

          {/* Tarjetas por socio */}
          <div className="p-5 space-y-3 border-t border-line">
            {rows.map(r => {
              const p = r.partner;
              const saldo = r.saldo;
              const isDeudor = saldo > 0;
              const isAcreedor = saldo < 0;
              const total = r.ingresos + r.egresos;
              const pctIng = total > 0 ? (r.ingresos / total) * 100 : 0;
              const pctEgr = total > 0 ? (r.egresos / total) * 100 : 0;
              const isOpen = expanded === p.id;

              return (
                <div key={p.id} className="card" style={{ padding: 0, overflow: "hidden" }}>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center"
                             style={{ background: "var(--accent-soft)", color: "var(--accent)", fontWeight: 600 }}>
                          {p.nombre.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="sf-display font-semibold text-[15px]">{p.nombre}</div>
                          <div className="text-[11px] text-ink-3 capitalize">
                            {p.relacion}
                            {p.porcentaje ? ` · ${p.porcentaje}%` : ""}
                            {p.cuit ? ` · CUIT ${formatCuitDisplay(p.cuit)}` : ""}
                            {!p.cuit && p.dni ? ` · DNI ${p.dni}` : ""}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          className="btn btn-ghost"
                          style={{ padding: "6px 12px", fontSize: 12 }}
                          onClick={() => setExpanded(isOpen ? null : p.id)}
                        >
                          {isOpen ? "Ocultar" : `Ver ${r.movs.length} movimientos`}
                        </button>
                        <button className="btn btn-ghost" style={{padding:"6px 10px", color: "#f04f6f"}}
                                onClick={() => deletePartner(p.id, p.nombre)}>
                          <Icon.Close/>
                        </button>
                      </div>
                    </div>

                    {/* Grid de números: Aportes | Retiros | Saldo */}
                    <div className="grid grid-cols-3 gap-3 mt-4">
                      <div className="rounded-xl p-3" style={{ background: "#e6f6ed" }}>
                        <div className="text-[11px] uppercase tracking-wider" style={{ color: "#30a46c" }}>
                          Aportó
                        </div>
                        <div className="sf-display text-[20px] font-semibold mt-1" style={{ color: "#218358" }}>
                          {money(r.ingresos)}
                        </div>
                        <div className="text-[10px] text-ink-3 mt-1">
                          {r.movs.filter(m => m.tipo === "ingreso").length} ingresos
                        </div>
                      </div>
                      <div className="rounded-xl p-3" style={{ background: "#fdeaef" }}>
                        <div className="text-[11px] uppercase tracking-wider" style={{ color: "#f04f6f" }}>
                          Retiró
                        </div>
                        <div className="sf-display text-[20px] font-semibold mt-1" style={{ color: "#c02648" }}>
                          {money(r.egresos)}
                        </div>
                        <div className="text-[10px] text-ink-3 mt-1">
                          {r.movs.filter(m => m.tipo === "egreso").length} egresos
                        </div>
                      </div>
                      <div className="rounded-xl p-3" style={{
                        background: saldo === 0 ? "#ececf0" : isDeudor ? "#fcf0dd" : "#efeaff"
                      }}>
                        <div className="text-[11px] uppercase tracking-wider"
                             style={{ color: saldo === 0 ? "#6e6e73" : isDeudor ? "#b4730e" : "#7c5cff" }}>
                          {saldo === 0 ? "En cero" : isDeudor ? "Debe a la empresa" : "Empresa le debe"}
                        </div>
                        <div className="sf-display text-[20px] font-semibold mt-1"
                             style={{ color: saldo === 0 ? "#3d3d40" : isDeudor ? "#8a5709" : "#5a3fd6" }}>
                          {money(Math.abs(saldo))}
                        </div>
                        <div className="text-[10px] text-ink-3 mt-1">
                          {saldo === 0
                            ? "Aportes = retiros"
                            : isDeudor
                              ? "Se retiró más de lo aportado"
                              : "Se aportó más de lo retirado"}
                        </div>
                      </div>
                    </div>

                    {/* Barra de proporción */}
                    {total > 0 && (
                      <div className="mt-3">
                        <div className="w-full h-2 rounded-full overflow-hidden flex" style={{ background: "#ececf0" }}>
                          <div style={{ width: `${pctIng}%`, background: "#30a46c" }} />
                          <div style={{ width: `${pctEgr}%`, background: "#f04f6f" }} />
                        </div>
                        <div className="flex justify-between text-[10px] text-ink-3 mt-1">
                          <span>Aportes {pctIng.toFixed(0)}%</span>
                          <span>Retiros {pctEgr.toFixed(0)}%</span>
                        </div>
                      </div>
                    )}

                    {r.movs.length === 0 && (
                      <div className="mt-3 text-[12px] text-ink-3 text-center py-3 rounded-xl" style={{ background: "#fafafa" }}>
                        Sin movimientos bancarios detectados con este socio todavía.
                      </div>
                    )}
                  </div>

                  {/* Detalle expandible */}
                  {isOpen && r.movs.length > 0 && (
                    <div className="border-t border-line" style={{ background: "#fafafa" }}>
                      <table className="clean">
                        <thead>
                          <tr>
                            <th style={{ background: "#fafafa" }}>Fecha</th>
                            <th style={{ background: "#fafafa" }}>Banco</th>
                            <th style={{ background: "#fafafa" }}>Descripción</th>
                            <th style={{ background: "#fafafa" }}>Tipo</th>
                            <th style={{ background: "#fafafa" }} className="text-right">Importe</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.movs
                            .slice()
                            .sort((a, b) => b.fecha.localeCompare(a.fecha))
                            .map(m => (
                              <tr key={m.id}>
                                <td className="text-ink-2">{m.fecha}</td>
                                <td className="text-ink-2">{m.banco ?? "—"}</td>
                                <td className="text-ink-2 truncate" style={{ maxWidth: 300 }}>
                                  {m.descripcion}
                                </td>
                                <td>
                                  <Badge tone={m.tipo === "ingreso" ? "ingreso" : "egreso"}>
                                    {m.tipo === "ingreso" ? "Aporte" : "Retiro"}
                                  </Badge>
                                </td>
                                <td className="text-right font-semibold"
                                    style={{ color: m.tipo === "ingreso" ? "#30a46c" : "#f04f6f" }}>
                                  {m.tipo === "ingreso" ? "+ " : "− "}{money(m.monto)}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Tarjeta de KPI para el resumen consolidado de socios
// ============================================================================

function SummaryCard({
  label, subtitle, amount, tone, iconArrow, hint
}: {
  label: string;
  subtitle: string;
  amount: number;
  tone: "ingreso" | "egreso" | "neutral";
  iconArrow: "up" | "down" | "eq";
  hint?: string;
}) {
  const palette =
    tone === "ingreso" ? { bg: "#e6f6ed", ico: "#30a46c", strong: "#218358" } :
    tone === "egreso"  ? { bg: "#fdeaef", ico: "#f04f6f", strong: "#c02648" } :
                         { bg: "#ececf0", ico: "#6e6e73", strong: "#3d3d40" };

  const arrow = iconArrow === "up" ? "↑" : iconArrow === "down" ? "↓" : "=";

  return (
    <div className="rounded-2xl p-4" style={{ background: palette.bg }}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider" style={{ color: palette.ico }}>
            {label}
          </div>
          <div className="text-[11px] text-ink-3 mt-0.5">{subtitle}</div>
        </div>
        <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-[14px]"
             style={{ background: "#fff", color: palette.ico }}>
          {arrow}
        </div>
      </div>
      <div className="sf-display text-[26px] font-semibold mt-3" style={{ color: palette.strong }}>
        {money(amount)}
      </div>
      {hint && <div className="text-[11px] text-ink-3 mt-1">{hint}</div>}
    </div>
  );
}

function AddPartnerModal({
  onClose, onCreated
}: { onClose: () => void; onCreated: (p: Partner) => void }) {
  useLockBodyScroll();
  const [nombre, setNombre] = useState("");
  const [cuit, setCuit] = useState("");
  const [dni, setDni] = useState("");
  const [relacion, setRelacion] = useState("socio");
  const [porcentaje, setPorcentaje] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (!nombre.trim()) return setErr("El nombre es obligatorio.");
    setSaving(true);
    try {
      const r = await fetch("/api/partners", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nombre: nombre.trim(),
          cuit: cuit.trim() || null,
          dni: dni.trim() || null,
          relacion,
          porcentaje: porcentaje ? Number(porcentaje) : null,
          observaciones: observaciones.trim() || null
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      onCreated(d.partner);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="modal-back" onClick={onClose}/>
      <div className="fixed right-6 top-6 bottom-6 w-[480px] card soft p-6 z-30 fade-in overflow-y-auto scroll-clean">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-[12px] uppercase tracking-wider text-ink-3">Nuevo socio</div>
            <div className="sf-display text-[20px] font-semibold mt-1">Agregar socio</div>
            <div className="text-[12px] text-ink-3">Con el CUIT detectamos sus movimientos bancarios automáticamente.</div>
          </div>
          <button className="btn btn-ghost" style={{padding:"6px 10px"}} onClick={onClose}><Icon.Close/></button>
        </div>

        <div className="space-y-3">
          <Field2 label="Nombre completo *"
                  placeholder="Ej: Martín Tascione"
                  value={nombre} onChange={setNombre}/>
          <div className="grid grid-cols-2 gap-3">
            <Field2 label="CUIT"
                    placeholder="20-44267590-3"
                    value={cuit} onChange={setCuit}/>
            <Field2 label="DNI"
                    placeholder="44267590"
                    value={dni} onChange={setDni}/>
          </div>
          <div>
            <div className="text-[11px] font-medium text-ink-2 mb-1">Relación</div>
            <select className="input" value={relacion} onChange={e => setRelacion(e.target.value)}>
              <option value="socio">Socio</option>
              <option value="administrador">Administrador</option>
              <option value="director">Director</option>
              <option value="apoderado">Apoderado</option>
              <option value="accionista">Accionista</option>
            </select>
          </div>
          <Field2 label="% Participación (opcional)"
                  placeholder="Ej: 50"
                  value={porcentaje} onChange={setPorcentaje}/>
          <div>
            <div className="text-[11px] font-medium text-ink-2 mb-1">Observaciones</div>
            <textarea className="input" rows={2}
                      value={observaciones} onChange={e => setObservaciones(e.target.value)}/>
          </div>

          {err && <div className="p-2.5 rounded-lg bg-[#fdeaef] text-[#9c2944] text-[12px]">{err}</div>}

          <div className="flex justify-end gap-2 mt-4">
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              <Icon.Check/> {saving ? "Guardando…" : "Guardar socio"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function Field2({ label, value, onChange, placeholder }:
  { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-ink-2 mb-1">{label}</div>
      <input className="input" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}/>
    </div>
  );
}

function BankDropzone({ banco, onDone }: { banco: string; onDone: () => void }) {
  const [drag, setDrag] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setProcessing(true); setError(null); setProgress(8); setStage("Subiendo extracto…");
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setStage(`Detectando banco y movimientos en ${file.name}…`);
        setProgress(15 + Math.round((i / files.length) * 75));
        const fd = new FormData();
        fd.append("file", file);
        if (banco) fd.append("banco", banco);
        const res = await fetch("/api/ingest/bank", { method: "POST", body: fd });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Error" }));
          throw new Error(err.error ?? `Fallo procesando ${file.name}`);
        }
      }
      setProgress(100); setStage("Listo");
      setTimeout(() => { setProcessing(false); setProgress(0); setStage(""); onDone(); }, 500);
    } catch (e: any) {
      setError(e.message); setProcessing(false); setProgress(0);
    }
  }

  return (
    <div className={`drop p-6 ${drag ? "drag" : ""}`}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
    >
      {!processing ? (
        <div className="flex items-center gap-6">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "#efeaff", color: "#7c5cff" }}><Icon.File /></div>
          <div className="flex-1">
            <div className="sf-display text-[16px] font-semibold">Soltá PDFs de extractos bancarios</div>
            <div className="text-[13px] text-ink-2">
              La IA detecta el banco, el período y clasifica cada movimiento. Podés subir varios de distintos bancos.
            </div>
            {error && <div className="text-[12px] text-danger mt-1">{error}</div>}
          </div>
          <button className="btn btn-primary" onClick={() => inputRef.current?.click()}>
            <Icon.Upload /> Elegir archivo
          </button>
          <input ref={inputRef} type="file" accept="application/pdf" multiple hidden onChange={e => handleFiles(e.target.files)} />
        </div>
      ) : (
        <div className="fade-in">
          <div className="flex items-center gap-3 mb-3">
            <Icon.Sparkles /><div className="sf-display text-[15px] font-semibold">{stage}</div>
            <div className="ml-auto text-[13px] font-semibold text-ink-2">{progress}%</div>
          </div>
          <div className="bar"><span style={{ width: progress + "%" }} /></div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Modal: Extractos bancarios originales (para control manual del contador)
// ============================================================================

type StFileGroup = {
  storage_path: string;
  statement: Statement;
  filename: string;
  extension: string;
  movements: MovementEnriched[];
  ingresos: number;
  egresos: number;
};

function isPreviewableBank(path: string): "pdf" | "image" | "excel" | "csv" | "otro" {
  const p = path.toLowerCase();
  if (p.endsWith(".pdf")) return "pdf";
  if (p.endsWith(".png") || p.endsWith(".jpg") || p.endsWith(".jpeg") || p.endsWith(".webp")) return "image";
  if (p.endsWith(".xlsx") || p.endsWith(".xls")) return "excel";
  if (p.endsWith(".csv")) return "csv";
  return "otro";
}

function BankFilesModal({
  statements, movements, currentBanco, currentPeriodo, contextLabel,
  reviews, reviewers, onReviewChange, onClose, onJumpToMovements
}: {
  statements: Statement[];
  movements: MovementEnriched[];
  currentBanco: string | null;
  currentPeriodo: string | null; // "YYYY-MM"
  contextLabel: string;
  reviews: BankFileReview[];
  reviewers: Reviewer[];
  onReviewChange: (path: string, review: BankFileReview | null) => void;
  onClose: () => void;
  onJumpToMovements: (banco: string | null, periodoYYYYMM: string | null) => void;
}) {
  useLockBodyScroll();

  // Navegación jerárquica: Banco → Año → Mes
  // Al abrir, arrancamos con el banco/período que estaba activo en la vista principal.
  const initialAnio = currentPeriodo ? currentPeriodo.slice(0, 4) : null;
  const initialMes = currentPeriodo ? currentPeriodo.slice(5, 7) : null;
  const [selectedBanco, setSelectedBanco] = useState<string | null>(currentBanco);
  const [selectedAnio, setSelectedAnio] = useState<string | null>(initialAnio);
  const [selectedMes, setSelectedMes] = useState<string | null>(initialMes);

  const [q, setQ] = useState("");
  const [estadoFiltro, setEstadoFiltro] = useState<"todos" | "sin_revisar" | "ok" | "observaciones" | "anomalias">("todos");
  const [orderBy, setOrderBy] = useState<"fecha" | "movimientos" | "monto">("fecha");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ path: string; url: string; kind: string; filename: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewEditing, setReviewEditing] = useState<string | null>(null);
  const [currencyEditing, setCurrencyEditing] = useState<StFileGroup | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [backfillPreview, setBackfillPreview] = useState<null | {
    total: number;
    ejemplos: { after: string }[];
  }>(null);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillDone, setBackfillDone] = useState<null | { total: number }>(null);

  // ESC para cerrar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (preview) setPreview(null);
        else if (reviewEditing) setReviewEditing(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, preview, reviewEditing]);

  const reviewByPath = useMemo(() => {
    const m = new Map<string, BankFileReview>();
    for (const r of reviews) m.set(r.storage_path, r);
    return m;
  }, [reviews]);

  const reviewerById = useMemo(() => {
    const m = new Map<string, Reviewer>();
    for (const u of reviewers) m.set(u.id, u);
    return m;
  }, [reviewers]);

  const movsByStatement = useMemo(() => {
    const m = new Map<string, MovementEnriched[]>();
    for (const mv of movements) {
      // El campo real puede ser statement_id o bank_statement_id según ingest usado
      const stId = (mv as any).statement_id ?? (mv as any).bank_statement_id;
      if (!stId) continue;
      if (!m.has(stId)) m.set(stId, []);
      m.get(stId)!.push(mv);
    }
    return m;
  }, [movements]);

  // Agrupar por storage_path (dedup: si dos statements comparten path, mergean movimientos)
  const groups = useMemo<StFileGroup[]>(() => {
    const map = new Map<string, StFileGroup>();
    for (const st of statements) {
      if (!st.storage_path) continue;
      const ext = (st.storage_path.split(".").pop() || "").toLowerCase();
      // Fallback humano: si no hay original_filename, mostramos SÓLO el basename
      // (nunca el path completo con companyId, es ruido para el contador)
      const filename = st.original_filename
        || `Extracto sin nombre (${st.storage_path.split("/").pop() ?? "?"})`;
      const movs = movsByStatement.get(st.id) ?? [];

      if (map.has(st.storage_path)) {
        // Segundo statement con mismo path → mergear movimientos
        const existing = map.get(st.storage_path)!;
        existing.movements = [...existing.movements, ...movs];
        existing.ingresos += movs.filter(m => m.tipo === "ingreso").reduce((a, b) => a + Number(b.monto ?? 0), 0);
        existing.egresos  += movs.filter(m => m.tipo === "egreso").reduce((a, b) => a + Number(b.monto ?? 0), 0);
        // Si el existente no tenía nombre y este sí, actualizamos
        if (st.original_filename && !existing.statement.original_filename) {
          existing.filename = st.original_filename;
          existing.statement = st;
        }
        continue;
      }

      const ingresos = movs.filter(m => m.tipo === "ingreso").reduce((a, b) => a + Number(b.monto ?? 0), 0);
      const egresos  = movs.filter(m => m.tipo === "egreso").reduce((a, b) => a + Number(b.monto ?? 0), 0);
      map.set(st.storage_path, {
        storage_path: st.storage_path,
        statement: st,
        filename,
        extension: ext,
        movements: movs,
        ingresos,
        egresos
      });
    }
    return Array.from(map.values());
  }, [statements, movsByStatement]);


  // Devuelve el año/mes efectivo (basado en periodo_desde, o periodo_hasta, o created_at)
  // que usamos para agrupar el extracto en la jerarquía.
  function anioMesDe(g: StFileGroup): { anio: string | null; mes: string | null } {
    const p = g.statement.periodo_desde
      || g.statement.periodo_hasta
      || (g.statement.created_at ? String(g.statement.created_at).slice(0, 10) : null);
    if (!p) return { anio: null, mes: null };
    return { anio: p.slice(0, 4), mes: p.slice(5, 7) };
  }

  // Filtrar por la selección del sidebar + otros filtros
  const filteredGroups = useMemo(() => {
    const norm = (s: string) => s.toLowerCase();
    let rows = groups;

    // Sidebar: banco → año → mes
    if (selectedBanco) rows = rows.filter(g => g.statement.banco === selectedBanco);
    if (selectedAnio) {
      rows = rows.filter(g => {
        const { anio } = anioMesDe(g);
        if (anio === selectedAnio) return true;
        // Cubre también extractos multi-año (ej. desde dic 2025 hasta ene 2026)
        const desde = g.statement.periodo_desde ?? "";
        const hasta = g.statement.periodo_hasta ?? "";
        return (desde && desde.startsWith(selectedAnio))
          || (hasta && hasta.startsWith(selectedAnio));
      });
    }
    if (selectedMes && selectedAnio) {
      const ym = `${selectedAnio}-${selectedMes}`;
      rows = rows.filter(g => {
        const desde = g.statement.periodo_desde ?? "";
        const hasta = g.statement.periodo_hasta ?? "";
        return (desde && desde.startsWith(ym))
          || (hasta && hasta.startsWith(ym))
          || (desde && hasta && desde <= `${ym}-31` && hasta >= `${ym}-01`);
      });
    }

    if (estadoFiltro !== "todos") {
      rows = rows.filter(g => {
        const rev = reviewByPath.get(g.storage_path);
        if (estadoFiltro === "sin_revisar") return !rev;
        if (estadoFiltro === "ok") return rev?.status === "ok";
        if (estadoFiltro === "observaciones") return rev && rev.status !== "ok";
        if (estadoFiltro === "anomalias") return g.movements.length === 0 || !g.statement.periodo_desde;
        return true;
      });
    }

    if (q) {
      const s = norm(q);
      rows = rows.filter(g =>
        norm(g.filename).includes(s) ||
        norm(g.statement.banco ?? "").includes(s) ||
        norm(g.statement.cuenta ?? "").includes(s) ||
        norm(g.statement.cbu ?? "").includes(s)
      );
    }

    rows = rows.slice().sort((a, b) => {
      switch (orderBy) {
        case "fecha":       return (b.statement.periodo_desde ?? "").localeCompare(a.statement.periodo_desde ?? "");
        case "movimientos": return b.movements.length - a.movements.length;
        case "monto":       return (b.ingresos + b.egresos) - (a.ingresos + a.egresos);
      }
    });
    return rows;
  }, [groups, selectedBanco, selectedAnio, selectedMes, estadoFiltro, q, orderBy, reviewByPath]);

  // Árbol de navegación: Banco → Año → Mes con contadores
  type TreeAnio = { anio: string; meses: Map<string, StFileGroup[]>; total: number };
  type TreeBanco = { banco: string; anios: Map<string, TreeAnio>; total: number };
  const tree = useMemo<Map<string, TreeBanco>>(() => {
    const map = new Map<string, TreeBanco>();
    for (const g of groups) {
      const banco = g.statement.banco || "Sin banco";
      const { anio, mes } = anioMesDe(g);
      const anioKey = anio ?? "Sin fecha";
      const mesKey = mes ?? "??";

      if (!map.has(banco)) map.set(banco, { banco, anios: new Map(), total: 0 });
      const bt = map.get(banco)!;
      bt.total++;

      if (!bt.anios.has(anioKey)) bt.anios.set(anioKey, { anio: anioKey, meses: new Map(), total: 0 });
      const at = bt.anios.get(anioKey)!;
      at.total++;

      if (!at.meses.has(mesKey)) at.meses.set(mesKey, []);
      at.meses.get(mesKey)!.push(g);
    }
    return map;
  }, [groups]);


  const counts = useMemo(() => ({
    todos: groups.length,
    sin_revisar: groups.filter(g => !reviewByPath.get(g.storage_path)).length,
    revisados_ok: groups.filter(g => reviewByPath.get(g.storage_path)?.status === "ok").length,
    con_obs: groups.filter(g => {
      const r = reviewByPath.get(g.storage_path);
      return r && r.status !== "ok";
    }).length,
    anomalias: groups.filter(g => g.movements.length === 0 || !g.statement.periodo_desde).length
  }), [groups, reviewByPath]);

  const totalMovimientos = filteredGroups.reduce((a, g) => a + g.movements.length, 0);
  const totalIngresos = filteredGroups.reduce((a, g) => a + g.ingresos, 0);
  const totalEgresos = filteredGroups.reduce((a, g) => a + g.egresos, 0);

  // Detectar archivos sin nombre humano
  const archivosSinNombre = useMemo(
    () => groups.filter(g => !(g.statement.original_filename ?? "").trim()).length,
    [groups]
  );

  async function openPreview(g: StFileGroup, download = false) {
    setLoadingId(g.storage_path); setErr(null);
    try {
      const url = `/api/bank/file?path=${encodeURIComponent(g.storage_path)}${download ? "&download=1" : ""}`;
      const r = await fetch(url);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      if (download) {
        window.location.href = d.url;
      } else {
        const kind = isPreviewableBank(g.storage_path);
        if (kind === "pdf" || kind === "image") {
          setPreview({ path: g.storage_path, url: d.url, kind, filename: g.filename });
        } else {
          window.open(d.url, "_blank");
        }
      }
    } catch (e: any) {
      setErr("No se pudo abrir el archivo: " + e.message);
    } finally { setLoadingId(null); }
  }

  async function saveReview(path: string, status: BankFileReview["status"], note: string) {
    setErr(null);
    try {
      const r = await fetch("/api/file-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storage_path: path, entity_type: "bank_statement", status, note })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      onReviewChange(path, d.review);
      setReviewEditing(null);
    } catch (e: any) {
      setErr("No se pudo guardar la revisión: " + e.message);
    }
  }

  async function unreview(path: string) {
    if (!confirm("¿Quitar la marca de revisado?")) return;
    setErr(null);
    try {
      const r = await fetch(`/api/file-review?storage_path=${encodeURIComponent(path)}&entity_type=bank_statement`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      onReviewChange(path, null);
    } catch (e: any) {
      setErr("No se pudo quitar la revisión: " + e.message);
    }
  }

  function toggleSelect(path: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }
  function toggleAll() {
    if (selected.size === filteredGroups.length) setSelected(new Set());
    else setSelected(new Set(filteredGroups.map(g => g.storage_path)));
  }

  function exportExcel() {
    // El export respeta la selección jerárquica del sidebar
    const params = new URLSearchParams();
    if (selectedBanco) params.set("banco", selectedBanco);
    if (selectedAnio) params.set("year", selectedAnio);
    if (selectedMes && selectedAnio) params.set("month", selectedMes);
    window.location.href = `/api/bank-files/export?${params.toString()}`;
  }

  async function downloadZip() {
    const paths = selected.size ? Array.from(selected) : filteredGroups.map(g => g.storage_path);
    if (!paths.length) return;
    if (paths.length > 200) {
      setErr("El ZIP soporta hasta 200 archivos.");
      return;
    }
    setDownloadingZip(true); setErr(null);
    try {
      const r = await fetch("/api/bank-files/zip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paths })
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `extractos-bancarios-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      const failed = r.headers.get("X-Files-Failed");
      if (failed && failed !== "0") setErr(`${failed} archivo(s) no se pudieron incluir en el ZIP.`);
    } catch (e: any) {
      setErr("No se pudo generar el ZIP: " + e.message);
    } finally { setDownloadingZip(false); }
  }

  async function backfillPreviewFetch() {
    setErr(null); setBackfillDone(null);
    try {
      const r = await fetch("/api/bank-files/backfill-names", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun: true })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setBackfillPreview({
        total: d.would_update ?? 0,
        ejemplos: (d.previews ?? []).slice(0, 6).map((p: any) => ({ after: p.after }))
      });
    } catch (e: any) { setErr("Error en vista previa: " + e.message); }
  }

  async function backfillApply() {
    setBackfillRunning(true); setErr(null);
    try {
      const r = await fetch("/api/bank-files/backfill-names", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setBackfillDone({ total: d.procesados ?? 0 });
      setBackfillPreview(null);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e: any) {
      setErr("Error al aplicar backfill: " + e.message);
    } finally { setBackfillRunning(false); }
  }

  function reviewerName(id: string) {
    const r = reviewerById.get(id);
    return r?.full_name || r?.email || "Un usuario";
  }

  return (
    <>
      <div className="modal-back" style={{ zIndex: 60 }} onClick={onClose}/>
      <div className="fixed inset-4 md:inset-8 card soft fade-in overflow-hidden flex flex-col" style={{ zIndex: 70 }}>
        <div className="px-6 py-4 border-b border-line flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[12px] uppercase tracking-wider text-ink-3">Base de datos de extractos bancarios</div>
            <div className="sf-display text-[20px] font-semibold mt-1">Auditoría de resúmenes bancarios</div>
            <div className="text-[12px] text-ink-3 mt-1 max-w-2xl">
              Cada PDF/CSV de extracto que la IA usó para armar los movimientos. Revisá, marcá controlado, dejá notas y exportá el papel de trabajo.
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button className="btn btn-ghost" onClick={exportExcel} title="Exportar índice a Excel">
              <Icon.Download/> Exportar índice
            </button>
            {(() => {
              const zipCount = selected.size || filteredGroups.length;
              const overLimit = zipCount > 200;
              return (
                <button className="btn btn-ghost" onClick={downloadZip}
                        disabled={downloadingZip || zipCount === 0}
                        title={overLimit
                          ? `Sólo se pueden descargar 200 archivos por ZIP (tenés ${zipCount}). Ajustá los filtros.`
                          : selected.size ? `Descargar ${selected.size} seleccionados` : `Descargar ${zipCount} archivos filtrados`}>
                  <Icon.Download/> {
                    downloadingZip ? "Generando ZIP…"
                    : zipCount === 0 ? "ZIP (sin archivos)"
                    : overLimit ? `ZIP máx. 200 (tenés ${zipCount})`
                    : selected.size ? `Descargar ${selected.size} (ZIP)`
                    : `Descargar todos (${zipCount})`
                  }
                </button>
              );
            })()}
            <button className="btn btn-ghost" style={{padding:"6px 10px"}} onClick={onClose}><Icon.Close/></button>
          </div>
        </div>

        {/* Layout: sidebar de navegación (Banco → Año → Mes) + contenido principal */}
        <div className="flex-1 flex overflow-hidden">
          <BiblioSidebar
            tree={tree}
            groupsTotal={groups.length}
            selectedBanco={selectedBanco}
            selectedAnio={selectedAnio}
            selectedMes={selectedMes}
            onSelectAll={() => { setSelectedBanco(null); setSelectedAnio(null); setSelectedMes(null); }}
            onSelectBanco={(b) => { setSelectedBanco(b); setSelectedAnio(null); setSelectedMes(null); }}
            onSelectAnio={(b, a) => { setSelectedBanco(b); setSelectedAnio(a); setSelectedMes(null); }}
            onSelectMes={(b, a, m) => { setSelectedBanco(b); setSelectedAnio(a); setSelectedMes(m); }}
          />

          {/* Contenido principal */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Breadcrumb + búsqueda */}
            <div className="px-6 py-3 border-b border-line flex flex-wrap items-center gap-3">
              <BreadcrumbNav
                selectedBanco={selectedBanco}
                selectedAnio={selectedAnio}
                selectedMes={selectedMes}
                onSelectAll={() => { setSelectedBanco(null); setSelectedAnio(null); setSelectedMes(null); }}
                onSelectBanco={(b) => { setSelectedBanco(b); setSelectedAnio(null); setSelectedMes(null); }}
                onSelectAnio={(b, a) => { setSelectedBanco(b); setSelectedAnio(a); setSelectedMes(null); }}
              />
              <div className="flex-1 min-w-[240px] relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"><Icon.Search /></div>
                <input className="input pl-9" placeholder="Buscar por archivo, banco, cuenta o CBU…"
                       value={q} onChange={e=>setQ(e.target.value)} />
              </div>
            </div>

        {/* Filtros fila 2 */}
        <div className="px-6 py-3 border-b border-line flex flex-wrap items-center gap-3" style={{ background: "#fafafa" }}>
          <div className="text-[11px] uppercase tracking-wider text-ink-3">Estado</div>
          <div className="flex gap-1 p-1 rounded-xl bg-white flex-wrap">
            {[
              { k: "todos", t: "Todos", c: counts.todos },
              { k: "sin_revisar", t: "Sin revisar", c: counts.sin_revisar },
              { k: "ok", t: "OK", c: counts.revisados_ok },
              { k: "observaciones", t: "Con observaciones", c: counts.con_obs },
              ...(counts.anomalias > 0 ? [{ k: "anomalias", t: "⚠ Anomalías", c: counts.anomalias }] : [])
            ].map(o => (
              <div key={o.k}
                   className={`tab ${estadoFiltro===o.k?"active":""}`}
                   onClick={()=>setEstadoFiltro(o.k as any)}>
                {o.t}<span className="ml-1 text-[10px] text-ink-3">· {o.c}</span>
              </div>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="text-[11px] uppercase tracking-wider text-ink-3">Ordenar por</div>
            <select className="input" style={{ padding:"4px 10px", fontSize: 12, width: 180 }}
                    value={orderBy} onChange={e => setOrderBy(e.target.value as any)}>
              <option value="fecha">Fecha (más reciente)</option>
              <option value="movimientos">Cantidad movimientos</option>
              <option value="monto">Monto operado</option>
            </select>
          </div>
        </div>

        {err && (
          <div className="mx-6 mt-3 p-2.5 rounded-lg bg-[#fdeaef] text-[#9c2944] text-[12px]">{err}</div>
        )}

        {/* Banner backfill */}
        {archivosSinNombre > 0 && !backfillDone && (
          <div className="mx-6 mt-3 rounded-xl p-3 flex items-center gap-3"
               style={{ background: "#fcf0dd", border: "1px solid #f0d69a" }}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                 style={{ background:"#fff", color:"#b4730e" }}>
              <Icon.Warning/>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium" style={{ color:"#8a5709" }}>
                {archivosSinNombre} extracto{archivosSinNombre === 1 ? "" : "s"} sin nombre humano
              </div>
              <div className="text-[11px]" style={{ color:"#b4730e" }}>
                Los extractos que cargaste antes aparecen con un UUID. Puedo generar nombres como "Extracto Santander - Mar 2026.pdf".
              </div>
            </div>
            {!backfillPreview ? (
              <button className="btn btn-primary" onClick={backfillPreviewFetch}>Vista previa</button>
            ) : (
              <div className="flex items-center gap-2">
                <button className="btn btn-ghost" onClick={() => setBackfillPreview(null)} disabled={backfillRunning}>Cancelar</button>
                <button className="btn btn-primary" onClick={backfillApply} disabled={backfillRunning}>
                  {backfillRunning ? "Aplicando…" : `Renombrar ${backfillPreview.total}`}
                </button>
              </div>
            )}
          </div>
        )}
        {backfillPreview && backfillPreview.ejemplos.length > 0 && (
          <div className="mx-6 mt-2 rounded-xl p-3" style={{ background:"#fafafa", border:"1px solid var(--line)" }}>
            <div className="text-[11px] uppercase tracking-wider text-ink-3 mb-2">
              Vista previa — {backfillPreview.total} extracto(s) recibirán:
            </div>
            <div className="space-y-1">
              {backfillPreview.ejemplos.map((e, i) => (
                <div key={i} className="text-[12px] font-mono">{e.after}</div>
              ))}
              {backfillPreview.total > backfillPreview.ejemplos.length && (
                <div className="text-[11px] text-ink-3 mt-1">
                  … y {backfillPreview.total - backfillPreview.ejemplos.length} extracto(s) más.
                </div>
              )}
            </div>
          </div>
        )}
        {backfillDone && (
          <div className="mx-6 mt-3 rounded-xl p-3 flex items-center gap-3"
               style={{ background: "#e6f6ed", border: "1px solid #b6e2c8" }}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                 style={{ background:"#fff", color:"#30a46c" }}>
              <Icon.Check/>
            </div>
            <div className="text-[13px]" style={{ color:"#218358" }}>
              Se renombraron {backfillDone.total} extracto(s). Recargando…
            </div>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-4 gap-3 px-6 py-4 border-b border-line" style={{ background: "#fafafa" }}>
          <div className="rounded-xl p-3 bg-white">
            <div className="text-[11px] uppercase tracking-wider text-ink-3">Extractos</div>
            <div className="sf-display text-[22px] font-semibold mt-1">{filteredGroups.length}</div>
          </div>
          <div className="rounded-xl p-3 bg-white">
            <div className="text-[11px] uppercase tracking-wider text-ink-3">Movimientos</div>
            <div className="sf-display text-[22px] font-semibold mt-1">{totalMovimientos}</div>
          </div>
          <div className="rounded-xl p-3 bg-white">
            <div className="text-[11px] uppercase tracking-wider text-ink-3">Ingresos</div>
            <div className="sf-display text-[22px] font-semibold mt-1" style={{ color:"#30a46c" }}>{money(totalIngresos)}</div>
          </div>
          <div className="rounded-xl p-3 bg-white">
            <div className="text-[11px] uppercase tracking-wider text-ink-3">Egresos</div>
            <div className="sf-display text-[22px] font-semibold mt-1" style={{ color:"#f04f6f" }}>{money(totalEgresos)}</div>
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto scroll-clean" style={{ overscrollBehavior: "contain" }}>
          {filteredGroups.length === 0 ? (
            <div className="p-16 text-center text-ink-3">
              <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center bg-brand-soft text-brand mb-3">
                <Icon.Folder/>
              </div>
              <div className="sf-display text-[15px] font-semibold text-ink-1">No hay extractos con estos filtros</div>
              <div className="text-[12px] mt-1">Cambiá el ámbito o los filtros.</div>
            </div>
          ) : (
            <table className="clean">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>
                    <input type="checkbox"
                           checked={filteredGroups.length > 0 && selected.size === filteredGroups.length}
                           disabled={filteredGroups.length === 0}
                           onChange={toggleAll}
                           title="Seleccionar/deseleccionar todos"/>
                  </th>
                  <th>Extracto</th>
                  <th>Banco / Cuenta</th>
                  <th>Período</th>
                  <th className="text-right">Movs.</th>
                  <th className="text-right">Ingresos</th>
                  <th className="text-right">Egresos</th>
                  <th>Estado</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredGroups.map(g => {
                  const review = reviewByPath.get(g.storage_path);
                  const isExpanded = expanded === g.storage_path;
                  const isSelected = selected.has(g.storage_path);
                  return (
                    <React.Fragment key={g.storage_path}>
                      <tr style={isSelected ? { background: "var(--accent-soft)" } : undefined}>
                        <td>
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(g.storage_path)}/>
                        </td>
                        <td>
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                                 style={{ background:"var(--accent-soft)", color:"var(--accent)" }}>
                              <Icon.File/>
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium truncate" style={{ maxWidth: 300 }} title={g.filename}>
                                {g.filename}
                              </div>
                              <div className="text-[11px] text-ink-3 flex items-center gap-2 flex-wrap">
                                {g.statement.created_at && <span>Cargado {String(g.statement.created_at).slice(0, 10)}</span>}
                                <span className="chip" style={{ background:"#ececf0", color:"#6e6e73", fontSize:10, padding:"1px 6px" }}>
                                  {g.extension.toUpperCase() || "?"}
                                </span>
                                {(() => {
                                  const mn = g.statement.moneda ?? "ARS";
                                  if (mn === "ARS") return null;
                                  return (
                                    <span className="chip"
                                          style={{ background:"#e6f6ed", color:"#218358", fontSize:10, padding:"1px 6px", fontWeight: 600 }}
                                          title="Moneda del extracto">
                                      {mn}
                                    </span>
                                  );
                                })()}
                                {g.movements.length === 0 && (
                                  <span className="chip"
                                        style={{ background:"#fcf0dd", color:"#b4730e", fontSize:10, padding:"1px 6px" }}
                                        title="Este extracto se subió pero la IA no detectó movimientos. Revisá el archivo original.">
                                    ⚠ Sin movimientos detectados
                                  </span>
                                )}
                                {(g.statement.periodo_desde ?? "") === "" && (
                                  <span className="chip"
                                        style={{ background:"#fcf0dd", color:"#b4730e", fontSize:10, padding:"1px 6px" }}
                                        title="La IA no pudo determinar el período de este extracto">
                                    ⚠ Sin período
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="flex flex-col" style={{ lineHeight: 1.2 }}>
                            <span className="text-[13px] font-medium">{g.statement.banco ?? "—"}</span>
                            <span className="text-[11px] text-ink-3 font-mono">
                              {g.statement.cuenta ?? g.statement.cbu ?? "—"}
                            </span>
                          </div>
                        </td>
                        <td className="text-ink-2 text-[12px]">
                          {g.statement.periodo_desde && g.statement.periodo_hasta
                            ? `${g.statement.periodo_desde} → ${g.statement.periodo_hasta}`
                            : (g.statement.periodo_desde ?? "—")}
                        </td>
                        <td className="text-right">
                          <button
                            className="chip"
                            style={{ background:"var(--accent-soft)", color:"var(--accent)", cursor:"pointer", border:"none" }}
                            onClick={() => setExpanded(isExpanded ? null : g.storage_path)}>
                            {g.movements.length} {isExpanded ? "▲" : "▼"}
                          </button>
                        </td>
                        <td className="text-right font-semibold" style={{ color:"#30a46c" }}>+ {money(g.ingresos)}</td>
                        <td className="text-right font-semibold" style={{ color:"#f04f6f" }}>− {money(g.egresos)}</td>
                        <td>
                          {review ? (
                            <div className="flex flex-col" style={{ lineHeight: 1.15 }}>
                              <Badge tone={review.status === "ok" ? "success" : review.status === "con_observacion" ? "warning" : "danger"}>
                                {review.status === "ok" ? "✓ Revisado" : review.status === "con_observacion" ? "Obs." : "Con error"}
                              </Badge>
                              <span className="text-[10px] text-ink-3 mt-0.5">
                                {reviewerName(review.reviewed_by)} · {review.reviewed_at.slice(0, 10)}
                              </span>
                            </div>
                          ) : (
                            <Badge tone="pendiente">Sin revisar</Badge>
                          )}
                        </td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {(() => {
                              const embed = isPreviewableBank(g.storage_path);
                              const embedable = embed === "pdf" || embed === "image";
                              return (
                                <button
                                  className="btn btn-ghost"
                                  style={{ padding:"6px 10px", fontSize: 12 }}
                                  onClick={() => openPreview(g)}
                                  disabled={loadingId === g.storage_path}
                                  title={embedable
                                    ? "Ver archivo en el panel embebido"
                                    : "Abrir en pestaña nueva (Excel/CSV no se puede embeber en el navegador)"}>
                                  {loadingId === g.storage_path ? "…" : (embedable ? "Ver" : "Abrir ↗")}
                                </button>
                              );
                            })()}
                            <button
                              className="btn btn-ghost"
                              style={{ padding:"6px 10px", fontSize: 12 }}
                              onClick={() => openPreview(g, true)}
                              title="Descargar original">
                              <Icon.Download/>
                            </button>
                            <button
                              className="btn btn-ghost"
                              style={{ padding:"6px 10px", fontSize: 12 }}
                              onClick={() => setCurrencyEditing(g)}
                              title="Cambiar la moneda de este extracto (aplica a todos sus movimientos)">
                              {g.statement.moneda ?? "ARS"}
                            </button>
                            <button
                              className="btn btn-primary"
                              style={{ padding:"6px 10px", fontSize: 12 }}
                              onClick={() => setReviewEditing(g.storage_path)}
                              title="Marcar como revisado">
                              {review ? "Editar" : "Revisar"}
                            </button>
                            {review && (
                              <button
                                className="btn btn-ghost"
                                style={{ padding:"6px 8px", fontSize: 12, color:"#f04f6f" }}
                                onClick={() => unreview(g.storage_path)}
                                title="Quitar marca">
                                <Icon.Close/>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr>
                          <td colSpan={9} style={{ background: "#fafafa", padding: 0 }}>
                            <div className="p-4 space-y-3">
                              {review?.note && (
                                <div className="rounded-xl p-3" style={{ background: "#fff", border: "1px solid var(--line)" }}>
                                  <div className="text-[11px] uppercase tracking-wider text-ink-3 mb-1">
                                    Nota del contador — {reviewerName(review.reviewed_by)}
                                  </div>
                                  <div className="text-[13px] whitespace-pre-wrap">{review.note}</div>
                                </div>
                              )}
                              <div className="flex items-center justify-between">
                                <div className="text-[11px] uppercase tracking-wider text-ink-3">
                                  {g.movements.length === 0
                                    ? "Sin movimientos en este extracto"
                                    : g.movements.length <= 50
                                      ? `${g.movements.length} movimiento${g.movements.length === 1 ? "" : "s"}`
                                      : `Primeros 50 de ${g.movements.length} movimientos`}
                                </div>
                                {g.movements.length > 50 && (
                                  <button
                                    className="btn btn-ghost"
                                    style={{ padding:"4px 10px", fontSize: 11 }}
                                    onClick={() => {
                                      onJumpToMovements(
                                        g.statement.banco || null,
                                        g.statement.periodo_desde ? g.statement.periodo_desde.slice(0, 7) : null
                                      );
                                    }}
                                  >
                                    Ver los {g.movements.length} en la tabla ↗
                                  </button>
                                )}
                              </div>
                              <div className="rounded-xl overflow-hidden" style={{ background: "#fff", border: "1px solid var(--line)" }}>
                                <table className="clean">
                                  <thead>
                                    <tr>
                                      <th style={{ background: "#fff" }}>Fecha</th>
                                      <th style={{ background: "#fff" }}>Descripción</th>
                                      <th style={{ background: "#fff" }}>Contraparte</th>
                                      <th style={{ background: "#fff" }}>Tipo</th>
                                      <th style={{ background: "#fff" }} className="text-right">Importe</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {g.movements
                                      .slice()
                                      .sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? ""))
                                      .slice(0, 50)
                                      .map(m => (
                                        <tr key={m.id}>
                                          <td className="text-ink-2">{m.fecha}</td>
                                          <td className="truncate" style={{ maxWidth: 320 }} title={m.descripcion}>
                                            {m.descripcion}
                                          </td>
                                          <td className="text-ink-2 text-[12px]">
                                            {m.nombre_contraparte ?? "—"}
                                          </td>
                                          <td>
                                            <Badge tone={m.tipo === "ingreso" ? "ingreso" : "egreso"}>
                                              {m.tipo === "ingreso" ? "Ingreso" : "Egreso"}
                                            </Badge>
                                          </td>
                                          <td className="text-right font-semibold"
                                              style={{ color: m.tipo === "ingreso" ? "#30a46c" : "#f04f6f" }}>
                                            {m.tipo === "ingreso" ? "+ " : "− "}{money(Number(m.monto))}
                                          </td>
                                        </tr>
                                      ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
          </div>{/* /Contenido principal */}
        </div>{/* /Layout con sidebar */}
      </div>

      {/* Preview embebido */}
      {preview && (
        <BankPreviewPanel preview={preview} onClose={() => setPreview(null)}/>
      )}

      {/* Modal de revisión */}
      {reviewEditing && (
        <BankReviewEditor
          path={reviewEditing}
          current={reviewByPath.get(reviewEditing) ?? null}
          filename={groups.find(g => g.storage_path === reviewEditing)?.filename ?? "Extracto"}
          onClose={() => setReviewEditing(null)}
          onSave={saveReview}
        />
      )}

      {currencyEditing && (
        <StatementCurrencyEditor
          group={currencyEditing}
          onClose={() => setCurrencyEditing(null)}
          onDone={() => {
            setCurrencyEditing(null);
            // Recargar para ver los nuevos TCs de referencia
            setTimeout(() => window.location.reload(), 400);
          }}
        />
      )}
    </>
  );
}

// ============================================================================
// Editor de moneda del extracto — cambia moneda y busca TC del BCRA para cada mov
// ============================================================================

function StatementCurrencyEditor({
  group, onClose, onDone
}: {
  group: StFileGroup;
  onClose: () => void;
  onDone: () => void;
}) {
  useLockBodyScroll();
  const [moneda, setMoneda] = useState<"ARS" | "USD" | "EUR">(
    (group.statement.moneda as any) ?? "ARS"
  );
  const [fetchTc, setFetchTc] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<null | { updated: number; total: number; missing: number; warnings: string[] }>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSaving(true); setErr(null);
    try {
      const r = await fetch("/api/bank/statement/update-currency", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          statement_id: group.statement.id,
          moneda,
          fetch_tc: fetchTc
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setResult({
        updated: d.updated_movements ?? 0,
        total: d.total_movements ?? 0,
        missing: d.missing_tc_count ?? 0,
        warnings: d.warnings ?? []
      });
    } catch (e: any) {
      setErr(e.message);
    } finally { setSaving(false); }
  }

  return (
    <>
      <div className="modal-back" style={{ zIndex: 85 }} onClick={onClose}/>
      <div className="fixed right-6 top-6 bottom-6 w-[460px] card soft p-6 fade-in overflow-y-auto scroll-clean" style={{ zIndex: 95, overscrollBehavior: "contain" }}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-[12px] uppercase tracking-wider text-ink-3">Moneda del extracto</div>
            <div className="sf-display text-[18px] font-semibold mt-1 truncate" title={group.filename}>{group.filename}</div>
            <div className="text-[11px] text-ink-3 mt-0.5">
              {group.movements.length} movimiento{group.movements.length === 1 ? "" : "s"} · Actualmente: <b>{group.statement.moneda ?? "ARS"}</b>
            </div>
          </div>
          <button className="btn btn-ghost" style={{padding:"6px 10px"}} onClick={onClose}><Icon.Close/></button>
        </div>

        <div className="space-y-3 mt-4">
          <div>
            <div className="text-[11px] font-medium text-ink-2 mb-2">Nueva moneda</div>
            <div className="space-y-2">
              {[
                { k: "ARS", label: "Pesos argentinos (ARS)", desc: "Cuenta en pesos, sin TC de referencia" },
                { k: "USD", label: "Dólares (USD)",           desc: "Cuenta en dólares, cada mov con TC del BCRA como referencia" },
                { k: "EUR", label: "Euros (EUR)",             desc: "Cuenta en euros, cada mov con TC del BCRA como referencia" }
              ].map(o => (
                <label key={o.k}
                       className="flex items-start gap-3 p-3 rounded-xl cursor-pointer"
                       style={{
                         border: `1.5px solid ${moneda === o.k ? "var(--accent)" : "var(--line)"}`,
                         background: moneda === o.k ? "var(--accent-soft)" : "#fff"
                       }}>
                  <input type="radio" name="curr" checked={moneda === o.k}
                         onChange={() => setMoneda(o.k as any)} style={{ marginTop: 3 }}/>
                  <div>
                    <div className="text-[13px] font-medium">{o.label}</div>
                    <div className="text-[11px] text-ink-3">{o.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {moneda !== "ARS" && (
            <label className="flex items-start gap-2 p-3 rounded-xl" style={{ background:"#fafafa", border:"1px solid var(--line)" }}>
              <input type="checkbox" checked={fetchTc} onChange={e => setFetchTc(e.target.checked)} style={{ marginTop: 3 }}/>
              <div className="text-[12px]">
                <div className="font-medium">Buscar TC del BCRA</div>
                <div className="text-ink-3 text-[11px]">
                  Para cada fecha de movimiento, guarda el TC oficial del BCRA como referencia informativa (no convierte los montos).
                </div>
              </div>
            </label>
          )}

          {err && <div className="p-2.5 rounded-lg bg-[#fdeaef] text-[#9c2944] text-[12px]">{err}</div>}

          {result && (
            <div className="p-3 rounded-xl" style={{ background:"#e6f6ed", border:"1px solid #b6e2c8" }}>
              <div className="text-[13px] font-medium" style={{ color:"#218358" }}>
                ✓ {result.updated} de {result.total} movimiento{result.total === 1 ? "" : "s"} actualizado{result.total === 1 ? "" : "s"}
              </div>
              {result.missing > 0 && (
                <div className="text-[11px] text-ink-2 mt-1">
                  {result.missing} fecha(s) sin TC del BCRA — quedaron sin referencia y podés setearlas manualmente.
                </div>
              )}
              {result.warnings.length > 0 && (
                <ul className="text-[11px] text-ink-3 mt-1 list-disc list-inside">
                  {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
              <button className="btn btn-primary mt-3" onClick={onDone}>Cerrar y recargar</button>
            </div>
          )}

          {!result && (
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
              <button className="btn btn-primary" onClick={submit} disabled={saving}>
                {saving ? "Aplicando…" : `Cambiar a ${moneda}`}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function BankPreviewPanel({
  preview, onClose
}: { preview: { path: string; url: string; kind: string; filename: string }; onClose: () => void }) {
  useLockBodyScroll();
  return (
    <>
      <div className="modal-back" style={{ zIndex: 80 }} onClick={onClose}/>
      <div className="fixed inset-4 md:inset-16 card soft fade-in overflow-hidden flex flex-col" style={{ zIndex: 90 }}>
        <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-ink-3">Vista previa del extracto</div>
            <div className="sf-display text-[15px] font-semibold truncate">{preview.filename}</div>
          </div>
          <div className="flex items-center gap-2">
            <a className="btn btn-ghost" href={preview.url} target="_blank" rel="noreferrer">
              <Icon.Link/> Abrir en pestaña
            </a>
            <button className="btn btn-ghost" style={{padding:"6px 10px"}} onClick={onClose}>
              <Icon.Close/>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden" style={{ background: "#525659" }}>
          {preview.kind === "pdf" ? (
            <iframe src={preview.url} className="w-full h-full" style={{ border: 0 }} title="Preview PDF"/>
          ) : preview.kind === "image" ? (
            <div className="w-full h-full flex items-center justify-center overflow-auto">
              <img src={preview.url} alt={preview.filename} style={{ maxWidth: "100%", maxHeight: "100%" }}/>
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white text-[13px]">
              Este formato no se puede previsualizar embebido.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function BankReviewEditor({
  path, current, filename, onClose, onSave
}: {
  path: string;
  current: BankFileReview | null;
  filename: string;
  onClose: () => void;
  onSave: (path: string, status: BankFileReview["status"], note: string) => Promise<void>;
}) {
  useLockBodyScroll();
  const [status, setStatus] = useState<BankFileReview["status"]>(current?.status ?? "ok");
  const [note, setNote] = useState(current?.note ?? "");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try { await onSave(path, status, note); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="modal-back" style={{ zIndex: 85 }} onClick={onClose}/>
      <div className="fixed right-6 top-6 bottom-6 w-[460px] card soft p-6 fade-in overflow-y-auto scroll-clean" style={{ zIndex: 95, overscrollBehavior: "contain" }}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-[12px] uppercase tracking-wider text-ink-3">Revisión contable</div>
            <div className="sf-display text-[18px] font-semibold mt-1 truncate" title={filename}>{filename}</div>
            <div className="text-[11px] text-ink-3 mt-0.5">Marcá el resultado del control y dejá una nota si hace falta.</div>
          </div>
          <button className="btn btn-ghost" style={{padding:"6px 10px"}} onClick={onClose}><Icon.Close/></button>
        </div>

        <div className="space-y-3 mt-4">
          <div>
            <div className="text-[11px] font-medium text-ink-2 mb-2">Resultado del control</div>
            <div className="space-y-2">
              {[
                { k: "ok",              label: "Revisado — todo OK",           desc: "Los movimientos coinciden con el extracto original",     tone: "#30a46c", bg: "#e6f6ed" },
                { k: "con_observacion", label: "Con observaciones",            desc: "Requiere aclaración o hay diferencias menores",           tone: "#b4730e", bg: "#fcf0dd" },
                { k: "con_error",       label: "Con error — necesita corregir", desc: "Hay diferencias que hay que corregir",                    tone: "#c02648", bg: "#fdeaef" }
              ].map(o => (
                <label key={o.k}
                       className="flex items-start gap-3 p-3 rounded-xl cursor-pointer"
                       style={{
                         border: `1.5px solid ${status === o.k ? o.tone : "var(--line)"}`,
                         background: status === o.k ? o.bg : "#fff"
                       }}>
                  <input type="radio" name="bank-status" checked={status === o.k}
                         onChange={() => setStatus(o.k as any)} style={{ marginTop: 3 }}/>
                  <div>
                    <div className="text-[13px] font-medium" style={{ color: status === o.k ? o.tone : undefined }}>
                      {o.label}
                    </div>
                    <div className="text-[11px] text-ink-3">{o.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[11px] font-medium text-ink-2 mb-1">Nota (opcional)</div>
            <textarea className="input"
                      style={{ minHeight: 100, resize: "vertical" }}
                      placeholder="Ej: Falta conciliar la transferencia del 15/03. Confirmé saldo inicial contra libro."
                      value={note} onChange={e => setNote(e.target.value)}/>
          </div>

          {current && (
            <div className="text-[11px] text-ink-3">
              Revisado por última vez el {current.reviewed_at.slice(0, 10)}.
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" onClick={submit} disabled={saving}>
              {saving ? "Guardando…" : (current ? "Actualizar" : "Marcar como revisado")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ============================================================================
// KPIs separados por moneda
// ============================================================================

const MONEDA_SIMBOLOS: Record<string, string> = {
  ARS: "$",
  USD: "u$s",
  EUR: "€",
  OTRA: "",
};

const MONEDA_LABELS: Record<string, string> = {
  ARS: "Pesos",
  USD: "Dólares",
  EUR: "Euros",
  OTRA: "Otra moneda",
};

function fmtMoneda(monto: number, moneda: string): string {
  const simbolo = MONEDA_SIMBOLOS[moneda] ?? "";
  const num = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(monto);
  return `${simbolo} ${num}`.trim();
}

function KpisPorMoneda({
  totalesPorMoneda, totalMovimientos, conciliados, pendientes, contextLabel
}: {
  totalesPorMoneda: Map<string, { ingresos: number; egresos: number; saldo: number; count: number }>;
  totalMovimientos: number;
  conciliados: number;
  pendientes: number;
  contextLabel: string;
}) {
  const monedas = Array.from(totalesPorMoneda.keys())
    .sort((a, b) => (b === "ARS" ? -1 : 1)); // ARS primero
  const hayMulti = monedas.length > 1;

  if (monedas.length === 0) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <Kpi label="Ingresos"   value={money(0)} hint={contextLabel} />
        <Kpi label="Egresos"    value={money(0)} hint="Pagos, impuestos y comisiones" />
        <Kpi label="Saldo neto" value={money(0)} hint="Diferencia del período" />
        <Kpi label="Movimientos" value={`${totalMovimientos}`} hint={`${conciliados} conciliados · ${pendientes} pendientes`} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {monedas.map(mn => {
        const t = totalesPorMoneda.get(mn)!;
        return (
          <div key={mn}>
            {hayMulti && (
              <div className="text-[11px] uppercase tracking-wider text-ink-3 mb-2 flex items-center gap-2">
                <span className="chip" style={{ background: mn === "ARS" ? "var(--accent-soft)" : "#e6f6ed", color: mn === "ARS" ? "var(--accent)" : "#218358", fontSize: 11 }}>
                  {mn}
                </span>
                <span>{MONEDA_LABELS[mn] ?? mn} · {t.count} movimiento{t.count === 1 ? "" : "s"}</span>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
              <Kpi label={`Ingresos${hayMulti ? " " + mn : ""}`}
                   value={fmtMoneda(t.ingresos, mn)}
                   hint={contextLabel} />
              <Kpi label={`Egresos${hayMulti ? " " + mn : ""}`}
                   value={fmtMoneda(t.egresos, mn)}
                   hint="Pagos, impuestos y comisiones" />
              <Kpi label={`Saldo neto${hayMulti ? " " + mn : ""}`}
                   value={fmtMoneda(t.saldo, mn)}
                   hint="Diferencia del período" />
              {!hayMulti && (
                <Kpi label="Movimientos"
                     value={`${totalMovimientos}`}
                     hint={`${conciliados} conciliados · ${pendientes} pendientes`} />
              )}
            </div>
          </div>
        );
      })}
      {hayMulti && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
          <Kpi label="Total movimientos"
               value={`${totalMovimientos}`}
               hint={`${conciliados} conciliados · ${pendientes} pendientes · ${monedas.length} monedas`} />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Sidebar de navegación jerárquica: Banco → Año → Mes
// ============================================================================

type TreeAnioSB = { anio: string; meses: Map<string, StFileGroup[]>; total: number };
type TreeBancoSB = { banco: string; anios: Map<string, TreeAnioSB>; total: number };

function BiblioSidebar({
  tree, groupsTotal,
  selectedBanco, selectedAnio, selectedMes,
  onSelectAll, onSelectBanco, onSelectAnio, onSelectMes
}: {
  tree: Map<string, TreeBancoSB>;
  groupsTotal: number;
  selectedBanco: string | null;
  selectedAnio: string | null;
  selectedMes: string | null;
  onSelectAll: () => void;
  onSelectBanco: (banco: string) => void;
  onSelectAnio: (banco: string, anio: string) => void;
  onSelectMes: (banco: string, anio: string, mes: string) => void;
}) {
  const isAll = !selectedBanco && !selectedAnio && !selectedMes;
  const bancos = Array.from(tree.values()).sort((a, b) => a.banco.localeCompare(b.banco));

  return (
    <aside
      className="border-r border-line overflow-y-auto scroll-clean"
      style={{ width: 280, background: "#fafafa", overscrollBehavior: "contain" }}
    >
      <div className="p-3 border-b border-line" style={{ background: "#fff" }}>
        <div className="text-[11px] uppercase tracking-wider text-ink-3">Biblioteca</div>
      </div>

      <div className="p-2">
        <button
          className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between ${isAll ? "font-semibold" : ""}`}
          style={{
            background: isAll ? "var(--accent-soft)" : "transparent",
            color: isAll ? "var(--accent)" : "var(--text)"
          }}
          onClick={onSelectAll}
        >
          <span className="flex items-center gap-2 text-[13px]">
            <Icon.Folder/> Todos los bancos
          </span>
          <span className="chip" style={{
            background: isAll ? "#fff" : "#ececf0",
            color: "#6e6e73",
            fontSize: 10,
            padding: "1px 6px"
          }}>{groupsTotal}</span>
        </button>

        {bancos.map(bt => {
          const bancoActivo = selectedBanco === bt.banco;
          const anios = Array.from(bt.anios.values()).sort((a, b) => {
            if (a.anio === "Sin fecha") return 1;
            if (b.anio === "Sin fecha") return -1;
            return b.anio.localeCompare(a.anio);
          });

          return (
            <div key={bt.banco} className="mt-1">
              <button
                className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between ${bancoActivo && !selectedAnio ? "font-semibold" : ""}`}
                style={{
                  background: bancoActivo && !selectedAnio ? "var(--accent-soft)" : "transparent",
                  color: bancoActivo && !selectedAnio ? "var(--accent)" : "var(--text)"
                }}
                onClick={() => onSelectBanco(bt.banco)}
              >
                <span className="flex items-center gap-2 text-[13px] truncate">
                  <Icon.Bank/> <span className="truncate">{bt.banco}</span>
                </span>
                <span className="chip" style={{
                  background: bancoActivo && !selectedAnio ? "#fff" : "#ececf0",
                  color: "#6e6e73",
                  fontSize: 10,
                  padding: "1px 6px"
                }}>{bt.total}</span>
              </button>

              {bancoActivo && (
                <div className="ml-4 mt-1 space-y-0.5">
                  {anios.map(at => {
                    const anioActivo = selectedAnio === at.anio;
                    const meses = Array.from(at.meses.entries())
                      .sort((a, b) => b[0].localeCompare(a[0]));

                    return (
                      <div key={at.anio}>
                        <button
                          className="w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between text-[12px]"
                          style={{
                            background: anioActivo && !selectedMes ? "var(--accent-soft)" : "transparent",
                            color: anioActivo && !selectedMes ? "var(--accent)" : "var(--text)",
                            fontWeight: anioActivo && !selectedMes ? 600 : 400
                          }}
                          onClick={() => onSelectAnio(bt.banco, at.anio)}
                        >
                          <span>{at.anio}</span>
                          <span className="text-[10px] text-ink-3">{at.total}</span>
                        </button>

                        {anioActivo && (
                          <div className="ml-3 mt-0.5 space-y-0.5">
                            {meses.map(([mesKey, items]) => {
                              const mesActivo = selectedMes === mesKey;
                              const label = mesKey === "??" ? "Sin mes" : (MESES_ABREV[Number(mesKey) - 1] ?? mesKey);
                              return (
                                <button
                                  key={mesKey}
                                  className="w-full text-left px-2.5 py-1 rounded-lg flex items-center justify-between text-[12px]"
                                  style={{
                                    background: mesActivo ? "var(--accent-soft)" : "transparent",
                                    color: mesActivo ? "var(--accent)" : "#3a3a3d",
                                    fontWeight: mesActivo ? 600 : 400
                                  }}
                                  onClick={() => onSelectMes(bt.banco, at.anio, mesKey)}
                                >
                                  <span>{label}</span>
                                  <span className="text-[10px] text-ink-3">{items.length}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {bancos.length === 0 && (
          <div className="p-6 text-center text-ink-3 text-[12px]">
            Cuando cargues tu primer extracto, aparecerá acá organizado por banco y período.
          </div>
        )}
      </div>
    </aside>
  );
}

// ============================================================================
// Breadcrumb navegable arriba del contenido
// ============================================================================

function BreadcrumbNav({
  selectedBanco, selectedAnio, selectedMes,
  onSelectAll, onSelectBanco, onSelectAnio
}: {
  selectedBanco: string | null;
  selectedAnio: string | null;
  selectedMes: string | null;
  onSelectAll: () => void;
  onSelectBanco: (banco: string) => void;
  onSelectAnio: (banco: string, anio: string) => void;
}) {
  const parts: { label: string; onClick: (() => void) | null }[] = [];
  parts.push({ label: "Todos los bancos", onClick: onSelectAll });
  if (selectedBanco) parts.push({ label: selectedBanco, onClick: () => onSelectBanco(selectedBanco) });
  if (selectedAnio && selectedBanco) parts.push({ label: selectedAnio, onClick: () => onSelectAnio(selectedBanco, selectedAnio) });
  if (selectedMes && selectedAnio) {
    const mesLabel = selectedMes === "??" ? "Sin mes" : (MESES_ABREV[Number(selectedMes) - 1] ?? selectedMes);
    parts.push({ label: mesLabel, onClick: null });
  }

  return (
    <div className="flex items-center gap-1 text-[13px] flex-wrap">
      {parts.map((p, i) => {
        const isLast = i === parts.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-ink-3 text-[11px]">/</span>}
            {p.onClick && !isLast ? (
              <button
                className="hover:underline"
                style={{ color: "var(--accent)" }}
                onClick={p.onClick}
              >
                {p.label}
              </button>
            ) : (
              <span className={isLast ? "font-semibold" : ""}
                    style={{ color: isLast ? "var(--text)" : "#6e6e73" }}>
                {p.label}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
