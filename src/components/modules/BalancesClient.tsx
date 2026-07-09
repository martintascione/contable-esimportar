"use client";

import { useMemo, useState } from "react";
import { Topbar } from "@/components/ui/Topbar";
import { Kpi } from "@/components/ui/Kpi";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icons";
import { money } from "@/lib/format";

const MESES_ABREV = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

type Invoice = {
  id: string;
  tipo: "venta" | "compra";
  fecha: string;
  razon_social: string;
  cuit: string | null;
  comprobante: string | null;
  neto_gravado: number;
  iva_21: number;
  iva_10_5: number;
  iva_27: number;
  iva_otros: number;
  iva_total: number;
  percepciones: number;
  total: number;
  status?: string;
};

type Movement = {
  id: string;
  fecha: string;
  descripcion: string;
  tipo: "ingreso" | "egreso";
  monto: number;
  estado: string;
  banco: string;
  categoria_detalle?: string | null;
  jurisdiccion?: string | null;
  alicuota?: number | null;
};

type Props = {
  invoices: Invoice[];
  movements: Movement[];
  company: { razon_social: string; cuit: string } | null;
};

// --- utilidades de fecha ---
function today() { return new Date().toISOString().slice(0, 10); }
function firstOfMonth(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function lastOfMonth(d = new Date()) {
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return end.toISOString().slice(0, 10);
}
function firstOfYear(d = new Date()) { return `${d.getFullYear()}-01-01`; }
function lastOfYear(d = new Date())  { return `${d.getFullYear()}-12-31`; }
function firstOfQuarter(d = new Date()) {
  const q = Math.floor(d.getMonth() / 3);
  return `${d.getFullYear()}-${String(q * 3 + 1).padStart(2, "0")}-01`;
}
function lastOfQuarter(d = new Date()) {
  const q = Math.floor(d.getMonth() / 3);
  const end = new Date(d.getFullYear(), q * 3 + 3, 0);
  return end.toISOString().slice(0, 10);
}
function addMonths(d: Date, m: number) { const n = new Date(d); n.setMonth(n.getMonth() + m); return n; }

function ymKey(fecha: string) { return fecha?.slice(0, 7) ?? ""; }
function ymLabel(ym: string) {
  if (!ym) return "—";
  const [y, m] = ym.split("-");
  return `${MESES_ABREV[Number(m) - 1] ?? ""} ${y}`;
}

// ============================================================================

export function BalancesClient({ invoices, movements, company }: Props) {
  const now = new Date();
  const [desde, setDesde] = useState<string>(firstOfYear(now));
  const [hasta, setHasta] = useState<string>(lastOfYear(now));

  // Filtrado por rango
  const invInRange = useMemo(() => invoices.filter(i => i.fecha >= desde && i.fecha <= hasta), [invoices, desde, hasta]);
  const movInRange = useMemo(() => movements.filter(m => m.fecha >= desde && m.fecha <= hasta), [movements, desde, hasta]);

  const ventas  = invInRange.filter(i => i.tipo === "venta");
  const compras = invInRange.filter(i => i.tipo === "compra");

  // Clasificación de retenciones/percepciones bancarias
  const banco = useMemo(() => classifyBankMovements(movInRange), [movInRange]);

  // KPIs consolidados
  const kpi = useMemo(() => {
    const netoV = sum(ventas, "neto_gravado");
    const netoC = sum(compras, "neto_gravado");
    const ivaDebVentas = sum(ventas, "iva_total");
    const ivaCredCompras = sum(compras, "iva_total");

    // El IVA Crédito incluye: IVA de compras + retenciones/percepciones bancarias de IVA
    const ivaCredBanco = banco.totals.retencion_iva + banco.totals.retencion_debito_fiscal + banco.totals.percepcion_iva;
    const ivaCred = ivaCredCompras + ivaCredBanco;

    const totalV = sum(ventas, "total");
    const totalC = sum(compras, "total");
    const saldoIva = ivaDebVentas - ivaCred;
    const resultadoBruto = netoV - netoC;

    const ingresos = movInRange.filter(m => m.tipo === "ingreso").reduce((a,b) => a + Number(b.monto), 0);
    const egresos  = movInRange.filter(m => m.tipo === "egreso").reduce((a,b) => a + Number(b.monto), 0);
    const impuestosBanco = movInRange.filter(m => m.estado === "impuesto").reduce((a,b) => a + Number(b.monto), 0);
    const saldoBanco = ingresos - egresos;

    return {
      netoV, netoC,
      ivaDeb: ivaDebVentas,
      ivaCred,             // ya incluye banco
      ivaCredCompras,      // desagregado
      ivaCredBanco,        // desagregado
      totalV, totalC,
      saldoIva,
      resultadoBruto,
      ingresos, egresos, impuestosBanco, saldoBanco,
      cantV: ventas.length, cantC: compras.length, cantMov: movInRange.length
    };
  }, [ventas, compras, movInRange, banco]);

  // Resumen mensual ventas
  const mensualVentas  = useMemo(() => agruparPorMes(ventas), [ventas]);
  const mensualCompras = useMemo(() => agruparPorMes(compras), [compras]);

  // Bancos: por banco → por mes
  const resumenBancario = useMemo(() => {
    const map = new Map<string, Map<string, Movement[]>>();
    for (const m of movInRange) {
      const b = m.banco || "Sin banco";
      const k = ymKey(m.fecha);
      if (!map.has(b)) map.set(b, new Map());
      const byMonth = map.get(b)!;
      if (!byMonth.has(k)) byMonth.set(k, []);
      byMonth.get(k)!.push(m);
    }
    return Array.from(map.entries()).map(([banco, byMonth]) => ({
      banco,
      meses: Array.from(byMonth.entries())
        .map(([ym, rows]) => {
          const ing = rows.filter(r => r.tipo === "ingreso").reduce((a,b) => a + Number(b.monto), 0);
          const egr = rows.filter(r => r.tipo === "egreso").reduce((a,b) => a + Number(b.monto), 0);
          const imp = rows.filter(r => r.estado === "impuesto").reduce((a,b) => a + Number(b.monto), 0);
          return { ym, ing, egr, imp, saldo: ing - egr, cant: rows.length };
        })
        .sort((a,b) => b.ym.localeCompare(a.ym))
    }));
  }, [movInRange]);

  // Presets
  const presets = [
    { label: "Mes actual",  from: firstOfMonth(now),              to: lastOfMonth(now) },
    { label: "Mes anterior",from: firstOfMonth(addMonths(now,-1)),to: lastOfMonth(addMonths(now,-1)) },
    { label: "Trim. actual",from: firstOfQuarter(now),            to: lastOfQuarter(now) },
    { label: "Año actual",  from: firstOfYear(now),               to: lastOfYear(now) },
    { label: "Año pasado",  from: firstOfYear(new Date(now.getFullYear()-1, 0, 1)),
                            to:   lastOfYear(new Date(now.getFullYear()-1, 0, 1)) },
    { label: "Todo",        from: "2000-01-01",                   to: today() }
  ];

  function exportCsv() {
    const lines: string[] = [];
    lines.push(`Balance — ${company?.razon_social ?? "—"} (CUIT ${company?.cuit ?? "—"})`);
    lines.push(`Período: ${desde} a ${hasta}`);
    lines.push("");
    lines.push("CONSOLIDADO");
    lines.push("Ventas netas;" + kpi.netoV);
    lines.push("Compras netas;" + kpi.netoC);
    lines.push("IVA Débito;" + kpi.ivaDeb);
    lines.push("IVA Crédito;" + kpi.ivaCred);
    lines.push("Saldo IVA;" + kpi.saldoIva);
    lines.push("Resultado bruto;" + kpi.resultadoBruto);
    lines.push("Ingresos banco;" + kpi.ingresos);
    lines.push("Egresos banco;" + kpi.egresos);
    lines.push("Impuestos banco;" + kpi.impuestosBanco);
    lines.push("");
    lines.push("VENTAS POR MES;Cantidad;Neto;IVA 21;IVA 10.5;IVA 27;Otros IVA;Percepciones;Total");
    for (const r of mensualVentas) {
      lines.push([ymLabel(r.ym), r.count, r.neto, r.iva21, r.iva105, r.iva27, r.ivaOtros, r.percepciones, r.total].join(";"));
    }
    lines.push("");
    lines.push("COMPRAS POR MES;Cantidad;Neto;IVA 21;IVA 10.5;IVA 27;Otros IVA;Percepciones;Total");
    for (const r of mensualCompras) {
      lines.push([ymLabel(r.ym), r.count, r.neto, r.iva21, r.iva105, r.iva27, r.ivaOtros, r.percepciones, r.total].join(";"));
    }
    lines.push("");
    lines.push("BANCOS");
    for (const b of resumenBancario) {
      lines.push(`— ${b.banco};Cant;Ingresos;Egresos;Impuestos;Saldo`);
      for (const m of b.meses) lines.push([ymLabel(m.ym), m.cant, m.ing, m.egr, m.imp, m.saldo].join(";"));
    }
    lines.push("");
    lines.push("RETENCIONES Y PERCEPCIONES BANCARIAS");
    lines.push("Concepto;Monto");
    lines.push("Retencion IVA;"           + banco.totals.retencion_iva);
    lines.push("Retencion Debito Fiscal;" + banco.totals.retencion_debito_fiscal);
    lines.push("Percepcion IVA;"          + banco.totals.percepcion_iva);
    lines.push("Percepcion IIBB;"         + banco.totals.percepcion_iibb);
    lines.push("SIRCREB;"                 + banco.totals.sircreb);
    lines.push("Retencion Ganancias;"     + banco.totals.retencion_ganancias);
    lines.push("Impuesto Ley 25413 (IDB);"+ banco.totals.impuesto_ley_25413);
    lines.push("Mantenimiento cuenta;"    + banco.totals.mantenimiento_cuenta);
    lines.push("Comisiones bancarias;"    + banco.totals.comision_bancaria);
    if (banco.percepcionesIIBBPorJurisdiccion.length) {
      lines.push("");
      lines.push("PERCEPCIONES IIBB POR JURISDICCION;Cant;Monto");
      for (const p of banco.percepcionesIIBBPorJurisdiccion) {
        lines.push([p.jurisdiccion, p.cant, p.monto].join(";"));
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `balance_${company?.razon_social?.replace(/\s+/g,"_") ?? "empresa"}_${desde}_${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Topbar
        title="Balances"
        subtitle={`${company?.razon_social ?? "—"} · ${desde} → ${hasta}`}
        right={<button className="btn btn-primary" onClick={exportCsv}><Icon.Download/> Exportar CSV</button>}
      />
      <div className="p-8 space-y-6">

        {/* Selector de período */}
        <div className="card p-5">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <div className="text-[12px] font-medium text-ink-2 mb-1">Desde</div>
              <input type="date" className="input" value={desde} onChange={e => setDesde(e.target.value)} />
            </div>
            <div>
              <div className="text-[12px] font-medium text-ink-2 mb-1">Hasta</div>
              <input type="date" className="input" value={hasta} onChange={e => setHasta(e.target.value)} />
            </div>
            <div className="flex-1 flex flex-wrap items-center gap-2">
              <div className="text-[11px] uppercase tracking-wider text-ink-3 mr-1">Presets</div>
              {presets.map(p => (
                <button key={p.label}
                        className="btn btn-ghost"
                        style={{padding:"6px 12px", fontSize:12}}
                        onClick={() => { setDesde(p.from); setHasta(p.to); }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* KPIs consolidados */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
          <Kpi label="Ventas netas"  value={money(kpi.netoV)} hint={`${kpi.cantV} facturas · total ${money(kpi.totalV)}`} />
          <Kpi label="Compras netas" value={money(kpi.netoC)} hint={`${kpi.cantC} facturas · total ${money(kpi.totalC)}`} />
          <Kpi label="Resultado bruto"    value={money(kpi.resultadoBruto)} hint="Ventas netas − Compras netas" />
          <Kpi label="Saldo IVA"     value={money(kpi.saldoIva)}      hint={kpi.saldoIva >= 0 ? "A pagar" : "A favor"} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
          <Kpi label="IVA Débito"   value={money(kpi.ivaDeb)}  hint="Cobrado en ventas" />
          <Kpi label="IVA Crédito"
               value={money(kpi.ivaCred)}
               hint={`Compras ${money(kpi.ivaCredCompras)} + retenciones banco ${money(kpi.ivaCredBanco)}`} />
          <Kpi label="Ingresos banco" value={money(kpi.ingresos)} hint={`${kpi.cantMov} movimientos`} />
          <Kpi label="Egresos banco"  value={money(kpi.egresos)}  hint={`Impuestos bancarios ${money(kpi.impuestosBanco)}`} />
        </div>

        {/* Bloque retenciones y percepciones bancarias */}
        {banco.hasRetenciones && (
          <BankRetencionesBlock banco={banco} />
        )}

        {/* Bloque de egresos clasificados */}
        <BankEgresosBlock banco={banco} />

        {/* Ventas por mes */}
        <MonthlyTable
          title="Ventas emitidas"
          subtitle={`${ventas.length} comprobantes · ${money(kpi.netoV)} neto`}
          empty="No hay ventas en el período."
          rows={mensualVentas}
        />

        {/* Compras por mes */}
        <MonthlyTable
          title="Compras recibidas"
          subtitle={`${compras.length} comprobantes · ${money(kpi.netoC)} neto`}
          empty="No hay compras en el período."
          rows={mensualCompras}
          variant="compras"
        />

        {/* Bancos */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-line">
            <div className="sf-display text-[15px] font-semibold">Movimientos bancarios</div>
            <div className="text-[12px] text-ink-3">
              Agrupado por banco y por mes · {movInRange.length} movimientos en el período
            </div>
          </div>
          {resumenBancario.length === 0 ? (
            <div className="p-8 text-center text-ink-3 text-[13px]">No hay movimientos bancarios en el período.</div>
          ) : (
            <div className="p-4 space-y-4">
              {resumenBancario.map(b => {
                const tIng = b.meses.reduce((a,c) => a + c.ing, 0);
                const tEgr = b.meses.reduce((a,c) => a + c.egr, 0);
                const tImp = b.meses.reduce((a,c) => a + c.imp, 0);
                return (
                  <div key={b.banco} className="border border-line rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-line bg-surface-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon.Bank/>
                        <div className="sf-display text-[14px] font-semibold">{b.banco}</div>
                      </div>
                      <div className="text-[12px] text-ink-2 flex items-center gap-4">
                        <span>Ingresos <b className="text-ink-1">{money(tIng)}</b></span>
                        <span>Egresos <b className="text-ink-1">{money(tEgr)}</b></span>
                        <span>Impuestos <b className="text-ink-1">{money(tImp)}</b></span>
                        <Badge tone={tIng-tEgr >= 0 ? "success" : "danger"}>Saldo {money(tIng-tEgr)}</Badge>
                      </div>
                    </div>
                    <table className="clean">
                      <thead>
                        <tr>
                          <th>Mes</th>
                          <th className="text-right">Movimientos</th>
                          <th className="text-right">Ingresos</th>
                          <th className="text-right">Egresos</th>
                          <th className="text-right">Impuestos/Comisiones</th>
                          <th className="text-right">Saldo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {b.meses.map(m => (
                          <tr key={m.ym}>
                            <td className="font-medium">{ymLabel(m.ym)}</td>
                            <td className="text-right text-ink-2">{m.cant}</td>
                            <td className="text-right" style={{color:"#30a46c"}}>+ {money(m.ing)}</td>
                            <td className="text-right">− {money(m.egr)}</td>
                            <td className="text-right text-ink-2">{money(m.imp)}</td>
                            <td className="text-right font-semibold"
                                style={{color: m.saldo >= 0 ? "#30a46c" : "#f04f6f"}}>{money(m.saldo)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Estado de resultado simplificado */}
        <div className="card p-5">
          <div className="sf-display text-[15px] font-semibold mb-3">Estado de resultado simplificado</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <LineBlock title="Contable" lines={[
              ["Ventas netas", kpi.netoV, "pos"],
              ["(−) Compras netas", -kpi.netoC, "neg"],
              ["Resultado bruto", kpi.resultadoBruto, "total"]
            ]}/>
            <LineBlock title="Impositivo (IVA)" lines={[
              ["IVA Débito (ventas)", kpi.ivaDeb, "pos"],
              ["(−) IVA Crédito (compras)", -kpi.ivaCredCompras, "neg"],
              ["(−) Ret. / Perc. IVA banco", -(banco.totals.retencion_iva + banco.totals.retencion_debito_fiscal + banco.totals.percepcion_iva), "neg"],
              [kpi.saldoIva >= 0 ? "IVA a pagar" : "IVA a favor", kpi.saldoIva, "total"]
            ]}/>
          </div>
        </div>
      </div>
    </>
  );
}

function agruparPorMes(rows: Invoice[]) {
  const map = new Map<string, Invoice[]>();
  for (const r of rows) {
    const k = ymKey(r.fecha);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  return Array.from(map.entries()).map(([ym, rs]) => ({
    ym,
    count: rs.length,
    neto:  sum(rs, "neto_gravado"),
    iva21: sum(rs, "iva_21"),
    iva105:sum(rs, "iva_10_5"),
    iva27: sum(rs, "iva_27"),
    ivaOtros: sum(rs, "iva_otros"),
    ivaTotal: sum(rs, "iva_total"),
    percepciones: sum(rs, "percepciones"),
    total: sum(rs, "total")
  })).sort((a, b) => b.ym.localeCompare(a.ym));
}

function sum(arr: any[], k: string) {
  return arr.reduce((a, b) => a + Number(b[k] ?? 0), 0);
}

function MonthlyTable({
  title, subtitle, empty, rows, variant = "ventas"
}: {
  title: string; subtitle?: string; empty: string;
  rows: { ym: string; count: number; neto: number; iva21: number; iva105: number; iva27: number; ivaOtros: number; ivaTotal: number; percepciones: number; total: number }[];
  variant?: "ventas" | "compras";
}) {
  const tIva = rows.reduce((a,b) => a + b.ivaTotal, 0);
  const tNeto = rows.reduce((a,b) => a + b.neto, 0);
  const tTotal = rows.reduce((a,b) => a + b.total, 0);
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-line">
        <div>
          <div className="sf-display text-[15px] font-semibold">{title}</div>
          {subtitle && <div className="text-[12px] text-ink-3">{subtitle}</div>}
        </div>
        <div className="text-[12px] text-ink-2 flex items-center gap-4">
          <span>Neto <b className="text-ink-1">{money(tNeto)}</b></span>
          <span>{variant === "ventas" ? "IVA Débito" : "IVA Crédito"} <b className="text-ink-1">{money(tIva)}</b></span>
          <span>Total <b className="text-ink-1">{money(tTotal)}</b></span>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-ink-3 text-[13px]">{empty}</div>
      ) : (
        <div className="overflow-x-auto scroll-clean">
          <table className="clean">
            <thead>
              <tr>
                <th>Mes</th>
                <th className="text-right">Cant.</th>
                <th className="text-right">Neto gravado</th>
                <th className="text-right">IVA 21%</th>
                <th className="text-right">IVA 10.5%</th>
                <th className="text-right">IVA 27%</th>
                <th className="text-right">IVA otros</th>
                <th className="text-right">Percepciones</th>
                <th className="text-right">IVA total</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.ym}>
                  <td className="font-medium">{ymLabel(r.ym)}</td>
                  <td className="text-right text-ink-2">{r.count}</td>
                  <td className="text-right">{money(r.neto)}</td>
                  <td className="text-right text-ink-2">{money(r.iva21)}</td>
                  <td className="text-right text-ink-2">{money(r.iva105)}</td>
                  <td className="text-right text-ink-2">{money(r.iva27)}</td>
                  <td className="text-right text-ink-2">{money(r.ivaOtros)}</td>
                  <td className="text-right text-ink-2">{money(r.percepciones)}</td>
                  <td className="text-right font-semibold">{money(r.ivaTotal)}</td>
                  <td className="text-right font-semibold">{money(r.total)}</td>
                </tr>
              ))}
              <tr style={{ background: "var(--surface-2)", borderTop: "2px solid var(--line-2)" }}>
                <td className="font-bold">TOTAL</td>
                <td className="text-right font-bold">{rows.reduce((a,b)=>a+b.count,0)}</td>
                <td className="text-right font-bold">{money(rows.reduce((a,b)=>a+b.neto,0))}</td>
                <td className="text-right">{money(rows.reduce((a,b)=>a+b.iva21,0))}</td>
                <td className="text-right">{money(rows.reduce((a,b)=>a+b.iva105,0))}</td>
                <td className="text-right">{money(rows.reduce((a,b)=>a+b.iva27,0))}</td>
                <td className="text-right">{money(rows.reduce((a,b)=>a+b.ivaOtros,0))}</td>
                <td className="text-right">{money(rows.reduce((a,b)=>a+b.percepciones,0))}</td>
                <td className="text-right font-bold">{money(rows.reduce((a,b)=>a+b.ivaTotal,0))}</td>
                <td className="text-right font-bold">{money(rows.reduce((a,b)=>a+b.total,0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ==========================================================================
// Clasificación bancaria — retenciones y percepciones
// ==========================================================================

type BankBuckets = {
  retencion_iva: number;
  retencion_debito_fiscal: number;
  percepcion_iva: number;
  percepcion_iibb: number;
  sircreb: number;
  impuesto_ley_25413: number;
  retencion_ganancias: number;
  mantenimiento_cuenta: number;
  comision_bancaria: number;
  otros: number;
};

function emptyBuckets(): BankBuckets {
  return {
    retencion_iva: 0, retencion_debito_fiscal: 0,
    percepcion_iva: 0, percepcion_iibb: 0,
    sircreb: 0, impuesto_ley_25413: 0, retencion_ganancias: 0,
    mantenimiento_cuenta: 0, comision_bancaria: 0, otros: 0
  };
}

type BankClassification = {
  totals: BankBuckets;
  hasRetenciones: boolean;
  percepcionesIIBBPorJurisdiccion: { jurisdiccion: string; monto: number; cant: number }[];
  detalleRetenciones: {
    fecha: string; descripcion: string; monto: number;
    tipo: string; jurisdiccion?: string | null; alicuota?: number | null;
  }[];
  // Clasificación de egresos generales (pagos, retiros, servicios)
  egresos: {
    transferencia_salida: { monto: number; cant: number };
    pago_tarjeta_credito: { monto: number; cant: number };
    pago_afip_arca:       { monto: number; cant: number };
    pago_servicio:        { monto: number; cant: number };
    debito_automatico:    { monto: number; cant: number };
    extraccion:           { monto: number; cant: number };
    debin:                { monto: number; cant: number };
    cheque_emitido:       { monto: number; cant: number };
    compra_pos:           { monto: number; cant: number };
    otro:                 { monto: number; cant: number };
  };
};

/** Heurística de clasificación amplia. Devuelve la categoría y un tipo general. */
type GuessResult = { bucket: keyof BankBuckets | "pago_tc" | "pago_arca" | "pago_servicio" | "extraccion" | "debin" | "transferencia" | "interes" | "otro" };

function guessDetalle(desc: string): keyof BankBuckets | null {
  const s = desc.toUpperCase();
  // Fiscales primero
  if (/(RET\s*IVA|R\/IVA|RETEN\.?\s*IVA)/.test(s)) return "retencion_iva";
  if (/(RET\s*DEB.?\s*FISC|RET\s*DEBITO\s*FISCAL)/.test(s)) return "retencion_debito_fiscal";
  if (/(PERC\.?\s*IVA|P\/IVA)/.test(s)) return "percepcion_iva";
  if (/(PERC\.?\s*(IIBB|IB|ING|INGRESOS)|RET\.?\s*IIBB|R\/IIBB|AGIP|ARBA|\bAPI\b)/.test(s)) return "percepcion_iibb";
  if (/(RET\s*GAN|R\/GCIAS|PERC\s*GAN|RG\s*830)/.test(s)) return "retencion_ganancias";
  if (/(SIRCREB|RECAUD.?\s*BCRA)/.test(s)) return "sircreb";
  if (/(LEY\s*25413|DBCR\s*25413|IMP\.?\s*LEY|\bIDB\b|ITR\s*C\/B)/.test(s)) return "impuesto_ley_25413";
  // Bancarios
  if (/(MANT\.?\s*CUENTA|MANTENIMIENTO|ABONO\s*MENSUAL|COMISION\s*PAQUETE)/.test(s)) return "mantenimiento_cuenta";
  if (/(COMISION|COM\.?\s*TRF|CARGOS\s*VARIOS|N\/D\s*COMISION)/.test(s)) return "comision_bancaria";
  return null;
}

/** Clasifica egresos generales (pagos/retiros). Devuelve un tipo descriptivo. */
function guessEgresoTipo(desc: string): string {
  const s = desc.toUpperCase();
  if (/(EXTRACCION|CAJERO|\bATM\b|RETIRO\s*EFECTIVO)/.test(s)) return "extraccion";
  if (/\bDEBIN\b/.test(s)) return "debin";
  if (/(PAGO\s*TC|PAGO\s*TARJETA|RESUMEN\s*VISA|RESUMEN\s*MASTER|AMEX|SALDO\s*TARJETA|TARJETA\s*DE\s*CREDITO)/.test(s)) return "pago_tarjeta_credito";
  if (/(AFIP|ARCA|VEP\s|\bDGI\b|IMPUESTO\s*NACIONAL)/.test(s)) return "pago_afip_arca";
  if (/(EDESUR|EDENOR|METROGAS|NATURGY|AYSA|TELECOM|CLARO|MOVISTAR|PERSONAL|\bLUZ\b|\bGAS\b|\bAGUA\b|ABONO|NETFLIX|SPOTIFY|STREAMING|CABLEVISION|FIBERTEL|ARNET)/.test(s)) return "pago_servicio";
  if (/(TEF|TRANSF|MEP\b|CVU|TRANSFER)/.test(s)) return "transferencia_salida";
  if (/(DB\s*AUT|DEB\.?\s*AUTO|DEBITO\s*AUT)/.test(s)) return "debito_automatico";
  if (/(CHEQUE|\bCHQ\b)/.test(s)) return "cheque_emitido";
  if (/\bPOS\b|COMPRA/.test(s)) return "compra_pos";
  return "otro";
}

function inferJurisdiccion(desc: string): string | null {
  const s = desc.toUpperCase();
  if (/(AGIP|CABA)/.test(s))   return "CABA";
  if (/(ARBA|\bPBA\b|BS\.?\s*AS\.?|BUENOS\s*AIRES)/.test(s)) return "Buenos Aires";
  if (/API|SANTA\s*FE/.test(s)) return "Santa Fe";
  if (/CORDOBA|CBA/.test(s))    return "Córdoba";
  if (/MENDOZA|ATM/.test(s))    return "Mendoza";
  if (/(COMARB|CONVENIO)/.test(s)) return "Convenio Multilateral";
  return null;
}

function classifyBankMovements(movs: Movement[]): BankClassification {
  const totals = emptyBuckets();
  const detalleRetenciones: BankClassification["detalleRetenciones"] = [];
  const iibbByJur = new Map<string, { monto: number; cant: number }>();
  const egresos: BankClassification["egresos"] = {
    transferencia_salida: { monto: 0, cant: 0 },
    pago_tarjeta_credito: { monto: 0, cant: 0 },
    pago_afip_arca:       { monto: 0, cant: 0 },
    pago_servicio:        { monto: 0, cant: 0 },
    debito_automatico:    { monto: 0, cant: 0 },
    extraccion:           { monto: 0, cant: 0 },
    debin:                { monto: 0, cant: 0 },
    cheque_emitido:       { monto: 0, cant: 0 },
    compra_pos:           { monto: 0, cant: 0 },
    otro:                 { monto: 0, cant: 0 }
  };

  for (const m of movs) {
    const monto = Number(m.monto) || 0;
    if (!monto) continue;

    const cat = (m.categoria_detalle as keyof BankBuckets | undefined) ?? guessDetalle(m.descripcion ?? "");

    // 1) Si es retención/percepción/gasto bancario, acumulamos en buckets
    if (cat) {
      if (cat in totals) (totals as any)[cat] += monto;
      else totals.otros += monto;

      if (cat === "percepcion_iibb") {
        const jur = m.jurisdiccion ?? inferJurisdiccion(m.descripcion ?? "") ?? "Sin especificar";
        const cur = iibbByJur.get(jur) ?? { monto: 0, cant: 0 };
        iibbByJur.set(jur, { monto: cur.monto + monto, cant: cur.cant + 1 });
      }

      if (["retencion_iva","retencion_debito_fiscal","percepcion_iva","percepcion_iibb","retencion_ganancias","sircreb","impuesto_ley_25413"].includes(cat)) {
        detalleRetenciones.push({
          fecha: m.fecha, descripcion: m.descripcion, monto, tipo: cat,
          jurisdiccion: m.jurisdiccion ?? inferJurisdiccion(m.descripcion ?? ""),
          alicuota: m.alicuota ?? null
        });
      }
      continue;
    }

    // 2) Si es egreso no clasificado como fiscal, clasificarlo por tipo de pago
    if (m.tipo === "egreso") {
      const raw = (m.categoria_detalle as string | undefined) ?? guessEgresoTipo(m.descripcion ?? "");
      const key = (raw in egresos ? raw : "otro") as keyof typeof egresos;
      egresos[key].monto += monto;
      egresos[key].cant += 1;
    }
  }

  const hasRetenciones =
    totals.retencion_iva + totals.retencion_debito_fiscal +
    totals.percepcion_iva + totals.percepcion_iibb +
    totals.sircreb + totals.impuesto_ley_25413 + totals.retencion_ganancias > 0;

  const percepcionesIIBBPorJurisdiccion = Array.from(iibbByJur.entries())
    .map(([jurisdiccion, v]) => ({ jurisdiccion, monto: v.monto, cant: v.cant }))
    .sort((a, b) => b.monto - a.monto);

  return { totals, hasRetenciones, percepcionesIIBBPorJurisdiccion, detalleRetenciones, egresos };
}

const CATEGORIA_LABEL: Record<keyof BankBuckets, string> = {
  retencion_iva:            "Retención IVA",
  retencion_debito_fiscal:  "Retención Débito Fiscal",
  percepcion_iva:           "Percepción IVA",
  percepcion_iibb:          "Percepción IIBB",
  sircreb:                  "SIRCREB",
  impuesto_ley_25413:       "Impuesto Ley 25.413 (IDB)",
  retencion_ganancias:      "Retención Ganancias",
  mantenimiento_cuenta:     "Mantenimiento de cuenta",
  comision_bancaria:        "Comisiones bancarias",
  otros:                    "Otros"
};

function BankRetencionesBlock({ banco }: { banco: BankClassification }) {
  const { totals, percepcionesIIBBPorJurisdiccion } = banco;

  // IVA crédito: retenciones y percepciones de IVA. NO incluye Ley 25.413.
  const ivaCred = totals.retencion_iva + totals.retencion_debito_fiscal + totals.percepcion_iva;

  // IIBB crédito: percepciones IIBB + SIRCREB.
  const iibbCred = totals.percepcion_iibb + totals.sircreb;

  // Ganancias: retenciones directas + 33% del IDB Ley 25.413 (pago a cuenta).
  const idbComputableGanancias = totals.impuesto_ley_25413 * 0.33;
  const ganCred = totals.retencion_ganancias + idbComputableGanancias;

  // IDB total (se muestra aparte porque solo parte es computable)
  const idbTotal = totals.impuesto_ley_25413;

  const filas: { cat: keyof BankBuckets; color?: string }[] = [
    { cat: "retencion_iva" },
    { cat: "retencion_debito_fiscal" },
    { cat: "percepcion_iva" },
    { cat: "percepcion_iibb" },
    { cat: "sircreb" },
    { cat: "retencion_ganancias" },
    { cat: "impuesto_ley_25413" },
    { cat: "mantenimiento_cuenta" },
    { cat: "comision_bancaria" }
  ];

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-line">
        <div className="sf-display text-[15px] font-semibold">Retenciones y percepciones bancarias</div>
        <div className="text-[12px] text-ink-3">
          Las retenciones/percepciones de IVA se computan como crédito fiscal. Las de IIBB y Ganancias como créditos en sus respectivos impuestos.
        </div>
      </div>

      {/* Resumen por impuesto */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-0 border-b border-line">
        <SummaryCell title="Crédito IVA (banco)" value={ivaCred}
                     hint="Ret. IVA + Ret. Déb. Fiscal + Perc. IVA"/>
        <SummaryCell title="Crédito IIBB" value={iibbCred}
                     hint="Percepciones + SIRCREB"/>
        <SummaryCell title="Crédito Ganancias" value={ganCred}
                     hint={`Retenciones + 33% IDB (${money(idbComputableGanancias)})`}/>
        <SummaryCell title="IDB Ley 25.413" value={idbTotal}
                     hint="Impuesto débito/crédito · 33% computable a Ganancias"/>
      </div>

      {/* Tabla detallada por tipo */}
      <table className="clean">
        <thead>
          <tr>
            <th>Concepto</th>
            <th className="text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(({ cat }) => {
            const monto = totals[cat];
            if (monto === 0) return null;
            return (
              <tr key={cat}>
                <td className="font-medium">{CATEGORIA_LABEL[cat]}</td>
                <td className="text-right font-semibold">{money(monto)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Desglose de percepciones IIBB por jurisdicción */}
      {percepcionesIIBBPorJurisdiccion.length > 0 && (
        <>
          <div className="px-5 py-3 border-t border-line bg-surface-2">
            <div className="text-[12px] uppercase tracking-wider text-ink-3">Percepciones IIBB por jurisdicción</div>
          </div>
          <table className="clean">
            <thead>
              <tr>
                <th>Jurisdicción</th>
                <th className="text-right">Movimientos</th>
                <th className="text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              {percepcionesIIBBPorJurisdiccion.map(p => (
                <tr key={p.jurisdiccion}>
                  <td className="font-medium">{p.jurisdiccion}</td>
                  <td className="text-right text-ink-2">{p.cant}</td>
                  <td className="text-right font-semibold">{money(p.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function SummaryCell({ title, value, hint }: { title: string; value: number; hint?: string }) {
  return (
    <div className="p-4 border-r border-line last:border-r-0">
      <div className="text-[11px] uppercase tracking-wider text-ink-3">{title}</div>
      <div className="sf-display text-[20px] font-bold mt-1">{money(value)}</div>
      {hint && <div className="text-[11px] text-ink-3 mt-0.5">{hint}</div>}
    </div>
  );
}

// ==========================================================================
// Bloque de egresos bancarios clasificados (pagos TC, ARCA, servicios, etc.)
// ==========================================================================
function BankEgresosBlock({ banco }: { banco: BankClassification }) {
  const { egresos } = banco;
  const filas: { key: keyof typeof egresos; label: string; color?: string }[] = [
    { key: "transferencia_salida", label: "Transferencias salientes" },
    { key: "pago_tarjeta_credito",  label: "Pago tarjeta de crédito" },
    { key: "pago_afip_arca",        label: "Pagos AFIP / ARCA" },
    { key: "pago_servicio",         label: "Servicios públicos / suscripciones" },
    { key: "debito_automatico",     label: "Débitos automáticos" },
    { key: "extraccion",            label: "Extracciones cajero" },
    { key: "debin",                 label: "DEBIN" },
    { key: "cheque_emitido",        label: "Cheques emitidos" },
    { key: "compra_pos",            label: "Compras con tarjeta / POS" },
    { key: "otro",                  label: "Otros egresos sin clasificar" }
  ];
  const total = filas.reduce((a, f) => a + egresos[f.key].monto, 0);
  if (total === 0) return null;

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-line">
        <div className="sf-display text-[15px] font-semibold">Egresos bancarios — desglose</div>
        <div className="text-[12px] text-ink-3">
          Clasificación automática de pagos, retiros y débitos del período.
        </div>
      </div>
      <table className="clean">
        <thead>
          <tr>
            <th>Concepto</th>
            <th className="text-right">Movimientos</th>
            <th className="text-right">Total</th>
            <th className="text-right">% del total</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(f => {
            const e = egresos[f.key];
            if (e.monto === 0) return null;
            const pct = total > 0 ? (e.monto / total) * 100 : 0;
            return (
              <tr key={f.key}>
                <td className="font-medium">{f.label}</td>
                <td className="text-right text-ink-2">{e.cant}</td>
                <td className="text-right font-semibold">{money(e.monto)}</td>
                <td className="text-right text-ink-3">{pct.toFixed(1)}%</td>
              </tr>
            );
          })}
          <tr style={{ background: "var(--surface-2)", borderTop: "2px solid var(--line-2)" }}>
            <td className="font-bold">TOTAL EGRESOS</td>
            <td/>
            <td className="text-right font-bold">{money(total)}</td>
            <td/>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function LineBlock({ title, lines }: {
  title: string;
  lines: [string, number, "pos" | "neg" | "total"][];
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-ink-3 mb-2">{title}</div>
      {lines.map(([label, val, kind], i) => (
        <div key={i}
             className={`flex items-center justify-between py-2 ${kind === "total" ? "border-t border-line mt-1 pt-3 font-semibold" : ""}`}>
          <span className={kind === "total" ? "sf-display text-[14px]" : "text-[13px] text-ink-2"}>{label}</span>
          <span className={`font-mono ${kind === "neg" ? "text-ink-2" : ""}`}
                style={kind === "total" ? { color: val >= 0 ? "#1d1d1f" : "#f04f6f", fontSize: 16, fontWeight: 700 } : undefined}>
            {money(val)}
          </span>
        </div>
      ))}
    </div>
  );
}
