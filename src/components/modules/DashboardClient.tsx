"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/ui/Topbar";
import { Kpi } from "@/components/ui/Kpi";
import { Badge } from "@/components/ui/Badge";
import { AnnualChart } from "@/components/ui/AnnualChart";
import { Icon } from "@/components/ui/Icons";
import { MobileHero } from "@/components/ui/MobileHero";
import { money, periodoMesLabel } from "@/lib/format";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import type { Invoice, Company } from "@/lib/supabase/types";

type FileReview = {
  id: string;
  company_id: string;
  storage_path: string;
  reviewed_by: string;
  reviewed_at: string;
  note: string | null;
  status: "ok" | "con_observacion" | "con_error";
};
type Reviewer = { id: string; email: string | null; full_name: string | null };

type Props = {
  invoices: Invoice[];
  annual: { m: string; debito: number; credito: number }[];
  company: Company | null;
  fileReviews?: FileReview[];
  reviewers?: Reviewer[];
};

const MESES_ABREV = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
function ymKey(fecha: string) { return fecha?.slice(0, 7) ?? ""; }
function ymLabel(ym: string) {
  if (!ym) return "—";
  const [y, m] = ym.split("-");
  return `${MESES_ABREV[Number(m) - 1] ?? ""} ${y}`;
}

