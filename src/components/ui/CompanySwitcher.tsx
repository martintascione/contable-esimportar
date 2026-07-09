"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./Icons";
import { Badge } from "./Badge";

type CompanyEntry = {
  id: string;
  role: "admin" | "contador";
  company: {
    id: string;
    razon_social: string;
    cuit: string;
    condicion_iva?: string | null;
  };
};

export function CompanySwitcher() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [companies, setCompanies] = useState<CompanyEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/company/list", { cache: "no-store" });
      const data = await r.json();
      if (r.ok) {
        setCompanies(data.companies ?? []);
        setActiveId(data.activeCompanyId);
      }
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  // cerrar al click afuera
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function switchTo(companyId: string) {
    if (companyId === activeId) { setOpen(false); return; }
    const r = await fetch("/api/company/switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ company_id: companyId })
    });
    if (r.ok) {
      setActiveId(companyId);
      setOpen(false);
      router.refresh();
      // Recarga dura para que todos los datos del server se re-fetcheen
      window.location.reload();
    }
  }

  const activeEntry = companies.find(c => c.id === activeId) ?? companies[0];

  return (
    <>
      <div ref={boxRef} className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-line bg-white hover:bg-[#fafafb] transition"
        >
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[12px] font-bold shrink-0"
               style={{ background: "linear-gradient(135deg,#0071e3,#54a0ff)" }}>
            {initials(activeEntry?.company.razon_social)}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <div className="text-[12px] font-semibold truncate leading-tight">
              {loading ? "Cargando…" : (activeEntry?.company.razon_social ?? "Sin empresa")}
            </div>
            <div className="text-[10px] text-ink-3 truncate leading-tight">
              {activeEntry ? activeEntry.company.cuit : "Creá tu primera empresa"}
            </div>
          </div>
          <Icon.Chevron style={{ transform: open ? "rotate(90deg)" : "rotate(90deg)", opacity: 0.6 }}/>
        </button>

        {open && (
          <div className="absolute left-0 right-0 top-full mt-2 p-2 rounded-xl bg-white border border-line shadow-lg z-20 fade-in"
               style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.10)" }}>
            <div className="text-[10px] uppercase tracking-wider text-ink-3 px-2 py-1">Empresas</div>
            <div className="max-h-[260px] overflow-y-auto scroll-clean">
              {companies.length === 0 && (
                <div className="px-2 py-4 text-[12px] text-ink-3 text-center">
                  Todavía no tenés empresas.
                </div>
              )}
              {companies.map(c => {
                const active = c.id === activeId;
                return (
                  <button
                    key={c.id}
                    onClick={() => switchTo(c.id)}
                    className={`w-full flex items-center gap-2 p-2 rounded-lg hover:bg-[#f5f5f7] ${active ? "bg-[#eef4ff]" : ""}`}
                  >
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[11px] font-bold shrink-0"
                         style={{ background: "linear-gradient(135deg,#0071e3,#54a0ff)" }}>
                      {initials(c.company.razon_social)}
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <div className="text-[12px] font-semibold truncate">{c.company.razon_social}</div>
                      <div className="text-[10px] text-ink-3 truncate">{c.company.cuit}</div>
                    </div>
                    {c.role === "admin" && <Badge tone="compra">Admin</Badge>}
                    {active && <Icon.Check/>}
                  </button>
                );
              })}
            </div>
            <div className="divider my-2"/>
            <button
              onClick={() => { setOpen(false); setCreating(true); }}
              className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-[#f5f5f7] text-brand font-semibold text-[12px]"
            >
              <Icon.Plus/> Crear nueva empresa
            </button>
          </div>
        )}
      </div>

      {creating && (
        <CreateCompanyModal
          onClose={() => setCreating(false)}
          onCreated={async (c) => {
            setCreating(false);
            // Recargar lista y activar la recién creada (ya la activa el endpoint)
            await load();
            setActiveId(c.id);
            router.refresh();
            window.location.reload();
          }}
        />
      )}
    </>
  );
}

function initials(name?: string | null) {
  if (!name) return "–";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase() ?? "").join("") || name[0]?.toUpperCase() || "?";
}

// ----- Modal -----

