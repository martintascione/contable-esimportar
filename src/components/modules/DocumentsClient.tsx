"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/ui/Topbar";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icons";
import { Kpi } from "@/components/ui/Kpi";
import { daysUntil } from "@/lib/format";
import { CATEGORIES, GRUPO_LABEL, GRUPO_SUBTITLE, categoryByKey } from "@/lib/docCategories";
import { createClient } from "@/lib/supabase/client";
import type { CompanyDocument, DocCategory } from "@/lib/supabase/types";

export function DocumentsClient({ docs: initial, canEdit, hasCompany = true }: { docs: CompanyDocument[]; canEdit: boolean; hasCompany?: boolean }) {
  const router = useRouter();
  const [docs, setDocs] = useState<CompanyDocument[]>(initial);
  const [grupo, setGrupo] = useState<"todos" | keyof typeof GRUPO_LABEL>("todos");
  const [q, setQ] = useState("");
  const [openUpload, setOpenUpload] = useState(false);
  const [editing, setEditing] = useState<CompanyDocument | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

  const stats = useMemo(() => {
    const total = docs.length;
    const vencidos = docs.filter(d => d.fecha_vencimiento && new Date(d.fecha_vencimiento) < new Date()).length;
    const porVencer = docs.filter(d => {
      const dd = daysUntil(d.fecha_vencimiento);
      return dd !== null && dd >= 0 && dd <= 30;
    }).length;
    return { total, vencidos, porVencer };
  }, [docs]);

  const filtered = docs.filter(d => {
    if (grupo !== "todos" && categoryByKey(d.categoria).grupo !== grupo) return false;
    if (q) {
      const s = q.toLowerCase();
      if (!(d.nombre + (d.descripcion ?? "") + (d.numero ?? "") + (d.organismo ?? "")).toLowerCase().includes(s)) return false;
    }
    return true;
  });

  // Agrupar por tipo (con orden: contable primero por importancia)
  const GRUPO_ORDER = ["contable", "fiscal", "societario", "personal", "operativo", "otro"];
  const grouped = useMemo(() => {
    const m = new Map<string, CompanyDocument[]>();
    filtered.forEach(d => {
      const g = categoryByKey(d.categoria).grupo;
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(d);
    });
    // Reordenar entries según GRUPO_ORDER
    const ordered = new Map<string, CompanyDocument[]>();
    for (const k of GRUPO_ORDER) {
      if (m.has(k)) ordered.set(k, m.get(k)!);
    }
    // Si hubiera algún grupo no listado, lo agregamos al final
    for (const [k, v] of m.entries()) {
      if (!ordered.has(k)) ordered.set(k, v);
    }
    return ordered;
  }, [filtered]);

  async function remove(id: string) {
    if (!confirm("¿Eliminar este documento?")) return;
    const supabase = createClient();
    const doc = docs.find(d => d.id === id);
    if (doc?.storage_path) {
      await supabase.storage.from("company-documents").remove([doc.storage_path]);
    }
    await supabase.from("company_documents").delete().eq("id", id);
    setDocs(prev => prev.filter(d => d.id !== id));
  }

  async function openFile(doc: CompanyDocument) {
    if (!doc.storage_path) return;
    const supabase = createClient();
    const { data } = await supabase.storage.from("company-documents").createSignedUrl(doc.storage_path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  return (
    <>
      <Topbar
        title="Documentación de la empresa"
        subtitle="La IA clasifica y archiva tus documentos automáticamente."
        right={canEdit && hasCompany && (
          <>
            <CleanupMenu onCleaned={(removed) => {
              setDocs(prev => {
                const ids = new Set(removed);
                return prev.filter(d => !ids.has(d.id));
              });
              router.refresh();
            }} />
            <button className="btn btn-ghost" onClick={() => setOpenUpload(true)}>
              <Icon.Plus/> Carga manual
            </button>
          </>
        )}
      />
      <div className="p-8 space-y-6">
        {!hasCompany && (
          <div className="card p-6 border-l-4" style={{ borderLeftColor: "var(--accent)" }}>
            <div className="sf-display text-[16px] font-semibold mb-1">Primero creá tu empresa</div>
            <div className="text-[13px] text-ink-2 mb-3">
              Los documentos se archivan bajo una empresa. Andá a <a className="link" href="/settings">Configuración</a> para crearla en un minuto.
            </div>
            <a className="btn btn-primary" href="/settings"><Icon.Cog/> Ir a Configuración</a>
          </div>
        )}

        {/* Zona IA — arrastrá varios documentos y la IA los clasifica y archiva */}
        {canEdit && hasCompany && (
          <AiBulkDropzone onDone={(newDocs) => { setDocs(prev => [...newDocs, ...prev]); router.refresh(); }} />
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
          <Kpi label="Documentos totales" value={String(stats.total)} hint="Archivados en el vault" />
          <Kpi label="Por vencer (30 días)" value={String(stats.porVencer)} hint="Requieren renovación pronto" />
          <Kpi label="Vencidos" value={String(stats.vencidos)} hint="Urgente actualizar" />
          <Kpi label="Grupos" value={String(new Set(docs.map(d => categoryByKey(d.categoria).grupo)).size)} hint="Categorías activas" />
        </div>

        {/* Filtros */}
        <div className="card p-4 flex flex-wrap items-center gap-3">
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: "#ececf0" }}>
            <div className={`tab ${grupo==="todos"?"active":""}`} onClick={()=>setGrupo("todos")}>Todos</div>
            {(Object.keys(GRUPO_LABEL) as (keyof typeof GRUPO_LABEL)[]).map(g => (
              <div key={g} className={`tab ${grupo===g?"active":""}`} onClick={()=>setGrupo(g)}>{GRUPO_LABEL[g]}</div>
            ))}
          </div>
          <div className="flex-1 relative min-w-[240px]">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"><Icon.Search/></div>
            <input className="input pl-9" placeholder="Buscar por nombre, número, organismo…" value={q} onChange={e=>setQ(e.target.value)} />
          </div>
        </div>

        {/* Listas por grupo */}
        {grouped.size === 0 && (
          <div className="card p-12 text-center">
            <div className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center bg-brand-soft text-brand mb-4">
              <Icon.Folder/>
            </div>
            <div className="sf-display text-[18px] font-semibold mb-1">
              {grupo !== "todos" ? `Todavía no hay documentos en ${GRUPO_LABEL[grupo]}` : "Tu vault está vacío"}
            </div>
            <div className="text-[13px] text-ink-2 mb-5 max-w-md mx-auto">
              Subí estatutos, DNI de socios, inscripciones, habilitaciones y cualquier otro documento que necesites tener a mano para trámites o auditorías.
            </div>
            {canEdit ? (
              <div className="text-[12px] text-ink-3">
                Arrastrá tus PDFs arriba — la IA los clasifica automáticamente.
              </div>
            ) : hasCompany ? (
              <div className="text-[12px] text-ink-3">Necesitás rol de Administrador para cargar documentos.</div>
            ) : null}
          </div>
        )}
        {Array.from(grouped.entries()).map(([g, list]) => {
          const grupoKey = g as keyof typeof GRUPO_LABEL;
          const isContable = grupoKey === "contable";
          return (
          <div key={g} className="card overflow-hidden" style={isContable ? { borderLeft: "3px solid var(--accent)" } : undefined}>
            <div className="px-5 py-4 border-b border-line flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {isContable && <Icon.Sparkles/>}
                  <div className="sf-display text-[15px] font-semibold">{GRUPO_LABEL[grupoKey]}</div>
                </div>
                <div className="text-[12px] text-ink-3 mt-0.5">{GRUPO_SUBTITLE[grupoKey]}</div>
              </div>
              <div className="text-[12px] text-ink-3 shrink-0">{list.length} documentos</div>
            </div>
            <div className="overflow-x-auto scroll-clean">
              <table className="clean">
                <thead>
                  <tr>
                    <th>Documento</th>
                    <th>Categoría</th>
                    <th>Organismo</th>
                    <th>Emisión</th>
                    <th>Vencimiento</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map(d => <DocRow key={d.id} d={d} onOpen={openFile} onEdit={setEditing} onRemove={remove} canEdit={canEdit} />)}
                </tbody>
              </table>
            </div>
          </div>
          );
        })}
      </div>

      {openUpload && (
        <UploadModal
          onClose={() => setOpenUpload(false)}
          onCreated={(d) => { setDocs(prev => [d, ...prev]); setOpenUpload(false); router.refresh(); }}
        />
      )}
      {editing && (
        <EditModal
          doc={editing}
          onClose={() => setEditing(null)}
          onSaved={(d) => { setDocs(prev => prev.map(x => x.id === d.id ? d : x)); setEditing(null); }}
        />
      )}
    </>
  );
}

function DocRow({ d, onOpen, onEdit, onRemove, canEdit }: {
  d: CompanyDocument;
  onOpen: (d: CompanyDocument) => void;
  onEdit: (d: CompanyDocument) => void;
  onRemove: (id: string) => void;
  canEdit: boolean;
}) {
  const cat = categoryByKey(d.categoria);
  const days = daysUntil(d.fecha_vencimiento);
  let estado: { tone: any; text: string };
  if (!d.fecha_vencimiento) estado = { tone: "info", text: "Sin vencimiento" };
  else if (days! < 0) estado = { tone: "danger", text: `Vencido hace ${Math.abs(days!)} días` };
  else if (days! <= 30) estado = { tone: "warning", text: `Vence en ${days} días` };
  else estado = { tone: "success", text: "Vigente" };

  return (
    <tr>
      <td className="font-medium" title={d.nombre}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-soft text-brand shrink-0"><Icon.File/></div>
          <div className="min-w-0 truncate" style={{ maxWidth: 320 }}>
            <div className="truncate">{d.nombre}</div>
            {d.numero && <div className="text-[12px] text-ink-3 truncate">N° {d.numero}{d.vinculado_a ? " · "+d.vinculado_a : ""}</div>}
          </div>
        </div>
      </td>
      <td className="text-ink-2">{cat.label}</td>
      <td className="text-ink-2 truncate" style={{ maxWidth: 260 }} title={d.organismo ?? cat.organismoSugerido ?? ""}>
        {d.organismo ?? cat.organismoSugerido ?? "—"}
      </td>
      <td className="text-ink-2">{d.fecha_emision ?? "—"}</td>
      <td className="text-ink-2">{d.fecha_vencimiento ?? "—"}</td>
      <td><Badge tone={estado.tone}>{estado.text}</Badge></td>
      <td className="text-right">
        {d.storage_path && <button className="btn btn-ghost" style={{padding:"6px 10px"}} onClick={()=>onOpen(d)}><Icon.Download/> Ver</button>}
        {canEdit && <>
          <button className="btn btn-ghost ml-1" style={{padding:"6px 10px"}} onClick={()=>onEdit(d)}>Editar</button>
          <button className="btn btn-ghost ml-1" style={{padding:"6px 10px", color:"#f04f6f"}} onClick={()=>onRemove(d.id)}><Icon.Close/></button>
        </>}
      </td>
    </tr>
  );
}

function UploadModal({ onClose, onCreated }: { onClose: () => void; onCreated: (d: CompanyDocument) => void }) {
  const [categoria, setCategoria] = useState<DocCategory>("estatuto");
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [numero, setNumero] = useState("");
  const [organismo, setOrganismo] = useState("");
  const [emision, setEmision] = useState("");
  const [vencimiento, setVencimiento] = useState("");
  const [vinculado, setVinculado] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (!nombre) return setErr("El nombre es obligatorio");
    setSaving(true);

    const fd = new FormData();
    if (file) fd.append("file", file);
    fd.append("categoria", categoria);
    fd.append("nombre", nombre);
    fd.append("descripcion", descripcion);
    fd.append("numero", numero);
    fd.append("organismo", organismo);
    fd.append("fecha_emision", emision);
    fd.append("fecha_vencimiento", vencimiento);
    fd.append("vinculado_a", vinculado);

    const res = await fetch("/api/documents/upload", { method: "POST", body: fd });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(()=>({error:"Error"}));
      setErr(err.error ?? "No se pudo guardar");
      return;
    }
    const doc = await res.json();
    onCreated(doc);
  }

  const cat = CATEGORIES.find(c => c.key === categoria)!;

  return (
    <>
      <div className="modal-back" onClick={onClose}/>
      <div className="fixed right-6 top-6 bottom-6 w-[520px] card soft p-6 z-20 fade-in overflow-y-auto scroll-clean">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-[12px] uppercase tracking-wider text-ink-3">Subir documento</div>
            <div className="sf-display text-[20px] font-semibold mt-1">Nuevo documento</div>
          </div>
          <button className="btn btn-ghost" style={{padding:"6px 10px"}} onClick={onClose}><Icon.Close/></button>
        </div>
        <div className="space-y-3">
          <div>
            <div className="text-[12px] font-medium text-ink-2 mb-1">Categoría</div>
            <select className="input" value={categoria} onChange={e=>{ const k = e.target.value as DocCategory; setCategoria(k); const c = CATEGORIES.find(x=>x.key===k); if (c?.organismoSugerido && !organismo) setOrganismo(c.organismoSugerido); }}>
              {(Object.keys(GRUPO_LABEL) as (keyof typeof GRUPO_LABEL)[]).map(g => (
                <optgroup key={g} label={GRUPO_LABEL[g]}>
                  {CATEGORIES.filter(c => c.grupo === g).map(c => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div className="text-[11px] text-ink-3 mt-1">{cat.descripcion}</div>
          </div>
          <Field label="Nombre del documento *" value={nombre} onChange={setNombre} placeholder="Ej: Estatuto social 2020" />
          <Field label="Descripción"            value={descripcion} onChange={setDescripcion} placeholder="Notas libres" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Número / folio" value={numero} onChange={setNumero}/>
            <Field label="Organismo emisor" value={organismo} onChange={setOrganismo} placeholder={cat.organismoSugerido ?? ""}/>
            <Field label="Fecha de emisión" value={emision} onChange={setEmision} type="date"/>
            <Field label={"Fecha de vencimiento" + (cat.requiereVencimiento ? " *" : "")} value={vencimiento} onChange={setVencimiento} type="date"/>
          </div>
          <Field label="Vinculado a (opcional)" value={vinculado} onChange={setVinculado} placeholder="Socio, inmueble, etc."/>
          <div>
            <div className="text-[12px] font-medium text-ink-2 mb-1">Archivo (PDF/imagen)</div>
            <input type="file" accept="application/pdf,image/*" onChange={e => setFile(e.target.files?.[0] ?? null)}
                   className="block w-full text-[13px] file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-brand-soft file:text-brand file:font-medium hover:file:bg-[#d9e8fb]" />
          </div>
          {err && <div className="text-[13px] text-danger">{err}</div>}
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? "Guardando…" : "Guardar documento"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function EditModal({ doc, onClose, onSaved }: { doc: CompanyDocument; onClose: () => void; onSaved: (d: CompanyDocument) => void }) {
  const [nombre, setNombre] = useState(doc.nombre);
  const [descripcion, setDescripcion] = useState(doc.descripcion ?? "");
  const [numero, setNumero] = useState(doc.numero ?? "");
  const [organismo, setOrganismo] = useState(doc.organismo ?? "");
  const [emision, setEmision] = useState(doc.fecha_emision ?? "");
  const [vencimiento, setVencimiento] = useState(doc.fecha_vencimiento ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const supabase = createClient();
    const { data } = await supabase.from("company_documents")
      .update({ nombre, descripcion, numero, organismo, fecha_emision: emision || null, fecha_vencimiento: vencimiento || null })
      .eq("id", doc.id).select().single();
    setSaving(false);
    if (data) onSaved(data);
  }

  return (
    <>
      <div className="modal-back" onClick={onClose}/>
      <div className="fixed right-6 top-6 bottom-6 w-[520px] card soft p-6 z-20 fade-in overflow-y-auto scroll-clean">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-[12px] uppercase tracking-wider text-ink-3">Editar documento</div>
            <div className="sf-display text-[20px] font-semibold mt-1">{doc.nombre}</div>
          </div>
          <button className="btn btn-ghost" style={{padding:"6px 10px"}} onClick={onClose}><Icon.Close/></button>
        </div>
        <div className="space-y-3">
          <Field label="Nombre" value={nombre} onChange={setNombre}/>
          <Field label="Descripción" value={descripcion} onChange={setDescripcion}/>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Número / folio" value={numero} onChange={setNumero}/>
            <Field label="Organismo" value={organismo} onChange={setOrganismo}/>
            <Field label="Emisión" value={emision} onChange={setEmision} type="date"/>
            <Field label="Vencimiento" value={vencimiento} onChange={setVencimiento} type="date"/>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</button>
          </div>
        </div>
      </div>
    </>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }:
  { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <div className="text-[12px] font-medium text-ink-2 mb-1">{label}</div>
      <input className="input" type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

// ============================================================================
// Dropzone IA — arrastrás N PDFs, la IA los clasifica y archiva solos
// ============================================================================
type BulkItem = {
  fileName: string;
  ok: boolean;
  error?: string;
  classification?: {
    categoria: DocCategory;
    nombre_sugerido: string;
    descripcion: string | null;
    numero: string | null;
    organismo: string | null;
    fecha_emision: string | null;
    fecha_vencimiento: string | null;
    vinculado_a: string | null;
    confidence: number;
    warnings: string[];
  };
  doc?: CompanyDocument;
};

function AiBulkDropzone({ onDone }: { onDone: (docs: CompanyDocument[]) => void }) {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"idle" | "classifying" | "saving" | "done">("idle");
  const [items, setItems] = useState<BulkItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ total: number; exitosos: number; fallidos: number } | null>(null);

  async function handle(files: FileList | File[]) {
    const arr = Array.from(files);
    if (!arr.length) return;
    if (arr.length > 15) { setErr("Máximo 15 archivos por tanda."); return; }

    setErr(null); setBusy(true); setStage("classifying"); setItems([]); setSummary(null);
    try {
      const fd = new FormData();
      arr.forEach(f => fd.append("file", f));
      const res = await fetch("/api/documents/bulk-upload", { method: "POST", body: fd });
      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 400) }; }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setItems(data.items || []);
      setSummary(data.summary || null);
      setStage("done");
      if (data.created?.length) onDone(data.created);
    } catch (e: any) {
      setErr(e.message || "Error inesperado");
      setStage("idle");
    } finally { setBusy(false); }
  }

  function clearAll() {
    setItems([]); setSummary(null); setErr(null); setStage("idle");
  }

  return (
    <div className="card p-5">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-brand-soft text-brand shrink-0">
          <Icon.Sparkles/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="sf-display text-[15px] font-semibold">Cargá documentos con IA</div>
          <div className="text-[12px] text-ink-2">
            Arrastrá estatutos, DNI, inscripciones, habilitaciones, etc. La IA detecta qué es cada uno y los archiva por categoría.
          </div>
        </div>
        {items.length > 0 && (
          <button className="btn btn-ghost" style={{padding:"6px 10px"}} onClick={clearAll}>Limpiar</button>
        )}
      </div>

      <div
        className={`drop ${drag ? "drag" : ""} p-8 text-center cursor-pointer`}
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (!busy) handle(e.dataTransfer.files); }}
        onClick={() => !busy && document.getElementById("ai-bulk-doc-input")?.click()}
        style={busy ? { opacity: 0.6, cursor: "wait" } : undefined}
      >
        <input id="ai-bulk-doc-input" type="file" accept="application/pdf,image/*" multiple className="hidden"
               onChange={(e) => e.target.files && handle(e.target.files)} />
        <div className="flex items-center justify-center gap-2 mb-1 text-brand">
          <Icon.Upload/>
          <div className="sf-display text-[14px] font-semibold">
            {stage === "classifying" ? "Clasificando con Claude…"
            : stage === "saving"      ? "Archivando…"
            : "Arrastrá archivos o hacé click"}
          </div>
        </div>
        <div className="text-[12px] text-ink-2">
          PDF o imagen · hasta 15 archivos por tanda
        </div>
      </div>

      {err && <div className="mt-3 p-3 rounded-xl border border-[#f8c3cf] bg-[#fdeaef] text-[12px] text-[#9c2944]">{err}</div>}

      {items.length > 0 && (
        <div className="mt-4">
          {summary && (
            <div className="flex items-center gap-2 mb-2 text-[13px]">
              <Badge tone="success">{summary.exitosos} archivados</Badge>
              {summary.fallidos > 0 && <Badge tone="danger">{summary.fallidos} con error</Badge>}
              <span className="text-ink-3">de {summary.total} documentos</span>
            </div>
          )}
          <div className="space-y-1.5">
            {items.map((it, i) => {
              const c = it.classification;
              const cat = c ? categoryByKey(c.categoria) : null;
              return (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-line bg-surface-2">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-soft text-brand shrink-0">
                    <Icon.File/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold truncate">
                      {c?.nombre_sugerido || it.fileName}
                    </div>
                    <div className="text-[11px] text-ink-3 truncate">
                      {it.ok && c
                        ? <>
                            {cat?.label ?? c.categoria}
                            {c.organismo ? ` · ${c.organismo}` : ""}
                            {c.fecha_vencimiento ? ` · vence ${c.fecha_vencimiento}` : ""}
                            {typeof c.confidence === "number" ? ` · ${Math.round(c.confidence*100)}% conf.` : ""}
                          </>
                        : (it.error || "Error")}
                    </div>
                  </div>
                  <Badge tone={it.ok ? "success" : "danger"}>{it.ok ? (cat?.label ?? "OK") : "Error"}</Badge>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Menú de limpieza masiva — borra todo / hoy / última semana
// ============================================================================
function CleanupMenu({ onCleaned }: { onCleaned: (deletedIds: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function clean(filter: "all" | "today" | "last_week") {
    const labels = {
      all: "TODOS los documentos archivados",
      today: "todos los documentos cargados HOY",
      last_week: "todos los documentos cargados en los ÚLTIMOS 7 DÍAS"
    };
    const conf = window.confirm(
      `¿Eliminar ${labels[filter]}?\n\nSe borran tanto las filas como los archivos del Storage. Esta acción no se puede deshacer.`
    );
    if (!conf) return;
    setOpen(false); setWorking(true); setMsg(null);
    try {
      const r = await fetch("/api/documents/bulk-delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filter })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setMsg(`OK ${d.deleted} documentos eliminados (${d.files_removed} archivos del Storage)`);
      onCleaned([]);
    } catch (e: any) {
      setMsg("Error: " + e.message);
    } finally {
      setWorking(false);
      setTimeout(() => setMsg(null), 4000);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        className="btn btn-ghost"
        onClick={() => setOpen(o => !o)}
        disabled={working}
        style={{ color: "#f04f6f" }}
      >
        <Icon.Close /> {working ? "Limpiando..." : "Limpiar"}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-[280px] rounded-xl bg-white border border-line z-30 fade-in overflow-hidden"
          style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.10)" }}
        >
          <div className="px-3 py-2.5 border-b border-line bg-surface-2">
            <div className="text-[12px] uppercase tracking-wider text-ink-3">Eliminar documentos</div>
          </div>
          <button
            onClick={() => clean("today")}
            className="w-full text-left px-3 py-3 hover:bg-[#fafafb] flex items-start gap-3"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#e8f1fd] text-[#0062c2] shrink-0">
              <Icon.File/>
            </div>
            <div>
              <div className="text-[14px] font-semibold">Subidos hoy</div>
              <div className="text-[11px] text-ink-3">Solo los cargados en las ultimas horas</div>
            </div>
          </button>
          <button
            onClick={() => clean("last_week")}
            className="w-full text-left px-3 py-3 hover:bg-[#fafafb] flex items-start gap-3 border-t border-line"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#fcf0dd] text-[#b4730e] shrink-0">
              <Icon.File/>
            </div>
            <div>
              <div className="text-[14px] font-semibold">Ultima semana</div>
              <div className="text-[11px] text-ink-3">Cargados en los ultimos 7 dias</div>
            </div>
          </button>
          <button
            onClick={() => clean("all")}
            className="w-full text-left px-3 py-3 hover:bg-[#fdeaef] flex items-start gap-3 border-t border-line"
            style={{ color: "#9c2944" }}
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#fdeaef] text-[#9c2944] shrink-0">
              <Icon.Close/>
            </div>
            <div>
              <div className="text-[14px] font-semibold">Eliminar TODO</div>
              <div className="text-[11px] opacity-80">Toda la documentacion de esta empresa</div>
            </div>
          </button>
        </div>
      )}

      {msg && (
        <div className="absolute right-0 top-full mt-12 w-[300px] p-3 rounded-xl text-[12px] z-30"
             style={{
               background: msg.startsWith("OK") ? "#e6f6ed" : "#fdeaef",
               color:      msg.startsWith("OK") ? "#176a4a" : "#9c2944"
             }}>
          {msg}
        </div>
      )}
    </div>
  );
}