export function DashboardClient({ invoices: initial, annual, company, fileReviews: initialReviews = [], reviewers = [] }: Props) {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>(initial);
  const [fileReviews, setFileReviews] = useState<FileReview[]>(initialReviews);
  const [tab, setTab] = useState<"mensual"|"anual">("mensual");
  const [filter, setFilter] = useState<"todos"|"venta"|"compra">("todos");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<Invoice | null>(null);
  const [anio, setAnio] = useState<string>("__todos__");
  const [mes, setMes] = useState<string>("__todos__"); // "__todos__" | "YYYY-MM"
  const [showFilesModal, setShowFilesModal] = useState(false);

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
        <div className="card p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
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
          {tab === "mensual" && (
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-line" style={{ paddingTop: 10 }}>
              <button
                className="btn btn-ghost"
                onClick={() => setShowFilesModal(true)}
                title="Ver los archivos originales (PDF/Excel) que la IA analizó — útil para control manual del contador"
              >
                <Icon.Folder /> Archivos originales
                <span className="ml-1 chip" style={{ background:"var(--accent-soft)", color:"var(--accent)", fontSize:11, padding:"1px 8px" }}>
                  {new Set(filtered.map(i => i.storage_path).filter(Boolean)).size}
                </span>
              </button>
              {(() => {
                const sinArchivo = filtered.filter(i => !i.storage_path).length;
                if (!sinArchivo) return null;
                return (
                  <span className="chip" style={{ background:"#fcf0dd", color:"#b4730e", fontSize:11 }}>
                    {sinArchivo} sin archivo original
                  </span>
                );
              })()}
              <div className="text-[11px] text-ink-3">
                Auditoría contable · revisá y marcá los archivos que la IA procesó
              </div>
            </div>
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

      {showFilesModal && (
        <InvoiceFilesModal
          invoicesFiltered={filtered}
          invoicesAll={invoices}
          onClose={() => setShowFilesModal(false)}
          contextLabel={`${anioActivoLabel} · ${mesActivoLabel}${filter !== "todos" ? ` · ${filter === "venta" ? "Ventas" : "Compras"}` : ""}`}
          currentYear={anio === "__todos__" ? null : anio}
          currentMonth={mesEfectivo === "__todos__" ? null : mesEfectivo.split("-")[1]}
          currentTipo={filter}
          reviews={fileReviews}
          reviewers={reviewers}
          onReviewChange={(path, review) => {
            setFileReviews(prev => {
              const filtered = prev.filter(r => r.storage_path !== path);
              return review ? [...filtered, review] : filtered;
            });
          }}
          onOpenInvoice={(inv) => { setDetail(inv); setShowFilesModal(false); }}
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
      const num = parseNumEs;
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
                    const tc = parseNumEs(form.tipo_cambio);
                    if (tc <= 0) { alert("Poné un tipo de cambio mayor a 0"); return; }
                    // Preview de los cálculos para verificar antes de aplicar
                    const previewNeto  = parseNumEs(form.neto_gravado) * tc;
                    const previewTotal = parseNumEs(form.total) * tc;
                    const conf = confirm(
                      `Recalcular importes multiplicando por TC ${tc.toLocaleString("es-AR")}?\n\n` +
                      `Ejemplo con tus valores:\n` +
                      `  Neto Gravado: ${parseNumEs(form.neto_gravado).toLocaleString("es-AR")} ${form.moneda}\n` +
                      `                → ${previewNeto.toLocaleString("es-AR", {maximumFractionDigits: 2})} ARS\n\n` +
                      `  Total: ${parseNumEs(form.total).toLocaleString("es-AR")} ${form.moneda}\n` +
                      `        → ${previewTotal.toLocaleString("es-AR", {maximumFractionDigits: 2})} ARS`
                    );
                    if (!conf) return;
                    // Usamos toFixed(2) para forzar 2 decimales, formato numeric (punto como decimal para JS)
                    const mul = (v: string) => (parseNumEs(v) * tc).toFixed(2);
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
                    setMsg(`✓ Importes multiplicados por TC ${tc.toLocaleString("es-AR")}. Hacé click en "Guardar cambios" para confirmar.`);
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
/**
 * Parser robusto que acepta números en formato argentino/inglés:
 *   "1.234,50"   → 1234.50   (formato ES con puntos de miles y coma decimal)
 *   "1234,50"    → 1234.50   (solo coma decimal ES)
 *   "1,234.50"   → 1234.50   (formato EN con comas de miles y punto decimal)
 *   "1234.50"    → 1234.50   (formato EN simple)
 *   "1000"       → 1000
 *   "1.234.567"  → 1234567   (solo puntos, se interpretan como miles)
 */
function parseNumEs(v: string): number {
  if (!v) return 0;
  let s = String(v).trim();
  if (!s) return 0;
  // Sacar símbolos de moneda y espacios
  s = s.replace(/[$\s€]/g, "");
  const hasComma = s.includes(",");
  const hasDot   = s.includes(".");
  if (hasComma && hasDot) {
    // Ambos → el ÚLTIMO es el decimal, el otro es separador de miles
    const lastComma = s.lastIndexOf(",");
    const lastDot   = s.lastIndexOf(".");
    if (lastComma > lastDot) {
      // Coma es decimal (formato ES: 1.234,50)
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // Punto es decimal (formato EN: 1,234.50)
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    // Solo coma → asumo decimal español
    s = s.replace(",", ".");
  } else if (hasDot) {
    // Solo puntos: si hay más de uno, son miles. Si hay uno solo y viene con 3+ dígitos, es miles.
    const dots = (s.match(/\./g) ?? []).length;
    if (dots > 1) {
      s = s.replace(/\./g, "");
    }
    // Si es solo uno, dejamos como decimal (ej "1234.50")
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
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

// ============================================================================
// Modal: Base de datos de archivos originales (para control manual del contador)
// ============================================================================

type FileGroup = {
  storage_path: string;
  facturas: Invoice[];
  tipo: "individual" | "listado_arca" | "csv_arca" | "otro";
  extension: string;
  filename: string;
  fecha_carga: string | null;
  fecha_primera_factura: string | null;
  fecha_ultima_factura: string | null;
  total_ars: number;
  ai_confidence_min: number;
  status_worst: "revision" | "aprobada" | "otro";
};

function detectFileTipo(path: string): FileGroup["tipo"] {
  const p = path.toLowerCase();
  if (p.includes("arca-list")) return "listado_arca";
  if (p.includes("arca-csv") || p.endsWith(".csv") || p.endsWith(".xlsx") || p.endsWith(".xls")) return "csv_arca";
  if (p.endsWith(".pdf") || p.endsWith(".jpg") || p.endsWith(".jpeg") || p.endsWith(".png")) return "individual";
  return "otro";
}

function isPreviewable(path: string): "pdf" | "image" | "excel" | "csv" | "otro" {
  const p = path.toLowerCase();
  if (p.endsWith(".pdf")) return "pdf";
  if (p.endsWith(".png") || p.endsWith(".jpg") || p.endsWith(".jpeg") || p.endsWith(".webp")) return "image";
  if (p.endsWith(".xlsx") || p.endsWith(".xls")) return "excel";
  if (p.endsWith(".csv")) return "csv";
  return "otro";
}

function InvoiceFilesModal({
  invoicesFiltered, invoicesAll, onClose, contextLabel,
  currentYear, currentMonth, currentTipo,
  reviews, reviewers, onReviewChange, onOpenInvoice
}: {
  invoicesFiltered: Invoice[];
  invoicesAll: Invoice[];
  onClose: () => void;
  contextLabel: string;
  currentYear: string | null;
  currentMonth: string | null;
  currentTipo: "todos" | "venta" | "compra";
  reviews: FileReview[];
  reviewers: Reviewer[];
  onReviewChange: (path: string, review: FileReview | null) => void;
  onOpenInvoice: (inv: Invoice) => void;
}) {
  const [scope, setScope] = useState<"periodo" | "todos">("periodo");
  const [q, setQ] = useState("");
  const [tipoFiltro, setTipoFiltro] = useState<"todos" | FileGroup["tipo"]>("todos");
  const [estadoFiltro, setEstadoFiltro] = useState<"todos" | "sin_revisar" | "ok" | "observaciones">("todos");
  const [orderBy, setOrderBy] = useState<"fecha" | "facturas" | "total" | "confianza">("fecha");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ path: string; url: string; kind: string; filename: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewEditing, setReviewEditing] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [backfillPreview, setBackfillPreview] = useState<null | {
    archivos: number;
    facturas: number;
    ejemplos: { after: string; facturas: number }[];
  }>(null);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillDone, setBackfillDone] = useState<null | { archivos: number; facturas: number }>(null);

  // Cerrar con ESC
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

  // Bloquear scroll del body mientras el modal está abierto (evita scroll chaining)
  useLockBodyScroll();

  const reviewByPath = useMemo(() => {
    const m = new Map<string, FileReview>();
    for (const r of reviews) m.set(r.storage_path, r);
    return m;
  }, [reviews]);

  const reviewerById = useMemo(() => {
    const m = new Map<string, Reviewer>();
    for (const u of reviewers) m.set(u.id, u);
    return m;
  }, [reviewers]);

  const source = scope === "periodo" ? invoicesFiltered : invoicesAll;
  const facturasSinArchivo = source.filter(i => !i.storage_path);

  // Agrupar por storage_path
  const groups = useMemo<FileGroup[]>(() => {
    const map = new Map<string, Invoice[]>();
    for (const inv of source) {
      if (!inv.storage_path) continue;
      if (!map.has(inv.storage_path)) map.set(inv.storage_path, []);
      map.get(inv.storage_path)!.push(inv);
    }
    const out: FileGroup[] = [];
    for (const [path, facts] of map.entries()) {
      const ext = (path.split(".").pop() || "").toLowerCase();
      const filename = (facts[0].original_filename as any) || path.split("/").pop() || path;
      const tipo = detectFileTipo(path);
      const fechas = facts.map(f => f.fecha).filter(Boolean).sort();
      const total = facts.reduce((a, b) => a + Number(b.total ?? 0), 0);
      const cargas = facts.map(f => (f as any).created_at).filter(Boolean).sort();
      const confMin = facts.reduce((a, b) => Math.min(a, Number(b.ai_confidence ?? 1)), 1);
      const anyRevision = facts.some(f => f.status === "revision");
      out.push({
        storage_path: path,
        facturas: facts,
        tipo,
        extension: ext,
        filename,
        fecha_carga: cargas[0] ?? null,
        fecha_primera_factura: fechas[0] ?? null,
        fecha_ultima_factura: fechas[fechas.length - 1] ?? null,
        total_ars: total,
        ai_confidence_min: confMin,
        status_worst: anyRevision ? "revision" : "aprobada"
      });
    }
    return out;
  }, [source]);

  const filteredGroups = useMemo(() => {
    const norm = (s: string) => s.toLowerCase();
    const rows = groups.filter(g => {
      if (tipoFiltro !== "todos" && g.tipo !== tipoFiltro) return false;
      if (estadoFiltro !== "todos") {
        const rev = reviewByPath.get(g.storage_path);
        if (estadoFiltro === "sin_revisar" && rev) return false;
        if (estadoFiltro === "ok" && (!rev || rev.status !== "ok")) return false;
        if (estadoFiltro === "observaciones" && (!rev || rev.status === "ok")) return false;
      }
      if (q) {
        const s = norm(q);
        const razonHit = g.facturas.some(f => norm(f.razon_social ?? "").includes(s));
        const cuitHit  = g.facturas.some(f => norm(f.cuit ?? "").includes(s));
        const compHit  = g.facturas.some(f => norm(f.comprobante ?? "").includes(s));
        if (!(norm(g.filename).includes(s) || razonHit || cuitHit || compHit)) return false;
      }
      return true;
    });
    // Ordenar
    rows.sort((a, b) => {
      switch (orderBy) {
        case "fecha":     return (b.fecha_ultima_factura ?? "").localeCompare(a.fecha_ultima_factura ?? "");
        case "facturas":  return b.facturas.length - a.facturas.length;
        case "total":     return b.total_ars - a.total_ars;
        case "confianza": return a.ai_confidence_min - b.ai_confidence_min;
      }
    });
    return rows;
  }, [groups, q, tipoFiltro, estadoFiltro, orderBy, reviewByPath]);

  const counts = useMemo(() => ({
    todos: groups.length,
    individual: groups.filter(g => g.tipo === "individual").length,
    listado_arca: groups.filter(g => g.tipo === "listado_arca").length,
    csv_arca: groups.filter(g => g.tipo === "csv_arca").length,
    otro: groups.filter(g => g.tipo === "otro").length,
    sin_revisar: groups.filter(g => !reviewByPath.get(g.storage_path)).length,
    revisados_ok: groups.filter(g => reviewByPath.get(g.storage_path)?.status === "ok").length,
    con_obs: groups.filter(g => {
      const r = reviewByPath.get(g.storage_path);
      return r && r.status !== "ok";
    }).length
  }), [groups, reviewByPath]);

  const totalFacturas = filteredGroups.reduce((a, g) => a + g.facturas.length, 0);
  const totalAmount = filteredGroups.reduce((a, g) => a + g.total_ars, 0);

  async function openPreview(g: FileGroup, download = false) {
    setLoadingId(g.storage_path); setErr(null);
    try {
      const url = `/api/invoice/file?path=${encodeURIComponent(g.storage_path)}${download ? "&download=1" : ""}`;
      const r = await fetch(url);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      if (download) {
        // Descarga directa: abrimos la signed URL con Content-Disposition:attachment
        window.location.href = d.url;
      } else {
        const kind = isPreviewable(g.storage_path);
        if (kind === "pdf" || kind === "image") {
          setPreview({ path: g.storage_path, url: d.url, kind, filename: g.filename });
        } else {
          // Excel/CSV: no se puede embeber → abrir en nueva pestaña
          window.open(d.url, "_blank");
        }
      }
    } catch (e: any) {
      setErr("No se pudo abrir el archivo: " + e.message);
    } finally { setLoadingId(null); }
  }

  async function saveReview(path: string, status: FileReview["status"], note: string) {
    setErr(null);
    try {
      const r = await fetch("/api/file-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storage_path: path, status, note })
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
      const r = await fetch(`/api/file-review?storage_path=${encodeURIComponent(path)}`, { method: "DELETE" });
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
    const params = new URLSearchParams();
    if (scope === "periodo") {
      if (currentYear) params.set("year", currentYear);
      if (currentMonth) params.set("month", currentMonth);
      if (currentTipo !== "todos") params.set("tipo", currentTipo);
    }
    window.location.href = `/api/invoice-files/export?${params.toString()}`;
  }

  async function downloadZip() {
    const paths = selected.size ? Array.from(selected) : filteredGroups.map(g => g.storage_path);
    if (!paths.length) return;
    if (paths.length > 200) {
      setErr("El ZIP soporta hasta 200 archivos. Ajustá los filtros o seleccioná menos.");
      return;
    }
    setDownloadingZip(true); setErr(null);
    try {
      const r = await fetch("/api/invoice-files/zip", {
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
      a.download = `archivos-originales-${new Date().toISOString().slice(0, 10)}.zip`;
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
      const r = await fetch("/api/invoice-files/backfill-names", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun: true })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setBackfillPreview({
        archivos: d.would_update_archivos ?? 0,
        facturas: d.would_update_facturas ?? 0,
        ejemplos: (d.previews ?? []).slice(0, 8).map((p: any) => ({ after: p.after, facturas: p.facturas }))
      });
    } catch (e: any) {
      setErr("No se pudo calcular la vista previa: " + e.message);
    }
  }

  async function backfillApply() {
    setBackfillRunning(true); setErr(null);
    try {
      const r = await fetch("/api/invoice-files/backfill-names", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setBackfillDone({
        archivos: d.archivos_procesados ?? 0,
        facturas: d.facturas_actualizadas ?? 0
      });
      setBackfillPreview(null);
      // Refrescar página para que los nuevos nombres aparezcan en las filas
      setTimeout(() => window.location.reload(), 1200);
    } catch (e: any) {
      setErr("No se pudo aplicar el backfill: " + e.message);
    } finally { setBackfillRunning(false); }
  }

  // Detectar cuántos archivos históricos no tienen nombre (para mostrar el CTA)
  const archivosSinNombre = useMemo(() => {
    const sinNombre = new Set<string>();
    for (const g of groups) {
      const hasName = g.facturas.some(f => (f.original_filename ?? "").trim().length > 0);
      if (!hasName) sinNombre.add(g.storage_path);
    }
    return sinNombre.size;
  }, [groups]);

  const tipoLabel: Record<FileGroup["tipo"], string> = {
    individual:    "Individual",
    listado_arca:  "Listado ARCA",
    csv_arca:      "Excel/CSV",
    otro:          "Otro"
  };

  const tipoBadgeTone: Record<FileGroup["tipo"], any> = {
    individual:   "info",
    listado_arca: "impuesto",
    csv_arca:     "success",
    otro:         "default"
  };

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
            <div className="text-[12px] uppercase tracking-wider text-ink-3">Base de datos de archivos originales</div>
            <div className="sf-display text-[20px] font-semibold mt-1">Auditoría contable de archivos</div>
            <div className="text-[12px] text-ink-3 mt-1 max-w-2xl">
              Cada archivo (PDF, Excel o CSV) que la IA procesó. Revisá, marcá como controlado, dejá notas y exportá el papel de trabajo.
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

        {/* Filtros fila 1: ámbito + tipo + búsqueda */}
        <div className="px-6 py-3 border-b border-line flex flex-wrap items-center gap-3">
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: "#ececf0" }}>
            <div className={`tab ${scope==="periodo"?"active":""}`} onClick={()=>setScope("periodo")}>
              {contextLabel}
            </div>
            <div className={`tab ${scope==="todos"?"active":""}`} onClick={()=>setScope("todos")}>
              Todos los períodos
            </div>
          </div>

          <div className="flex gap-1 p-1 rounded-xl" style={{ background: "#ececf0" }}>
            {[
              { k: "todos", t: "Todos", c: counts.todos },
              { k: "individual", t: "Individuales", c: counts.individual },
              { k: "listado_arca", t: "Listados", c: counts.listado_arca },
              { k: "csv_arca", t: "Excel/CSV", c: counts.csv_arca }
            ].map(o => (
              <div key={o.k}
                   className={`tab ${tipoFiltro===o.k?"active":""}`}
                   onClick={()=>setTipoFiltro(o.k as any)}>
                {o.t}<span className="ml-1 text-[10px] text-ink-3">· {o.c}</span>
              </div>
            ))}
          </div>

          <div className="flex-1 min-w-[240px] relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"><Icon.Search /></div>
            <input className="input pl-9" placeholder="Buscar por archivo, razón social, CUIT o comprobante…"
                   value={q} onChange={e=>setQ(e.target.value)} />
          </div>
        </div>

        {/* Filtros fila 2: estado revisión + orden */}
        <div className="px-6 py-3 border-b border-line flex flex-wrap items-center gap-3" style={{ background: "#fafafa" }}>
          <div className="text-[11px] uppercase tracking-wider text-ink-3">Estado</div>
          <div className="flex gap-1 p-1 rounded-xl bg-white">
            {[
              { k: "todos", t: "Todos", c: counts.todos },
              { k: "sin_revisar", t: "Sin revisar", c: counts.sin_revisar },
              { k: "ok", t: "OK", c: counts.revisados_ok },
              { k: "observaciones", t: "Con observaciones", c: counts.con_obs }
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
              <option value="facturas">Cantidad de facturas</option>
              <option value="total">Total ARS</option>
              <option value="confianza">Confianza IA (menor primero)</option>
            </select>
          </div>
        </div>

        {err && (
          <div className="mx-6 mt-3 p-2.5 rounded-lg bg-[#fdeaef] text-[#9c2944] text-[12px]">{err}</div>
        )}

        {/* Banner de backfill: aparece si hay archivos sin nombre humano */}
        {archivosSinNombre > 0 && !backfillDone && (
          <div className="mx-6 mt-3 rounded-xl p-3 flex items-center gap-3"
               style={{ background: "#fcf0dd", border: "1px solid #f0d69a" }}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                 style={{ background:"#fff", color:"#b4730e" }}>
              <Icon.Warning/>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium" style={{ color:"#8a5709" }}>
                {archivosSinNombre} archivo{archivosSinNombre === 1 ? "" : "s"} sin nombre humano
              </div>
              <div className="text-[11px]" style={{ color:"#b4730e" }}>
                Los archivos que cargaste antes de esta actualización aparecen con un UUID.
                Puedo asignarles nombres útiles como "Listado ARCA Emitidos - Mar 2026.pdf".
              </div>
            </div>
            {!backfillPreview ? (
              <button className="btn btn-primary" onClick={backfillPreviewFetch}>
                Vista previa
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button className="btn btn-ghost" onClick={() => setBackfillPreview(null)} disabled={backfillRunning}>
                  Cancelar
                </button>
                <button className="btn btn-primary" onClick={backfillApply} disabled={backfillRunning}>
                  {backfillRunning ? "Aplicando…" : `Renombrar ${backfillPreview.archivos} archivo${backfillPreview.archivos === 1 ? "" : "s"}`}
                </button>
              </div>
            )}
          </div>
        )}
        {backfillPreview && backfillPreview.ejemplos.length > 0 && (
          <div className="mx-6 mt-2 rounded-xl p-3" style={{ background:"#fafafa", border:"1px solid var(--line)" }}>
            <div className="text-[11px] uppercase tracking-wider text-ink-3 mb-2">
              Vista previa — {backfillPreview.archivos} archivo(s) · {backfillPreview.facturas} factura(s) recibirán:
            </div>
            <div className="space-y-1">
              {backfillPreview.ejemplos.map((e, i) => (
                <div key={i} className="text-[12px] flex items-center gap-2">
                  <span className="chip" style={{ background:"var(--accent-soft)", color:"var(--accent)", fontSize:10 }}>
                    {e.facturas} fact.
                  </span>
                  <span className="font-mono">{e.after}</span>
                </div>
              ))}
              {backfillPreview.archivos > backfillPreview.ejemplos.length && (
                <div className="text-[11px] text-ink-3 mt-1">
                  … y {backfillPreview.archivos - backfillPreview.ejemplos.length} archivo(s) más.
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
              Listo — se renombraron {backfillDone.archivos} archivo(s) ({backfillDone.facturas} factura(s) actualizadas).
              Recargando la vista…
            </div>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-4 gap-3 px-6 py-4 border-b border-line" style={{ background: "#fafafa" }}>
          <KpiSmall label="Archivos" value={filteredGroups.length} />
          <KpiSmall label="Facturas contenidas" value={totalFacturas} />
          <KpiSmall label="Total ARS" value={money(totalAmount)} />
          <KpiSmall
            label="Sin archivo original"
            value={facturasSinArchivo.length}
            tone={facturasSinArchivo.length ? "warn" : "muted"}
            hint="Facturas cargadas a mano que no tienen PDF/Excel adjunto"
          />
        </div>

        {/* Lista de archivos */}
        <div className="flex-1 overflow-y-auto scroll-clean" style={{ overscrollBehavior: "contain" }}>
          {filteredGroups.length === 0 ? (
            <div className="p-16 text-center text-ink-3">
              <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center bg-brand-soft text-brand mb-3">
                <Icon.Folder/>
              </div>
              <div className="sf-display text-[15px] font-semibold text-ink-1">No hay archivos con estos filtros</div>
              <div className="text-[12px] mt-1">Cambiá el filtro o el ámbito para ver más resultados.</div>
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
                  <th>Archivo</th>
                  <th>Tipo</th>
                  <th>Período</th>
                  <th className="text-right">Facturas</th>
                  <th className="text-right">Total ARS</th>
                  <th>Estado</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredGroups.map(g => {
                  const review = reviewByPath.get(g.storage_path);
                  const isExpanded = expanded === g.storage_path;
                  const isSelected = selected.has(g.storage_path);
                  const lowConfidence = g.ai_confidence_min < 0.85;

                  return (
                    <React.Fragment key={g.storage_path}>
                      <tr style={isSelected ? { background: "var(--accent-soft)" } : undefined}>
                        <td>
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(g.storage_path)}/>
                        </td>
                        <td>
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                                 style={{
                                   background:
                                     g.tipo === "csv_arca" ? "#e6f6ed" :
                                     g.tipo === "listado_arca" ? "#efeaff" : "var(--accent-soft)",
                                   color:
                                     g.tipo === "csv_arca" ? "#30a46c" :
                                     g.tipo === "listado_arca" ? "#7c5cff" : "var(--accent)"
                                 }}>
                              <Icon.File/>
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium truncate" style={{ maxWidth: 320 }} title={g.filename}>
                                {g.filename}
                              </div>
                              <div className="text-[11px] text-ink-3 flex items-center gap-2">
                                {g.fecha_carga && <span>Cargado {String(g.fecha_carga).slice(0, 10)}</span>}
                                {lowConfidence && (
                                  <span className="chip" style={{ background:"#fcf0dd", color:"#b4730e", fontSize:10, padding:"1px 6px" }}>
                                    Confianza IA {(g.ai_confidence_min * 100).toFixed(0)}%
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <Badge tone={tipoBadgeTone[g.tipo]}>{tipoLabel[g.tipo]}</Badge>
                        </td>
                        <td className="text-ink-2 text-[12px]">
                          {g.fecha_primera_factura === g.fecha_ultima_factura
                            ? g.fecha_primera_factura ?? "—"
                            : `${g.fecha_primera_factura ?? "?"} → ${g.fecha_ultima_factura ?? "?"}`}
                        </td>
                        <td className="text-right">
                          <button
                            className="chip"
                            style={{ background:"var(--accent-soft)", color:"var(--accent)", cursor:"pointer", border:"none" }}
                            onClick={() => setExpanded(isExpanded ? null : g.storage_path)}
                            title={isExpanded ? "Contraer" : "Ver facturas"}>
                            {g.facturas.length} {isExpanded ? "▲" : "▼"}
                          </button>
                        </td>
                        <td className="text-right font-semibold">{money(g.total_ars)}</td>
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
                            <button
                              className="btn btn-ghost"
                              style={{ padding:"6px 10px", fontSize: 12 }}
                              onClick={() => openPreview(g)}
                              disabled={loadingId === g.storage_path}
                              title="Ver archivo"
                            >
                              {loadingId === g.storage_path ? "…" : "Ver"}
                            </button>
                            <button
                              className="btn btn-ghost"
                              style={{ padding:"6px 10px", fontSize: 12 }}
                              onClick={() => openPreview(g, true)}
                              title="Descargar original"
                            >
                              <Icon.Download/>
                            </button>
                            <button
                              className="btn btn-primary"
                              style={{ padding:"6px 10px", fontSize: 12 }}
                              onClick={() => setReviewEditing(g.storage_path)}
                              title="Marcar como revisado / dejar nota"
                            >
                              {review ? "Editar revisión" : "Revisar"}
                            </button>
                            {review && (
                              <button
                                className="btn btn-ghost"
                                style={{ padding:"6px 8px", fontSize: 12, color:"#f04f6f" }}
                                onClick={() => unreview(g.storage_path)}
                                title="Quitar marca de revisado"
                              >
                                <Icon.Close/>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Fila expandible: nota + lista de facturas */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={8} style={{ background: "#fafafa", padding: 0 }}>
                            <div className="p-4 space-y-3">
                              {review?.note && (
                                <div className="rounded-xl p-3" style={{ background: "#fff", border: "1px solid var(--line)" }}>
                                  <div className="text-[11px] uppercase tracking-wider text-ink-3 mb-1">
                                    Nota del contador — {reviewerName(review.reviewed_by)}
                                  </div>
                                  <div className="text-[13px] text-ink-1 whitespace-pre-wrap">{review.note}</div>
                                </div>
                              )}
                              <div className="text-[11px] uppercase tracking-wider text-ink-3">
                                Facturas contenidas en este archivo ({g.facturas.length})
                              </div>
                              <div className="rounded-xl overflow-hidden" style={{ background: "#fff", border: "1px solid var(--line)" }}>
                                <table className="clean">
                                  <thead>
                                    <tr>
                                      <th style={{ background: "#fff" }}>Fecha</th>
                                      <th style={{ background: "#fff" }}>Comprobante</th>
                                      <th style={{ background: "#fff" }}>Razón social</th>
                                      <th style={{ background: "#fff" }}>CUIT</th>
                                      <th style={{ background: "#fff" }}>Tipo</th>
                                      <th style={{ background: "#fff" }} className="text-right">Total</th>
                                      <th style={{ background: "#fff" }}></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {g.facturas
                                      .slice()
                                      .sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? ""))
                                      .map(f => (
                                        <tr key={f.id}>
                                          <td className="text-ink-2">{f.fecha}</td>
                                          <td className="text-ink-2 font-mono text-[12px]">{f.comprobante ?? "—"}</td>
                                          <td className="font-medium truncate" style={{ maxWidth: 240 }}>{f.razon_social}</td>
                                          <td className="text-ink-2 font-mono text-[12px]">{f.cuit ?? "—"}</td>
                                          <td>
                                            <Badge tone={f.tipo === "venta" ? "venta" : "compra"}>
                                              {f.tipo === "venta" ? "Venta" : "Compra"}
                                            </Badge>
                                          </td>
                                          <td className="text-right font-semibold">{money(Number(f.total ?? 0))}</td>
                                          <td className="text-right">
                                            <button className="btn btn-ghost"
                                                    style={{ padding:"4px 8px", fontSize: 11 }}
                                                    onClick={() => onOpenInvoice(f)}>
                                              Abrir
                                            </button>
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
      </div>

      {/* Panel de preview embebido */}
      {preview && (
        <>
          <div className="modal-back" style={{ zIndex: 80 }} onClick={() => setPreview(null)}/>
          <div className="fixed inset-4 md:inset-16 card soft fade-in overflow-hidden flex flex-col" style={{ zIndex: 90 }}>
            <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-ink-3">Vista previa</div>
                <div className="sf-display text-[15px] font-semibold truncate">{preview.filename}</div>
              </div>
              <div className="flex items-center gap-2">
                <a className="btn btn-ghost" href={preview.url} target="_blank" rel="noreferrer">
                  <Icon.Link/> Abrir en pestaña
                </a>
                <button className="btn btn-ghost" style={{padding:"6px 10px"}} onClick={() => setPreview(null)}>
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
                  Este formato no se puede previsualizar en el navegador.
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Modal de revisión */}
      {reviewEditing && (
        <ReviewEditor
          path={reviewEditing}
          current={reviewByPath.get(reviewEditing) ?? null}
          filename={groups.find(g => g.storage_path === reviewEditing)?.filename ?? "Archivo"}
          onClose={() => setReviewEditing(null)}
          onSave={saveReview}
        />
      )}
    </>
  );
}

function KpiSmall({ label, value, hint, tone = "default" }: {
  label: string; value: string | number; hint?: string; tone?: "default" | "warn" | "muted";
}) {
  const color = tone === "warn" ? "#b4730e" : tone === "muted" ? "#6e6e73" : undefined;
  return (
    <div className="rounded-xl p-3 bg-white">
      <div className="text-[11px] uppercase tracking-wider text-ink-3">{label}</div>
      <div className="sf-display text-[22px] font-semibold mt-1" style={color ? { color } : undefined}>{value}</div>
      {hint && <div className="text-[10px] text-ink-3 mt-1">{hint}</div>}
    </div>
  );
}

function ReviewEditor({
  path, current, filename, onClose, onSave
}: {
  path: string;
  current: FileReview | null;
  filename: string;
  onClose: () => void;
  onSave: (path: string, status: FileReview["status"], note: string) => Promise<void>;
}) {
  const [status, setStatus] = useState<FileReview["status"]>(current?.status ?? "ok");
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
                { k: "ok",              label: "Revisado — todo OK",           desc: "Los datos coinciden con el archivo original",             tone: "#30a46c", bg: "#e6f6ed" },
                { k: "con_observacion", label: "Con observaciones",            desc: "Requiere aclaración o hay diferencias menores",           tone: "#b4730e", bg: "#fcf0dd" },
                { k: "con_error",       label: "Con error — necesita corregir", desc: "Hay diferencias que hay que corregir en el libro",       tone: "#c02648", bg: "#fdeaef" }
              ].map(o => (
                <label key={o.k}
                       className="flex items-start gap-3 p-3 rounded-xl cursor-pointer"
                       style={{
                         border: `1.5px solid ${status === o.k ? o.tone : "var(--line)"}`,
                         background: status === o.k ? o.bg : "#fff"
                       }}>
                  <input type="radio" name="status" checked={status === o.k}
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
                      placeholder="Ej: Falta incluir la nota de crédito 0001-00042. Confirmé el CAE con AFIP."
                      value={note} onChange={e => setNote(e.target.value)}/>
          </div>

          {current && (
            <div className="text-[11px] text-ink-3">
              Revisado por última vez el {current.reviewed_at.slice(0, 10)}.
              Al guardar quedás vos como último revisor.
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" onClick={submit} disabled={saving}>
              {saving ? "Guardando…" : (current ? "Actualizar revisión" : "Marcar como revisado")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
