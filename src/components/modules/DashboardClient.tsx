"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/ui/Topbar";
import { Kpi } from "@/components/ui/Kpi";
import { Badge } from "@/components/ui/Badge";
import { AnnualChart } from "@/components/ui/AnnualChart";
import { Icon } from "@/components/ui/Icons";
import { MobileHero } from "@/components/ui/MobileHero";
import { money, periodoMesLabel } from "@/lib/format";
import type { Invoice, Company } from "@/lib/supabase/types";

type Props = {
  invoices: Invoice[];
  annual: { m: string; debito: number; credito: number }[];
  company: Company | null;
};

const MESES_ABREV = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
function ymKey(fecha: string) { return fecha?.slice(0, 7) ?? ""; }
function ymLabel(ym: string) {
  if (!ym) return "—";
  const [y, m] = ym.split("-");
  return `${MESES_ABREV[Number(m) - 1] ?? ""} ${y}`;
}

export function DashboardClient({ invoices: initial, annual, company }: Props) {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>(initial);
  const [tab, setTab] = useState<"mensual"|"anual">("mensual");
  const [filter, setFilter] = useState<"todos"|"venta"|"compra">("todos");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<Invoice | null>(null);
  const [anio, setAnio] = useState<string>("__todos__");
  const [mes, setMes] = useState<string>("__todos__"); // "__todos__" | "YYYY-MM"

  // Años disponibles en los datos reales
  const aniosDisponibles = useMemo(() => {
    const set = new Set<string>();
    invoices.forEach(i => {
      const y = i.fecha?.slice(0, 4);
      if (y) set.add(y);
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a)); // más reciente primero
  }, [invoices]);

  // Meses del año seleccionado
  const mesesDelAnio = useMemo(() => {
    const src = anio === "__todos__" ? invoices : invoices.filter(i => i.fecha?.startsWith(anio));
    const map = new Map<string, number>();
    src.forEach(i => {
      const k = ymKey(i.fecha);
      if (!k) return;
      map.set(k, (map.get(k) ?? 0) + 1);
    });
    return Array.from(map.entries())
      .map(([ym, count]) => ({ ym, count }))
      .sort((a, b) => b.ym.localeCompare(a.ym));
  }, [invoices, anio]);

  // Si el mes seleccionado no existe para el año elegido, caer a todos
  const mesEfectivo = useMemo(() => {
    if (mes === "__todos__") return "__todos__";
    return mesesDelAnio.some(m => m.ym === mes) ? mes : "__todos__";
  }, [mes, mesesDelAnio]);

  // Facturas después de aplicar tipo + año + mes + búsqueda
  const filtered = useMemo(() => {
    return invoices.filter(i => {
      if (filter !== "todos" && i.tipo !== filter) return false;
      if (anio !== "__todos__" && !i.fecha?.startsWith(anio)) return false;
      if (mesEfectivo !== "__todos__" && ymKey(i.fecha) !== mesEfectivo) return false;
      if (q) {
        const s = q.toLowerCase();
        return (i.razon_social + (i.cuit ?? "") + (i.comprobante ?? "")).toLowerCase().includes(s);
      }
      return true;
    }).slice().sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [invoices, filter, anio, mesEfectivo, q]);

  // KPIs calculados SOBRE el conjunto filtrado
  const totals = useMemo(() => {
    const ventas  = filtered.filter(i => i.tipo === "venta");
    const compras = filtered.filter(i => i.tipo === "compra");
    const netoV = ventas.reduce((a, b) => a + Number(b.neto_gravado ?? 0), 0);
    const netoC = compras.reduce((a, b) => a + Number(b.neto_gravado ?? 0), 0);
    const debito  = ventas.reduce((a, b) => a + Number(b.iva_total ?? 0), 0);
    const credito = compras.reduce((a, b) => a + Number(b.iva_total ?? 0), 0);
    return {
      netoV, netoC,
      debito, credito,
      saldo: debito - credito,
      ventasLen: ventas.length,
      comprasLen: compras.length
    };
  }, [filtered]);

  // Agrupar filtradas por mes (para cuando "Todos los meses" está activo)
  const agrupadoPorMes = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    filtered.forEach(i => {
      const k = ymKey(i.fecha);
      if (!map.has(k)) map.set(k, []);
      (map.get(k) as Invoice[]).push(i);
    });
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const anioActivoLabel = anio === "__todos__" ? "Todos los años" : anio;
  const mesActivoLabel  = mesEfectivo === "__todos__" ? "Todos los meses" : ymLabel(mesEfectivo);

  return (
    <>
      <Topbar
        title="Dashboard IVA"
        subtitle={`${company?.razon_social ?? "—"} · CUIT ${company?.cuit ?? "—"} · ${anioActivoLabel} · ${mesActivoLabel}`}
        right={<><button className="btn btn-ghost"><Icon.Download/> Exportar</button></>}
      />
      <div className="p-8 space-y-6">
        {!company && (
          <div className="card p-6 border-l-4" style={{ borderLeftColor: "var(--accent)" }}>
            <div className="sf-display text-[16px] font-semibold mb-1">Creá tu empresa para empezar</div>
            <div className="text-[13px] text-ink-2 mb-3">
              Necesitamos los datos fiscales para clasificar automáticamente ventas y compras.
            </div>
            <a className="btn btn-primary" href="/settings"><Icon.Cog/> Ir a Configuración</a>
          </div>
        )}

        {/* Hero principal mobile — chips de empresas, posición IVA del mes, botón subir */}
        <MobileHero invoices={invoices as any} onUploaded={() => router.refresh()} />

        {/* KPIs del período filtrado */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
          <Kpi label="IVA Débito"
               value={money(totals.debito)}
               hint={`${totals.ventasLen} ventas · ${anioActivoLabel} · ${mesActivoLabel}`} />
          <Kpi label="IVA Crédito"
               value={money(totals.credito)}
               hint={`${totals.comprasLen} compras · ${anioActivoLabel} · ${mesActivoLabel}`} />
          <Kpi label="Saldo IVA"
               value={money(totals.saldo)}
               hint={totals.saldo >= 0 ? "A pagar en la próxima DDJJ" : "Saldo a favor"} />
          <Kpi label="Facturas en el período"
               value={String(filtered.length)}
               hint={`Ventas ${money(totals.netoV)} · Compras ${money(totals.netoC)}`} />
        </div>

        <UploadDropzone onDone={() => router.refresh()} />
        <ArcaListDropzone onDone={() => router.refresh()} />
        <ArcaCsvDropzone onDone={() => router.refresh()} />

        {/* Tabs de año — solo los que tienen facturas */}
        <div className="card p-3">
          <div className="flex items-center gap-2 overflow-x-auto scroll-clean">
            <DashTab active={anio === "__todos__"} onClick={() => { setAnio("__todos__"); setMes("__todos__"); }}>
              Todos los años <span className="ml-1 text-ink-3 text-[11px]">· {invoices.length}</span>
            </DashTab>
            {aniosDisponibles.map(y => {
              const count = invoices.filter(i => i.fecha?.startsWith(y)).length;
              return (
                <DashTab key={y} active={anio === y} onClick={() => { setAnio(y); setMes("__todos__"); }}>
                  {y} <span className="ml-1 text-ink-3 text-[11px]">· {count}</span>
                </DashTab>
              );
            })}
            {aniosDisponibles.length === 0 && (
              <div className="text-[12px] text-ink-3 px-2 py-1.5">
                Todavía no cargaste facturas. Soltá PDFs abajo para empezar.
              </div>
            )}
          </div>
        </div>

        {/* Tabs de mes dentro del año */}
        {mesesDelAnio.length > 0 && (
          <div className="card p-3">
            <div className="flex items-center gap-2 overflow-x-auto scroll-clean">
              <DashTab active={mesEfectivo === "__todos__"} onClick={() => setMes("__todos__")} small>
                Todos los meses <span className="ml-1 text-ink-3 text-[10px]">· {mesesDelAnio.reduce((a,b)=>a+b.count,0)}</span>
              </DashTab>
              {mesesDelAnio.map(m => (
                <DashTab key={m.ym} active={mesEfectivo === m.ym} onClick={() => setMes(m.ym)} small>
                  {ymLabel(m.ym)} <span className="ml-1 text-ink-3 text-[10px]">· {m.count}</span>
                </DashTab>
              ))}
            </div>
          </div>
        )}

        {/* Filtros venta/compra + búsqueda + switch a gráfico anual */}
        <div className="card p-3 flex flex-wrap items-center gap-3">
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: "#ececf0" }}>
            <div className={`tab ${tab==="mensual"?"active":""}`} onClick={()=>setTab("mensual")}>Libro</div>
            <div className={`tab ${tab==="anual"?"active":""}`} onClick={()=>setTab("anual")}>Gráfico anual</div>
          </div>
          {tab === "mensual" && (
            <>
              <div className="flex gap-1 p-1 rounded-xl" style={{ background: "#ececf0" }}>
                {[{k:"todos",t:"Todos"},{k:"venta",t:"Ventas"},{k:"compra",t:"Compras"}].map(o => (
                  <div key={o.k} className={`tab ${filter===o.k?"active":""}`} onClick={()=>setFilter(o.k as any)}>{o.t}</div>
                ))}
              </div>
              <div className="flex-1 min-w-[240px] relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"><Icon.Search /></div>
                <input className="input pl-9" placeholder="Buscar razón social, CUIT o comprobante…"
                       value={q} onChange={e=>setQ(e.target.value)} />
              </div>
            </>
          )}
        </div>

        {tab === "mensual" ? (
          mesEfectivo === "__todos__" && agrupadoPorMes.length > 1 ? (
            agrupadoPorMes.map(([ym, rows]) => (
              <InvoicesTable
                key={ym}
                title={ymLabel(ym)}
                subtitle={summaryLine(rows)}
                rows={rows}
                onClick={setDetail}
              />
            ))
          ) : (
            <InvoicesTable
              title={`Libro · ${anioActivoLabel} · ${mesActivoLabel}`}
              subtitle={filtered.length ? summaryLine(filtered) : ""}
              rows={filtered}
              onClick={setDetail}
            />
          )
        ) : (
          <div className="card p-5">
            <div className="flex items-center gap-4 text-[13px] mb-3 text-ink-2">
              <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded" style={{background:"#0071e3"}} />Débito fiscal</div>
              <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded" style={{background:"#54a0ff"}} />Crédito fiscal</div>
            </div>
            <AnnualChart data={annual} />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-6">
              <Kpi label="Débito anual" value={money(annual.reduce((a,b)=>a+b.debito,0))} hint="IVA ventas acumulado (año en curso)" />
              <Kpi label="Crédito anual" value={money(annual.reduce((a,b)=>a+b.credito,0))} hint="IVA compras acumulado" />
              <Kpi label="Resultado anual IVA" value={money(annual.reduce((a,b)=>a+b.debito-b.credito,0))} hint="Proyección actual" />
            </div>
          </div>
        )}
      </div>

      {detail && (
        <InvoiceDetail
          invoice={detail}
          onClose={() => setDetail(null)}
          onSaved={(upd) => {
            setInvoices(prev => prev.map(x => x.id === upd.id ? upd : x));
            setDetail(upd);
          }}
          onDeleted={(id) => {
            setInvoices(prev => prev.filter(x => x.id !== id));
            setDetail(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function InvoiceDetail({
  invoice, onClose, onSaved, onDeleted
}: {
  invoice: Invoice;
  onClose: () => void;
  onSaved: (inv: Invoice) => void;
  onDeleted: (id: string) => void;
}) {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(true);
  const [form, setForm] = useState({
    razon_social: invoice.razon_social ?? "",
    cuit: invoice.cuit ?? "",
    fecha: invoice.fecha ?? "",
    comprobante: invoice.comprobante ?? "",
    tipo: invoice.tipo,
    neto_gravado: String(invoice.neto_gravado ?? 0),
    iva_21: String(invoice.iva_21 ?? 0),
    iva_10_5: String(invoice.iva_10_5 ?? 0),
    iva_27: String(invoice.iva_27 ?? 0),
    iva_otros: String(invoice.iva_otros ?? 0),
    percepciones: String((invoice as any).percepciones ?? 0),
    total: String(invoice.total ?? 0),
    moneda: (invoice as any).moneda ?? "ARS",
    tipo_cambio: String((invoice as any).tipo_cambio ?? 1)
  });
  const [saving, setSaving] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  async function onDelete() {
    const conf = window.confirm(
      `¿Eliminar la factura ${invoice.comprobante ?? invoice.id}?\n\nSe borra del libro IVA y del archivo. Los movimientos bancarios vinculados vuelven a "pendiente". Esta acción no se puede deshacer.`
    );
    if (!conf) return;
    setErr(null); setMsg(null); setDeleting(true);
    try {
      const res = await fetch("/api/invoice/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: invoice.id })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      onDeleted(invoice.id);
    } catch (e: any) {
      setErr(e.message || "No se pudo eliminar");
    } finally { setDeleting(false); }
  }

  // Cargar signed URL del archivo
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/invoice/file?id=${invoice.id}`);
        const d = await r.json();
        if (alive && r.ok && d.url) setFileUrl(d.url);
      } finally { if (alive) setLoadingFile(false); }
    })();
    return () => { alive = false; };
  }, [invoice.id]);

  async function save() {
    setErr(null); setMsg(null); setSaving(true);
    try {
      const num = (v: string) => Number(v.replace(",", ".")) || 0;
      const res = await fetch("/api/invoice/update", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: invoice.id,
          fields: {
            razon_social: form.razon_social.trim(),
            cuit: form.cuit.trim() || null,
            fecha: form.fecha,
            comprobante: form.comprobante.trim() || null,
            tipo: form.tipo,
            neto_gravado: num(form.neto_gravado),
            iva_21: num(form.iva_21),
            iva_10_5: num(form.iva_10_5),
            iva_27: num(form.iva_27),
            iva_otros: num(form.iva_otros),
            percepciones: num(form.percepciones),
            total: num(form.total),
            moneda: form.moneda,
            tipo_cambio: num(form.tipo_cambio) || 1
          }
        })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      onSaved(d.invoice);
      setMsg("Cambios guardados");
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function replaceFile(file: File) {
    setErr(null); setMsg(null); setReplacing(true);
    try {
      const fd = new FormData();
      fd.append("id", invoice.id);
      fd.append("file", file);
      const res = await fetch("/api/invoice/replace-file", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      if (d.invoice) {
        onSaved(d.invoice);
        setForm({
          razon_social: d.invoice.razon_social ?? "",
          cuit: d.invoice.cuit ?? "",
          fecha: d.invoice.fecha ?? "",
          comprobante: d.invoice.comprobante ?? "",
          tipo: d.invoice.tipo,
          neto_gravado: String(d.invoice.neto_gravado ?? 0),
          iva_21: String(d.invoice.iva_21 ?? 0),
          iva_10_5: String(d.invoice.iva_10_5 ?? 0),
          iva_27: String(d.invoice.iva_27 ?? 0),
          iva_otros: String(d.invoice.iva_otros ?? 0),
          percepciones: String((d.invoice as any).percepciones ?? 0),
          total: String(d.invoice.total ?? 0)
        });
        setMsg(`PDF reemplazado y re-procesado. Confianza: ${Math.round((d.confidence ?? 0)*100)}%`);
      } else {
        setMsg(d.warning || "Archivo reemplazado.");
      }
      // Recargar el visor de PDF con la nueva URL
      setFileUrl(null);
      setLoadingFile(true);
      const r = await fetch(`/api/invoice/file?id=${invoice.id}`);
      const dd = await r.json();
      if (r.ok && dd.url) setFileUrl(dd.url);
      setLoadingFile(false);
    } catch (e: any) { setErr(e.message); }
    finally { setReplacing(false); }
  }

  async function reprocess(tier: "fast" | "precise" | "premium" = "precise") {
    setErr(null); setMsg(null); setReprocessing(true);
    try {
      const res = await fetch("/api/invoice/reprocess", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: invoice.id, tier })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      onSaved(d.invoice);
      // Actualizar form con los nuevos valores
      setForm({
        razon_social: d.invoice.razon_social ?? "",
        cuit: d.invoice.cuit ?? "",
        fecha: d.invoice.fecha ?? "",
        comprobante: d.invoice.comprobante ?? "",
        tipo: d.invoice.tipo,
        neto_gravado: String(d.invoice.neto_gravado ?? 0),
        iva_21: String(d.invoice.iva_21 ?? 0),
        iva_10_5: String(d.invoice.iva_10_5 ?? 0),
        iva_27: String(d.invoice.iva_27 ?? 0),
        iva_otros: String(d.invoice.iva_otros ?? 0),
        percepciones: String((d.invoice as any).percepciones ?? 0),
        total: String(d.invoice.total ?? 0)
      });
      setMsg(`Re-procesado con IA. Confianza: ${Math.round((d.confidence ?? 0)*100)}%`);
    } catch (e: any) { setErr(e.message); }
    finally { setReprocessing(false); }
  }

  const meta = (invoice as any).ai_metadata || {};
  const desglose: any[] = meta.desglose_impuestos || [];

  return (
    <>
      <div className="modal-back" onClick={onClose}/>
      <div className="fixed inset-6 card soft z-30 fade-in flex overflow-hidden">
        {/* Visor del archivo */}
        <div className="flex-1 min-w-0 bg-[#0b0b0e] flex items-center justify-center p-4">
          {loadingFile ? (
            <div className="text-white/60 text-[13px]">Cargando factura…</div>
          ) : fileUrl ? (
            <iframe src={fileUrl} className="w-full h-full rounded-lg bg-white" title="Factura"/>
          ) : (
            <div className="text-white/60 text-[13px]">Esta factura no tiene archivo asociado.</div>
          )}
        </div>

        {/* Panel de edición */}
        <div className="w-[480px] shrink-0 overflow-y-auto scroll-clean p-6 border-l border-line bg-white">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="text-[12px] uppercase tracking-wider text-ink-3">Factura</div>
              <div className="sf-display text-[20px] font-semibold mt-1 truncate">{invoice.comprobante || "Sin número"}</div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge tone={invoice.tipo}>{invoice.tipo === "venta" ? "Venta" : "Compra"}</Badge>
                {(invoice as any).status === "revision" && <Badge tone="warning">Revisar</Badge>}
                {(invoice as any).moneda && (invoice as any).moneda !== "ARS" && (
                  <Badge tone="info">
                    {(invoice as any).moneda} · TC {(invoice as any).tipo_cambio}
                  </Badge>
                )}
                {(invoice as any).ai_confidence != null && (
                  <Badge tone="info">IA {Math.round(Number((invoice as any).ai_confidence)*100)}%</Badge>
                )}
              </div>
            </div>
            <button className="btn btn-ghost" style={{padding:"6px 10px"}} onClick={onClose}><Icon.Close/></button>
          </div>

          <div className="flex gap-2 mb-2">
            {meta.from_arca_list ? (
              <>
                <button className="btn btn-ghost"
                        onClick={() => replaceInputRef.current?.click()}
                        disabled={replacing || saving}>
                  <Icon.Upload/> {replacing ? "Subiendo…" : "Subir PDF individual"}
                </button>
                <input
                  ref={replaceInputRef}
                  type="file"
                  accept="application/pdf,image/*"
                  hidden
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) replaceFile(f); e.target.value = ""; }}
                />
              </>
            ) : (
              <button className="btn btn-ghost" onClick={() => reprocess("precise")} disabled={reprocessing || !fileUrl}>
                <Icon.Sparkles/> {reprocessing ? "Re-procesando…" : "Reprocesar IA"}
              </button>
            )}
            <button className="btn btn-primary flex-1 justify-center" onClick={save} disabled={saving}>
              <Icon.Check/> {saving ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
          {!meta.from_arca_list && (
            <div className="mb-2">
              <button
                className="btn btn-ghost w-full justify-center"
                onClick={() => reprocess("premium")}
                disabled={reprocessing || !fileUrl}
                style={{ background: "linear-gradient(135deg,#fde68a,#fcd34d)", color: "#7c2d12", borderColor: "#fcd34d" }}
              >
                <Icon.Sparkles/> {reprocessing ? "Procesando…" : "Reprocesar con IA Premium (Opus)"}
              </button>
              <div className="text-[10px] text-ink-3 mt-1 text-center">
                Más caro pero más preciso. Usalo solo si la IA estándar falla.
              </div>
            </div>
          )}
          {meta.from_arca_list && (
            <div className="mb-2 p-2.5 rounded-lg bg-[#fff4e5] border border-[#ffd9a8] text-[11px] text-[#8a5a10] leading-snug">
              Esta factura vino de un <b>listado ARCA</b>. El "archivo" es el listado completo, no la factura individual.
              Para que la IA lea el detalle (desglose de IVA, CAE, percepciones exactas),
              bajá el PDF individual desde ARCA y subilo con el botón de arriba — va a reemplazar este registro.
              También podés editar los valores a mano y guardar.
            </div>
          )}
          <div className="flex mb-4">
            <button
              className="btn btn-ghost w-full justify-center"
              onClick={onDelete}
              disabled={deleting || saving || reprocessing}
              style={{ color: "#f04f6f" }}
            >
              <Icon.Close/> {deleting ? "Eliminando…" : "Eliminar factura"}
            </button>
          </div>

          {msg && <div className="mb-3 p-2.5 rounded-lg bg-[#e6f6ed] text-[#176a4a] text-[12px]">{msg}</div>}
          {err && <div className="mb-3 p-2.5 rounded-lg bg-[#fdeaef] text-[#9c2944] text-[12px]">{err}</div>}

          <Section title="Identificación">
            <Row label="Razón social">
              <input className="input" value={form.razon_social} onChange={e=>setForm({...form,razon_social:e.target.value})}/>
            </Row>
            <Row label="CUIT">
              <input className="input" value={form.cuit} onChange={e=>setForm({...form,cuit:e.target.value})}/>
            </Row>
            <Row label="Fecha">
              <input className="input" type="date" value={form.fecha} onChange={e=>setForm({...form,fecha:e.target.value})}/>
            </Row>
            <Row label="Comprobante">
              <input className="input" value={form.comprobante} onChange={e=>setForm({...form,comprobante:e.target.value})}/>
            </Row>
            <Row label="Tipo">
              <select className="input" value={form.tipo} onChange={e=>setForm({...form,tipo:e.target.value as any})}>
                <option value="venta">Venta</option>
                <option value="compra">Compra</option>
              </select>
            </Row>
          </Section>

          <Section title="Moneda">
            <div className="grid grid-cols-2 gap-3">
              <Row label="Moneda">
                <select
                  className="input"
                  value={form.moneda}
                  onChange={e => setForm({...form, moneda: e.target.value, tipo_cambio: e.target.value === "ARS" ? "1" : form.tipo_cambio})}
                >
                  <option value="ARS">Pesos (ARS)</option>
                  <option value="USD">Dólares (USD)</option>
                  <option value="EUR">Euros (EUR)</option>
                  <option value="OTRA">Otra</option>
                </select>
              </Row>
              <Row label="Tipo de cambio a ARS">
                <NumInp
                  value={form.tipo_cambio}
                  onChange={v => setForm({...form, tipo_cambio: v})}
                />
              </Row>
            </div>
            {form.moneda !== "ARS" && (invoice as any).total_moneda_original != null && (
              <div className="mt-2 p-2.5 rounded-lg bg-[#e8f1fd] text-[#0062c2] text-[11px]">
                <b>Original en {form.moneda}:</b>&nbsp;
                Neto {money(Number((invoice as any).neto_moneda_original ?? 0))} ·&nbsp;
                IVA {money(Number((invoice as any).iva_total_moneda_original ?? 0))} ·&nbsp;
                Total {money(Number((invoice as any).total_moneda_original ?? 0))}
                <br/>
                <span className="text-ink-3">
                  Los importes de abajo están convertidos a ARS con TC {(invoice as any).tipo_cambio}.
                </span>
              </div>
            )}
            {form.moneda !== "ARS" && (
              <div className="mt-3">
                <button
                  className="btn btn-ghost w-full justify-center"
                  onClick={() => {
                    const tc = Number(form.tipo_cambio.replace(",", ".")) || 1;
                    if (tc <= 0) { alert("Poné un tipo de cambio mayor a 0"); return; }
                    const conf = confirm(
                      `Recalcular todos los importes multiplicando por TC ${tc}?\n\n` +
                      `Los importes actuales del formulario se tratarán como ${form.moneda}, y se convertirán a ARS multiplicando por ${tc}.\n\n` +
                      `Ejemplo: si Neto Gravado = 1.000, va a quedar en ${(1000 * tc).toLocaleString("es-AR")} ARS.`
                    );
                    if (!conf) return;
                    const num = (v: string) => Number(v.replace(",", ".")) || 0;
                    const mul = (v: string) => (num(v) * tc).toFixed(2);
                    setForm({
                      ...form,
                      neto_gravado: mul(form.neto_gravado),
                      iva_21:       mul(form.iva_21),
                      iva_10_5:     mul(form.iva_10_5),
                      iva_27:       mul(form.iva_27),
                      iva_otros:    mul(form.iva_otros),
                      percepciones: mul(form.percepciones),
                      total:        mul(form.total)
                    });
                    setMsg(`Importes multiplicados por TC ${tc}. Ahora hacé click en "Guardar cambios" para confirmar.`);
                  }}
                  style={{ background: "linear-gradient(135deg,#fde68a,#fcd34d)", color: "#7c2d12", borderColor: "#fcd34d" }}
                >
                  <Icon.Sparkles/> Recalcular importes × TC {form.tipo_cambio || "?"}
                </button>
                <div className="text-[11px] text-ink-3 mt-1 text-center leading-snug">
                  Usalo si la factura fue cargada en pesos pero era en {form.moneda}.<br/>
                  Toma los valores actuales como {form.moneda} y los multiplica por el TC.
                </div>
              </div>
            )}
          </Section>

          <Section title={form.moneda === "ARS" ? "Importes (ARS)" : `Importes convertidos a ARS`}>
            <Row label="Neto gravado">  <NumInp value={form.neto_gravado} onChange={v=>setForm({...form,neto_gravado:v})}/></Row>
            <Row label="IVA 21%">       <NumInp value={form.iva_21}        onChange={v=>setForm({...form,iva_21:v})}/></Row>
            <Row label="IVA 10.5%">     <NumInp value={form.iva_10_5}      onChange={v=>setForm({...form,iva_10_5:v})}/></Row>
            <Row label="IVA 27%">       <NumInp value={form.iva_27}        onChange={v=>setForm({...form,iva_27:v})}/></Row>
            <Row label="IVA otros">     <NumInp value={form.iva_otros}     onChange={v=>setForm({...form,iva_otros:v})}/></Row>
            <Row label="Percepciones">  <NumInp value={form.percepciones}  onChange={v=>setForm({...form,percepciones:v})}/></Row>
            <Row label="TOTAL final">   <NumInp value={form.total}         onChange={v=>setForm({...form,total:v})} bold/></Row>
          </Section>

          {desglose.length > 0 && (
            <Section title="Desglose de impuestos detectado por IA">
              <div className="text-[11px] text-ink-3 mb-2">Referencia — los totales editables de arriba son la fuente de verdad.</div>
              <div className="space-y-1">
                {desglose.map((d, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-surface-2 text-[12px]">
                    <div className="min-w-0 pr-2">
                      <div className="truncate font-medium">{d.descripcion}</div>
                      <div className="text-ink-3">
                        {d.tipo}{d.alicuota!=null ? ` · ${d.alicuota}%` : ""}{d.jurisdiccion ? ` · ${d.jurisdiccion}` : ""}
                      </div>
                    </div>
                    <div className="font-semibold">{money(Number(d.monto ?? 0))}</div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {meta.warnings?.length > 0 && (
            <Section title="Observaciones de la IA">
              <ul className="text-[12px] text-ink-2 list-disc pl-4 space-y-0.5">
                {meta.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
              </ul>
            </Section>
          )}

          {meta.manual_edited && (
            <div className="mt-4 text-[11px] text-ink-3">
              ✎ Esta factura fue editada manualmente.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="text-[11px] uppercase tracking-wider text-ink-3 mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-ink-2 mb-1">{label}</div>
      {children}
    </div>
  );
}
function NumInp({ value, onChange, bold }: { value: string; onChange: (v: string) => void; bold?: boolean }) {
  return (
    <input
      className="input"
      inputMode="decimal"
      value={value}
      onChange={e => onChange(e.target.value.replace(/[^\d.,\-]/g, ""))}
      style={bold ? { fontWeight: 700 } : undefined}
    />
  );
}

function DashTab({
  active, onClick, children, small
}: { active: boolean; onClick: () => void; children: React.ReactNode; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex items-center gap-1.5 whitespace-nowrap rounded-xl transition-colors",
        small ? "px-2.5 py-1 text-[12px]" : "px-3 py-1.5 text-[13px]",
        active ? "font-semibold" : "text-ink-2 hover:bg-[#ececf0]"
      ].join(" ")}
      style={active ? { background: "var(--text)", color: "#fff" } : { background: "var(--surface-2)" }}
    >
      {children}
    </button>
  );
}

function summaryLine(rows: Invoice[]) {
  const ventas  = rows.filter(r => r.tipo === "venta");
  const compras = rows.filter(r => r.tipo === "compra");
  const debito  = ventas.reduce((a,b)=>a+Number(b.iva_total ?? 0), 0);
  const credito = compras.reduce((a,b)=>a+Number(b.iva_total ?? 0), 0);
  return `${rows.length} facturas · Débito ${money(debito)} · Crédito ${money(credito)} · Saldo ${money(debito - credito)}`;
}

function InvoicesTable({
  title, subtitle, rows, onClick
}: {
  title: string;
  subtitle?: string;
  rows: Invoice[];
  onClick: (inv: Invoice) => void;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-line">
        <div className="min-w-0">
          <div className="sf-display text-[15px] font-semibold">{title}</div>
          {subtitle && <div className="text-[12px] text-ink-3">{subtitle}</div>}
        </div>
        <div className="text-[12px] text-ink-3">Click en una fila para ver el PDF y editar.</div>
      </div>
      <div className="overflow-x-auto scroll-clean">
        <table className="clean">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Razón Social</th>
              <th>CUIT</th>
              <th>Comprobante</th>
              <th className="text-right">Neto Gravado</th>
              <th className="text-right">IVA</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(i => (
              <tr key={i.id} onClick={() => onClick(i)} className="cursor-pointer hover:bg-[#fafafb]">
                <td className="text-ink-2">{i.fecha}</td>
                <td><Badge tone={i.tipo as any}>{i.tipo === "venta" ? "Venta" : "Compra"}</Badge></td>
                <td className="font-medium truncate" title={i.razon_social ?? ""} style={{ maxWidth: 320 }}>
                  {i.razon_social}
                  {(i as any).status === "revision" && <span className="ml-2"><Badge tone="warning">Revisar</Badge></span>}
                </td>
                <td className="text-ink-2">{i.cuit}</td>
                <td className="text-ink-2 truncate" title={i.comprobante ?? ""} style={{ maxWidth: 220 }}>{i.comprobante}</td>
                <td className="text-right font-medium">{money(i.neto_gravado)}</td>
                <td className="text-right text-ink-2">{money(i.iva_total)}</td>
                <td className="text-right font-semibold">{money(i.total)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={8} className="text-center py-10 text-ink-3">
                No hay facturas en este período.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// Upload Dropzone con soporte de CARPETAS (webkitdirectory + DataTransferItem)
// ============================================================================

type QueueItem = {
  path: string;          // ruta relativa (ej: "2025/Enero/factura-001.pdf")
  file: File;
  status: "pending" | "processing" | "ok" | "error";
  error?: string;
};

// Extensiones válidas
const VALID_EXT = /\.(pdf|png|jpe?g|webp|gif|bmp|tiff?)$/i;

/**
 * Lee recursivamente una entrada (archivo o carpeta) del API de DataTransfer.
 * Devuelve una lista plana de {path, file}.
 */
async function readEntry(entry: any, basePath = ""): Promise<QueueItem[]> {
  if (!entry) return [];
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file((f: File) => {
        if (!VALID_EXT.test(f.name)) return resolve([]);
        resolve([{ path: basePath + f.name, file: f, status: "pending" }]);
      }, () => resolve([]));
    });
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const all: QueueItem[] = [];
    // readEntries puede devolver en chunks; hay que llamar hasta que devuelva vacío
    const readBatch = () =>
      new Promise<any[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
    while (true) {
      const batch = await readBatch();
      if (!batch.length) break;
      for (const e of batch) {
        const sub = await readEntry(e, basePath + entry.name + "/");
        all.push(...sub);
      }
    }
    return all;
  }
  return [];
}

function UploadDropzone({ onDone }: { onDone: () => void }) {
  const [drag, setDrag] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [sourceLabel, setSourceLabel] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Del input con webkitdirectory (o múltiples archivos sueltos)
  function addFromFileList(list: FileList | null, label?: string) {
    if (!list || !list.length) return;
    const items: QueueItem[] = [];
    for (let i = 0; i < list.length; i++) {
      const f = list.item(i);
      if (!f) continue;
      if (!VALID_EXT.test(f.name)) continue;
      // webkitRelativePath se llena cuando se usa webkitdirectory
      const rel = (f as any).webkitRelativePath || f.name;
      items.push({ path: rel, file: f, status: "pending" });
    }
    if (label) setSourceLabel(label);
    setQueue(prev => [...prev, ...items]);
  }

  // Del drag&drop (soporta carpetas vía DataTransferItem.webkitGetAsEntry)
  async function addFromDataTransfer(dt: DataTransfer) {
    const newItems: QueueItem[] = [];
    const items = Array.from(dt.items);
    const hasEntryApi = items.some(it => typeof (it as any).webkitGetAsEntry === "function");
    if (hasEntryApi) {
      for (const it of items) {
        const entry = (it as any).webkitGetAsEntry?.();
        if (!entry) continue;
        const collected = await readEntry(entry);
        newItems.push(...collected);
      }
      // Si solo se arrastró una carpeta, usar su nombre como label
      const roots = Array.from(dt.items)
        .map(it => (it as any).webkitGetAsEntry?.())
        .filter((e: any) => e?.isDirectory)
        .map((e: any) => e.name);
      if (roots.length === 1) setSourceLabel(`📁 ${roots[0]}`);
      else if (roots.length > 1) setSourceLabel(`📁 ${roots.length} carpetas`);
    } else {
      // Fallback sin entry API — archivos sueltos
      for (let i = 0; i < dt.files.length; i++) {
        const f = dt.files.item(i);
        if (!f || !VALID_EXT.test(f.name)) continue;
        newItems.push({ path: f.name, file: f, status: "pending" });
      }
    }
    setQueue(prev => [...prev, ...newItems]);
  }

  async function processAll() {
    if (processing || !queue.length) return;
    setProcessing(true);

    for (let i = 0; i < queue.length; i++) {
      setQueue(prev => prev.map((x, idx) => idx === i ? { ...x, status: "processing" } : x));
      try {
        const fd = new FormData();
        fd.append("file", queue[i].file);
        fd.append("source_path", queue[i].path);
        const res = await fetch("/api/ingest/invoice", { method: "POST", body: fd });
        if (!res.ok) {
          const e = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          setQueue(prev => prev.map((x, idx) => idx === i ? { ...x, status: "error", error: e.error ?? "Error" } : x));
        } else {
          setQueue(prev => prev.map((x, idx) => idx === i ? { ...x, status: "ok" } : x));
        }
      } catch (e: any) {
        setQueue(prev => prev.map((x, idx) => idx === i ? { ...x, status: "error", error: e.message } : x));
      }
    }

    setProcessing(false);
    onDone();
  }

  function clearQueue() {
    if (processing) return;
    setQueue([]); setSourceLabel("");
  }

  const summary = useMemo(() => {
    const ok = queue.filter(q => q.status === "ok").length;
    const err = queue.filter(q => q.status === "error").length;
    const pend = queue.filter(q => q.status === "pending").length;
    const proc = queue.filter(q => q.status === "processing").length;
    return { ok, err, pend, proc, total: queue.length };
  }, [queue]);

  // Agrupar por carpeta (primer segmento del path) para mostrarlos ordenados
  const grouped = useMemo(() => {
    const map = new Map<string, QueueItem[]>();
    queue.forEach(q => {
      const parts = q.path.split("/");
      const key = parts.length > 1 ? parts.slice(0, -1).join("/") : "(raíz)";
      if (!map.has(key)) map.set(key, []);
      (map.get(key) as QueueItem[]).push(q);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [queue]);

  return (
    <div className={`drop p-6 ${drag ? "drag" : ""}`}
      onDragOver={(e) => { e.preventDefault(); if (!processing) setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (!processing) addFromDataTransfer(e.dataTransfer);
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-4 mb-3">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
             style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
          <Icon.Upload/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="sf-display text-[16px] font-semibold">Soltá facturas o CARPETAS completas</div>
          <div className="text-[12px] text-ink-2">
            PDF o imagen · Podés arrastrar una carpeta "2025/Enero/…" con todas las subcarpetas y las procesa todas juntas.
            {sourceLabel && <span className="ml-2 font-semibold text-ink-1">· {sourceLabel}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button className="btn btn-primary md:btn-ghost" onClick={() => cameraInputRef.current?.click()} disabled={processing}>
            <Icon.Camera/> <span className="hidden md:inline">Cámara</span><span className="md:hidden">Sacar foto</span>
          </button>
          <button className="btn btn-ghost" onClick={() => fileInputRef.current?.click()} disabled={processing}>
            <Icon.File/> Archivos
          </button>
          <button className="btn btn-ghost hidden md:inline-flex" onClick={() => folderInputRef.current?.click()} disabled={processing}>
            <Icon.Folder/> Carpeta
          </button>
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden
                 onChange={e => { addFromFileList(e.target.files, "📷 Foto"); e.target.value = ""; }} />
          <input ref={fileInputRef} type="file" accept="application/pdf,image/*" multiple hidden
                 onChange={e => { addFromFileList(e.target.files); e.target.value = ""; }} />
          <input ref={folderInputRef} type="file" multiple hidden
                 /* @ts-ignore */
                 webkitdirectory="" directory=""
                 onChange={e => {
                   const label = e.target.files?.[0]
                     ? `📁 ${((e.target.files[0] as any).webkitRelativePath || "").split("/")[0]}`
                     : "";
                   addFromFileList(e.target.files, label);
                   e.target.value = "";
                 }} />
        </div>
      </div>

      {queue.length === 0 ? (
        <div className="text-center py-6 text-[12px] text-ink-3 border-t border-line">
          Arrastrá acá. O tocá <b>Archivos</b> para seleccionar varios, o <b>Carpeta</b> para elegir una carpeta entera.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mt-2 mb-3 px-1">
            <div className="flex items-center gap-2 text-[12px]">
              <Badge tone="info">{summary.total} archivos</Badge>
              {summary.ok > 0  && <Badge tone="success">{summary.ok} OK</Badge>}
              {summary.err > 0 && <Badge tone="danger">{summary.err} error</Badge>}
              {summary.pend > 0 && <Badge tone="pendiente">{summary.pend} pendientes</Badge>}
              {summary.proc > 0 && <Badge tone="info">{summary.proc} procesando</Badge>}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-ghost" onClick={clearQueue} disabled={processing}>
                Limpiar
              </button>
              <button className="btn btn-primary" onClick={processAll} disabled={processing || summary.pend + summary.err === 0}>
                <Icon.Sparkles/> {processing ? "Procesando…" : `Procesar ${summary.pend + summary.err} facturas`}
              </button>
            </div>
          </div>

          <div className="max-h-[320px] overflow-y-auto scroll-clean space-y-3">
            {grouped.map(([folder, items]) => (
              <div key={folder}>
                <div className="text-[11px] uppercase tracking-wider text-ink-3 px-1 mb-1">
                  📁 {folder} <span className="text-ink-3">· {items.length}</span>
                </div>
                <div className="space-y-1">
                  {items.map((it, i) => (
                    <div key={it.path + i} className="flex items-center gap-2 p-2 rounded-lg border border-line bg-surface-2 text-[12px]">
                      <div className="w-6 h-6 rounded flex items-center justify-center bg-brand-soft text-brand shrink-0">
                        <Icon.File/>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-medium">{it.path.split("/").pop()}</div>
                        {it.status === "error" && <div className="truncate text-ink-3 text-[11px]">{it.error}</div>}
                      </div>
                      <StatusBadge status={it.status}/>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: QueueItem["status"] }) {
  if (status === "pending")    return <Badge tone="pendiente">En cola</Badge>;
  if (status === "processing") return <Badge tone="info">Procesando…</Badge>;
  if (status === "ok")         return <Badge tone="success"><Icon.Check/> OK</Badge>;
  return <Badge tone="danger">Error</Badge>;
}

// ============================================================================
// Dropzone para listados ARCA ("Mis Comprobantes Recibidos/Emitidos")
// ============================================================================
function ArcaListDropzone({ onDone }: { onDone: () => void }) {
  const [drag, setDrag] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ inserted: number; skipped: number; warnings: string[]; tipo_listado?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handle(files: FileList | File[] | null) {
    if (!files || !files.length) return;
    setErr(null); setResult(null); setProcessing(true);
    try {
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", f);
        const r = await fetch("/api/ingest/arca-list", { method: "POST", body: fd });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        setResult({
          inserted: d.inserted,
          skipped: d.skipped?.length ?? 0,
          warnings: d.warnings ?? [],
          tipo_listado: d.tipo_listado
        });
      }
      onDone();
    } catch (e: any) {
      setErr(e.message);
    } finally { setProcessing(false); }
  }

  return (
    <div className={`drop p-5 ${drag ? "drag" : ""}`}
         onDragOver={(e) => { e.preventDefault(); if (!processing) setDrag(true); }}
         onDragLeave={() => setDrag(false)}
         onDrop={(e) => { e.preventDefault(); setDrag(false); if (!processing) handle(e.dataTransfer.files); }}>
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
             style={{ background: "#efeaff", color: "#7c5cff" }}>
          <Icon.Sparkles/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="sf-display text-[15px] font-semibold">Listado ARCA — Mis Comprobantes (Recibidos / Emitidos)</div>
          <div className="text-[12px] text-ink-2">
            PDF con la tabla de comprobantes bajada desde ARCA. La IA crea UNA factura por cada fila del listado.
          </div>
          {result && (
            <div className="mt-1 flex items-center gap-2 text-[12px]">
              <Badge tone="success">{result.inserted} facturas agregadas</Badge>
              {result.skipped > 0 && <Badge tone="pendiente">{result.skipped} duplicadas (omitidas)</Badge>}
              {result.tipo_listado && <span className="text-ink-3">· {result.tipo_listado}</span>}
            </div>
          )}
          {err && <div className="text-[12px] text-danger mt-1">{err}</div>}
        </div>
        <button className="btn btn-ghost shrink-0" onClick={() => inputRef.current?.click()} disabled={processing}>
          <Icon.Upload/> {processing ? "Procesando…" : "Cargar listado"}
        </button>
        <input ref={inputRef} type="file" accept="application/pdf,image/*" hidden
               onChange={(e) => handle(e.target.files)}/>
      </div>
    </div>
  );
}

// ============================================================================
// Dropzone para Excel/CSV de ARCA — sin IA, procesado instantaneo
// ============================================================================
function ArcaCsvDropzone({ onDone }: { onDone: () => void }) {
  const [drag, setDrag] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ inserted: number; skipped: number; errors: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handle(files: FileList | File[] | null) {
    if (!files || !files.length) return;
    setErr(null); setResult(null); setProcessing(true);
    try {
      let totInserted = 0;
      let totSkipped = 0;
      let totErrors: string[] = [];
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", f);
        const r = await fetch("/api/ingest/arca-csv", { method: "POST", body: fd });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        totInserted += d.inserted ?? 0;
        totSkipped  += d.skipped?.length ?? 0;
        totErrors   = totErrors.concat(d.errors ?? []);
      }
      setResult({ inserted: totInserted, skipped: totSkipped, errors: totErrors });
      onDone();
    } catch (e: any) {
      setErr(e.message);
    } finally { setProcessing(false); }
  }

  return (
    <div className={`drop p-5 ${drag ? "drag" : ""}`}
         onDragOver={(e) => { e.preventDefault(); if (!processing) setDrag(true); }}
         onDragLeave={() => setDrag(false)}
         onDrop={(e) => { e.preventDefault(); setDrag(false); if (!processing) handle(e.dataTransfer.files); }}>
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
             style={{ background: "#e6f6ed", color: "#176a4a" }}>
          <Icon.File/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="sf-display text-[15px] font-semibold">Listado ARCA — Excel/CSV (sin IA, instantaneo)</div>
          <div className="text-[12px] text-ink-2">
            Excel o CSV de "Mis Comprobantes". Procesa cientos de facturas al instante. <b>Costo cero de IA.</b>
          </div>
          {result && (
            <div className="mt-1 flex items-center gap-2 text-[12px]">
              <Badge tone="success">{result.inserted} agregadas</Badge>
              {result.skipped > 0 && <Badge tone="pendiente">{result.skipped} duplicadas</Badge>}
              {result.errors.length > 0 && <Badge tone="warning">{result.errors.length} con error</Badge>}
            </div>
          )}
          {err && <div className="text-[12px] text-danger mt-1">{err}</div>}
        </div>
        <button className="btn btn-ghost shrink-0" onClick={() => inputRef.current?.click()} disabled={processing}>
          <Icon.Upload/> {processing ? "Procesando..." : "Cargar CSV/Excel"}
        </button>
        <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" multiple hidden
               onChange={(e) => handle(e.target.files)}/>
      </div>
    </div>
  );
}