function CreateCompanyModal({
  onClose, onCreated
}: { onClose: () => void; onCreated: (c: { id: string; razon_social: string; cuit: string }) => void }) {
  const [razon, setRazon] = useState("");
  const [cuit, setCuit] = useState("");
  const [condIva, setCondIva] = useState("");
  const [iibb, setIibb] = useState("");
  const [actividad, setActividad] = useState("");
  const [direccion, setDireccion] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [extracting, setExtracting] = useState(false);
  const [extractErr, setExtractErr] = useState<string | null>(null);
  const [detected, setDetected] = useState<{ fileName: string; ok: boolean; error?: string; tipo_documento?: string; confidence?: number }[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  async function extractFromDocs(files: FileList | File[]) {
    const arr = Array.from(files);
    if (!arr.length) return;
    setExtractErr(null); setNotice(null); setExtracting(true);
    try {
      const fd = new FormData();
      arr.forEach(f => fd.append("file", f));
      const r = await fetch("/api/company/extract", { method: "POST", body: fd });
      const text = await r.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 400) }; }
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      const m = data.merged || {};
      if (m.razon_social && !razon)    setRazon(m.razon_social);
      if (m.cuit && !cuit)             setCuit(m.cuit);
      if (m.condicion_iva && !condIva) setCondIva(m.condicion_iva);
      if (m.iibb && !iibb) setIibb(m.iibb + (m.iibb_jurisdiccion ? ` (${m.iibb_jurisdiccion})` : ""));
      if (m.actividad_principal && !actividad) setActividad(m.actividad_principal);
      if (m.direccion_fiscal && !direccion) setDireccion(m.direccion_fiscal);
      setDetected(data.perFile || []);
      const c = ["razon_social","cuit","condicion_iva","iibb","actividad_principal","direccion_fiscal"]
        .filter(k => m[k]).length;
      setNotice(`La IA completó ${c} campos. Revisá antes de guardar.`);
    } catch (e: any) {
      setExtractErr(e.message || "No se pudieron procesar los documentos");
    } finally { setExtracting(false); }
  }

  async function save() {
    setErr(null);
    if (!razon.trim() || !cuit.trim()) return setErr("Razón social y CUIT son obligatorios.");
    setSaving(true);
    try {
      const r = await fetch("/api/company/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          razon_social: razon.trim(),
          cuit: cuit.trim(),
          condicion_iva: condIva.trim() || null,
          iibb: iibb.trim() || null,
          actividad: actividad.trim() || null,
          direccion: direccion.trim() || null,
          makeActive: true
        })
      });
      const text = await r.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 400) }; }
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      onCreated(data.company);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="modal-back" onClick={onClose}/>
      <div className="fixed right-6 top-6 bottom-6 w-[560px] card soft p-6 z-30 fade-in overflow-y-auto scroll-clean">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-[12px] uppercase tracking-wider text-ink-3">Crear empresa</div>
            <div className="sf-display text-[22px] font-semibold mt-1">Nueva empresa</div>
            <div className="text-[12px] text-ink-3">Vas a quedar como administrador. Se activa automáticamente.</div>
          </div>
          <button className="btn btn-ghost" style={{padding:"6px 10px"}} onClick={onClose}><Icon.Close/></button>
        </div>

        {/* Autocompletar */}
        <div
          className={`drop ${drag ? "drag" : ""} p-5 text-center cursor-pointer`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); extractFromDocs(e.dataTransfer.files); }}
          onClick={() => document.getElementById("ai-new-company-input")?.click()}
        >
          <input id="ai-new-company-input" type="file" accept="application/pdf,image/*" multiple className="hidden"
                 onChange={(e) => e.target.files && extractFromDocs(e.target.files)} />
          <div className="flex items-center justify-center gap-2 mb-1 text-brand">
            <Icon.Sparkles/>
            <div className="sf-display text-[14px] font-semibold">Autocompletar con IA</div>
          </div>
          <div className="text-[12px] text-ink-2">
            {extracting
              ? "Procesando con Claude…"
              : <>Arrastrá constancia de CUIT / inscripción IIBB / ARCA</>}
          </div>
          <div className="text-[10px] text-ink-3 mt-1">PDF o imagen · hasta 6</div>
        </div>

        {detected.length > 0 && (
          <div className="mt-2 space-y-1">
            {detected.map((d, i) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-lg border border-line bg-surface-2 text-[11px]">
                <div className="truncate mr-2">{d.fileName}</div>
                <Badge tone={d.ok ? "success" : "danger"}>{d.ok ? `${d.tipo_documento ?? "doc"} · ${Math.round((d.confidence ?? 0)*100)}%` : "Error"}</Badge>
              </div>
            ))}
          </div>
        )}
        {notice && <div className="mt-2 p-2.5 rounded-lg border border-[#d5e2ff] bg-[#eef4ff] text-[11px] text-[#2d4d94]">{notice}</div>}
        {extractErr && <div className="mt-2 p-2.5 rounded-lg border border-[#f8c3cf] bg-[#fdeaef] text-[11px] text-[#9c2944]">{extractErr}</div>}

        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-line"/>
          <div className="text-[10px] uppercase tracking-wider text-ink-3">o completá a mano</div>
          <div className="flex-1 h-px bg-line"/>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2"><Mini label="Razón social *" value={razon} onChange={setRazon}/></div>
          <Mini label="CUIT *" value={cuit} onChange={setCuit} placeholder="30-12345678-9"/>
          <Mini label="Condición IVA" value={condIva} onChange={setCondIva}/>
          <Mini label="N° IIBB" value={iibb} onChange={setIibb}/>
          <Mini label="Actividad principal" value={actividad} onChange={setActividad}/>
          <div className="md:col-span-2"><Mini label="Dirección fiscal" value={direccion} onChange={setDireccion}/></div>
        </div>

        {err && <div className="mt-3 text-[12px] text-danger">{err}</div>}

        <div className="flex justify-end gap-2 mt-4">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            <Icon.Check/> {saving ? "Creando…" : "Crear y activar"}
          </button>
        </div>
      </div>
    </>
  );
}

function Mini({ label, value, onChange, placeholder }:
  { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-ink-2 mb-1">{label}</div>
      <input className="input" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
