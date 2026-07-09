"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/ui/Topbar";
import { Kpi } from "@/components/ui/Kpi";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icons";
import { money } from "@/lib/format";
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
type Props = {
  movements: MovementEnriched[];
  invoices: Pick<Invoice, "id" | "comprobante" | "razon_social" | "cuit" | "fecha" | "tipo" | "total">[];
  statements: Statement[];
  partners?: Partner[];
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

export function BankClient({ movements: initial, invoices, statements, partners: initialPartners = [] }: Props) {
  const router = useRouter();
  const [movements, setMovements] = useState<MovementEnriched[]>(initial);
  const [banco, setBanco] = useState<string>("__todos__");
  const [periodo, setPeriodo] = useState<string>("__todos__"); // "__todos__" | "YYYY-MM"
  const [tipoParte, setTipoParte] = useState<"todos" | "propia" | "tercero" | "socios" | "sin_cuit">("todos");
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
  }, [movements, banco, periodoEfectivo, tipoParte, q, partnerByDoc]);

  const totales = useMemo(() => {
    const ingresos = filteredBase.filter(m => m.tipo === "ingreso").reduce((a, b) => a + Number(b.monto), 0);
    const egresos = filteredBase.filter(m => m.tipo === "egreso").reduce((a, b) => a + Number(b.monto), 0);
    const conc = filteredBase.filter(m => m.estado === "conciliado").length;
    const pend = filteredBase.filter(m => m.estado === "pendiente").length;
    return { ingresos, egresos, saldo: ingresos - egresos, conc, pend, total: filteredBase.length };
  }, [filteredBase]);

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

        {/* KPIs aplicados al filtro actual */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
          <Kpi label="Ingresos"   value={money(totales.ingresos)} hint={`${bancoActivoLabel} · ${periodoActivoLabel}`} />
          <Kpi label="Egresos"    value={money(totales.egresos)}  hint="Pagos, impuestos y comisiones" />
          <Kpi label="Saldo neto" value={money(totales.saldo)}    hint="Diferencia del período" />
          <Kpi label="Movimientos" value={`${totales.total}`} hint={`${totales.conc} conciliados · ${totales.pend} pendientes`} />
        </div>

        {/* Filtro de contraparte + búsqueda + reclasificar */}
        <div className="card p-3 flex flex-wrap items-center gap-3">
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
          <div className="flex-1 relative min-w-[240px]">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"><Icon.Search /></div>
            <input className="input pl-9" placeholder="Buscar por descripción, contraparte, CUIT…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <button className="btn btn-ghost" onClick={reclassify} disabled={reclassifying}>
            <Icon.Sparkles/> {reclassifying ? "Reclasificando…" : "Reclasificar CUITs"}
          </button>
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
                  {m.tipo === "ingreso" ? "+ " : "− "}{money(m.monto)}
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
