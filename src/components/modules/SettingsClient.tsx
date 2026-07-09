"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/ui/Topbar";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icons";
import { createClient } from "@/lib/supabase/client";
import type { Company, Integration, Profile } from "@/lib/supabase/types";

type Health = {
  supabase: {
    configured: boolean; ok: boolean; message: string;
    url: string | null; anonKey: string | null; serviceRole: string | null; tablesOk?: boolean;
  };
  anthropic: {
    configured: boolean; ok: boolean; message: string;
    apiKey: string | null; model: string;
  };
  ready: boolean;
} | null;

const INTEGRATION_PROVIDERS = [
  { key: "afip",        name: "AFIP / ARCA",         desc: "Descarga automática de comprobantes emitidos y recibidos" },
  { key: "mercadopago", name: "Mercado Pago",         desc: "Sincronización de cobros, QR y link de pago" },
  { key: "resend",      name: "Resend · Email",       desc: "Envío automático de reportes mensuales por correo" },
  { key: "whatsapp",    name: "WhatsApp Business",    desc: "Alertas de cierre y recordatorios por WhatsApp" },
  { key: "n8n",         name: "n8n / Make",           desc: "Automatizaciones externas (webhooks)" },
  { key: "gdrive",      name: "Google Drive",         desc: "Backup automático de comprobantes" }
];

type PartnerRow = {
  id: string;
  nombre: string;
  cuit: string | null;
  dni: string | null;
  relacion: string;
  porcentaje: number | null;
  observaciones: string | null;
};

export function SettingsClient({
  profile, company, teamMembers, integrations, partners = []
}: {
  profile: Profile & { companies: Company | null };
  company: Company | null;
  teamMembers: Pick<Profile, "id"|"email"|"full_name"|"role">[];
  integrations: Integration[];
  partners?: PartnerRow[];
}) {
  const canEdit = profile?.role === "admin";
  const [empresa, setEmpresa] = useState<Company | null>(company);
  const [members, setMembers] = useState(teamMembers);
  const [partnerList, setPartnerList] = useState<PartnerRow[]>(partners);
  const [addingPartner, setAddingPartner] = useState(false);
  const [intState, setIntState] = useState<Record<string, Integration | undefined>>(
    Object.fromEntries(integrations.map(i => [i.provider, i]))
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [health, setHealth] = useState<Health>(null);
  const [probing, setProbing] = useState(false);

  async function probeHealth() {
    setProbing(true);
    try {
      const r = await fetch("/api/health", { cache: "no-store" });
      setHealth(await r.json());
    } catch { setHealth(null); }
    finally { setProbing(false); }
  }
  useEffect(() => { probeHealth(); }, []);

  async function saveCompany() {
    if (!empresa) return;
    setSaving(true); setErr(null); setSaved(false);
    const supabase = createClient();
    const { error } = await supabase
      .from("companies")
      .update({
        razon_social: empresa.razon_social,
        cuit: empresa.cuit,
        condicion_iva: empresa.condicion_iva,
        iibb: empresa.iibb,
        actividad: empresa.actividad,
        direccion: empresa.direccion
      })
      .eq("id", empresa.id);
    setSaving(false);
    if (error) return setErr(error.message);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function removeMember(id: string) {
    if (!confirm("¿Quitar este usuario del equipo?")) return;
    const supabase = createClient();
    await supabase.from("profiles").update({ company_id: null }).eq("id", id);
    setMembers(prev => prev.filter(m => m.id !== id));
  }

  async function toggleIntegration(providerKey: string) {
    if (!empresa) return;
    const supabase = createClient();
    const existing = intState[providerKey];
    if (existing?.status === "connected") {
      await supabase.from("integrations").update({ status: "disconnected" }).eq("id", existing.id);
      setIntState(p => ({ ...p, [providerKey]: { ...existing, status: "disconnected" } }));
    } else if (existing) {
      await supabase.from("integrations").update({ status: "connected", connected_at: new Date().toISOString() }).eq("id", existing.id);
      setIntState(p => ({ ...p, [providerKey]: { ...existing, status: "connected", connected_at: new Date().toISOString() } }));
    } else {
      const { data } = await supabase.from("integrations")
        .insert({ company_id: empresa.id, provider: providerKey, status: "connected", connected_at: new Date().toISOString() })
        .select().single();
      if (data) setIntState(p => ({ ...p, [providerKey]: data }));
    }
  }

  if (!empresa) {
    return (
      <>
        <Topbar
          title="Configuración"
          subtitle="Primero creá tu empresa para empezar a trabajar."
        />
        <div className="p-8">
          <CreateCompanyCard onCreated={(c) => setEmpresa(c)} />
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar
        title="Configuración"
        subtitle="Datos fiscales · integraciones · usuarios"
        right={canEdit && (
          <button className="btn btn-primary" onClick={saveCompany} disabled={saving}>
            <Icon.Check/> {saving ? "Guardando…" : saved ? "Guardado" : "Guardar cambios"}
          </button>
        )}
      />
      <div className="p-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="sf-display text-[17px] font-semibold">Datos fiscales de la empresa</div>
                <div className="text-[13px] text-ink-2">Se usan para clasificar ventas y compras automáticamente.</div>
              </div>
              {!canEdit && <Badge tone="pendiente">Solo lectura</Badge>}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Razón social"        value={empresa.razon_social}     onChange={v=>setEmpresa({ ...empresa, razon_social: v })}   disabled={!canEdit} />
              <Field label="CUIT"                 value={empresa.cuit}             onChange={v=>setEmpresa({ ...empresa, cuit: v })}           disabled={!canEdit} />
              <Field label="Condición IVA"        value={empresa.condicion_iva ?? ""} onChange={v=>setEmpresa({ ...empresa, condicion_iva: v })} disabled={!canEdit} />
              <Field label="N° IIBB"              value={empresa.iibb ?? ""}          onChange={v=>setEmpresa({ ...empresa, iibb: v })}         disabled={!canEdit} />
              <Field label="Actividad principal"  value={empresa.actividad ?? ""}     onChange={v=>setEmpresa({ ...empresa, actividad: v })}    disabled={!canEdit} />
              <Field label="Dirección fiscal"     value={empresa.direccion ?? ""}     onChange={v=>setEmpresa({ ...empresa, direccion: v })}    disabled={!canEdit} />
            </div>
            {err && <div className="text-[13px] text-danger mt-3">{err}</div>}
          </div>

          <div className="card p-6">
            <div className="flex items-center justify-between mb-1">
              <div>
                <div className="sf-display text-[17px] font-semibold">Conexiones técnicas</div>
                <div className="text-[12px] text-ink-3">Base de datos e inteligencia artificial — el motor de la app.</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={health?.ready ? "success" : "pendiente"}>
                  {health?.ready ? "Todo operativo" : "Requiere atención"}
                </Badge>
                <button className="btn btn-ghost" onClick={probeHealth} disabled={probing}>
                  <Icon.Refresh/> {probing ? "Probando..." : "Probar"}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
              <HealthTile
                title="Supabase · Base de datos"
                subtitle="Auth, Postgres, Storage"
                configured={health?.supabase.configured}
                ok={health?.supabase.ok}
                detail={health?.supabase.message}
                lines={[
                  ["URL", health?.supabase.url ?? "—"],
                  ["anon key", health?.supabase.anonKey ?? "—"],
                  ["service_role", health?.supabase.serviceRole ?? "—"],
                  ["Tablas", health?.supabase.tablesOk === false ? "Falta migración SQL" : "OK"]
                ]}
              />
              <HealthTile
                title="Claude · Motor de IA"
                subtitle="Extracción de facturas y extractos"
                configured={health?.anthropic.configured}
                ok={health?.anthropic.ok}
                detail={health?.anthropic.message}
                lines={[
                  ["API key", health?.anthropic.apiKey ?? "—"],
                  ["Modelo", health?.anthropic.model ?? "—"]
                ]}
              />
            </div>

            <div className="flex items-center justify-between mt-4 p-3 rounded-xl border border-line bg-surface-2">
              <div className="text-[13px] text-ink-2">
                ¿Necesitás cambiar credenciales o configurar desde cero?
              </div>
              <a className="btn btn-primary" href="/setup">
                Abrir asistente de configuración
              </a>
            </div>
          </div>

          {canEdit && (
            <PartnersCard
              partners={partnerList}
              onAdded={(p) => setPartnerList(prev => [...prev, p])}
              onDeleted={(id) => setPartnerList(prev => prev.filter(x => x.id !== id))}
              onOpenAdd={() => setAddingPartner(true)}
            />
          )}
          {canEdit && <PublicFichaCard empresa={empresa} onChange={setEmpresa}/>}

          <div className="card p-6">
            <div className="flex items-center justify-between mb-1">
              <div className="sf-display text-[17px] font-semibold">Integraciones</div>
              <div className="text-[12px] text-ink-3">Activalas cuando quieras conectar el servicio.</div>
            </div>
            <div className="text-[13px] text-ink-2 mb-4">
              Las credenciales sensibles (API keys, tokens) se cargan desde variables de entorno del servidor; acá configurás qué servicios están activos para esta empresa.
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {INTEGRATION_PROVIDERS.map(p => {
                const it = intState[p.key];
                const connected = it?.status === "connected";
                return (
                  <div key={p.key} className="flex items-center justify-between p-4 rounded-xl border border-line bg-surface-2">
                    <div className="flex-1 min-w-0 pr-4">
                      <div className="text-[14px] font-semibold">{p.name}</div>
                      <div className="text-[12px] text-ink-2">{p.desc}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={connected ? "success" : "pendiente"}>{connected ? "Conectada" : "Desconectada"}</Badge>
                      {canEdit && (
                        <button className="btn btn-ghost" style={{padding:"6px 12px"}} onClick={() => toggleIntegration(p.key)}>
                          {connected ? "Desconectar" : "Conectar"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="sf-display text-[17px] font-semibold">Usuarios</div>
            <Badge tone={canEdit ? "compra" : "pendiente"}>{canEdit ? "Admin" : "Contador"}</Badge>
          </div>
          <div className="space-y-2">
            {members.map(u => (
              <div key={u.id} className="flex items-center gap-3 p-3 rounded-xl border border-line">
                <div className="w-9 h-9 rounded-full flex items-center justify-center bg-[#ececf0]"><Icon.User/></div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold truncate">{u.full_name || u.email}</div>
                  <div className="text-[11px] truncate text-ink-3">{u.email}</div>
                </div>
                <Badge tone={u.role === "admin" ? "compra" : "venta"}>{u.role === "admin" ? "Admin" : "Contador"}</Badge>
                {canEdit && u.id !== profile.id && (
                  <button className="btn btn-ghost" style={{padding:"6px 8px"}} onClick={() => removeMember(u.id)}><Icon.Close/></button>
                )}
              </div>
            ))}
          </div>
          {canEdit && (
            <>
              <div className="divider my-5"/>
              <div className="text-[13px] text-ink-2">
                Para invitar nuevos usuarios: compartí el registro y vinculalos desde Supabase Studio o activá la invitación por email en la próxima versión.
              </div>
            </>
          )}
        </div>
      </div>

      {addingPartner && (
        <AddPartnerSettingsModal
          onClose={() => setAddingPartner(false)}
          onCreated={(p) => { setPartnerList(prev => [...prev, p]); setAddingPartner(false); }}
        />
      )}
    </>
  );
}

function Field({ label, value, onChange, disabled }:
  { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div>
      <div className="text-[12px] font-medium text-ink-2 mb-1">{label}</div>
      <input className="input" value={value ?? ""} onChange={e => onChange(e.target.value)} disabled={disabled}/>
    </div>
  );
}

function CreateCompanyCard({ onCreated }: { onCreated: (c: Company) => void }) {
  const [razon, setRazon] = useState("");
  const [cuit, setCuit] = useState("");
  const [condIva, setCondIva] = useState("");
  const [iibb, setIibb] = useState("");
  const [actividad, setActividad] = useState("");
  const [direccion, setDireccion] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Autocompletado con IA
  const [extracting, setExtracting] = useState(false);
  const [extractErr, setExtractErr] = useState<string | null>(null);
  const [detectedFiles, setDetectedFiles] = useState<{ fileName: string; ok: boolean; error?: string; tipo_documento?: string; confidence?: number }[]>([]);
  const [aiNotice, setAiNotice] = useState<string | null>(null);

  async function extractFromDocs(files: FileList | File[]) {
    const arr = Array.from(files);
    if (!arr.length) return;
    setExtractErr(null); setAiNotice(null);
    setExtracting(true);
    try {
      const fd = new FormData();
      arr.forEach(f => fd.append("file", f));
      const res = await fetch("/api/company/extract", { method: "POST", body: fd });
      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 400) }; }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const m = data.merged || {};
      if (m.razon_social && !razon)    setRazon(m.razon_social);
      if (m.cuit && !cuit)             setCuit(m.cuit);
      if (m.condicion_iva && !condIva) setCondIva(m.condicion_iva);
      if (m.iibb && !iibb) {
        const j = m.iibb_jurisdiccion ? ` (${m.iibb_jurisdiccion})` : "";
        setIibb(m.iibb + j);
      }
      if (m.actividad_principal && !actividad) setActividad(m.actividad_principal);
      if (m.direccion_fiscal && !direccion)     setDireccion(m.direccion_fiscal);

      setDetectedFiles(data.perFile || []);
      const campos = ["razon_social","cuit","condicion_iva","iibb","actividad_principal","direccion_fiscal"]
        .filter(k => m[k]).length;
      setAiNotice(`La IA completó ${campos} campos. Revisá y ajustá lo que necesites antes de guardar.`);
    } catch (e: any) {
      setExtractErr(e.message || "No se pudieron procesar los documentos.");
    } finally { setExtracting(false); }
  }

  async function create() {
    setErr(null);
    if (!razon.trim() || !cuit.trim()) return setErr("Razón social y CUIT son obligatorios.");
    if (cuit.trim().length > 20) return setErr("El CUIT no puede tener más de 20 caracteres. Formato: 30-12345678-9.");
    if (razon.trim().length > 200) return setErr("La razón social es demasiado larga (máx 200 caracteres).");
    setSaving(true);
    try {
      const res = await fetch("/api/company/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          razon_social: razon.trim(),
          cuit: cuit.trim(),
          condicion_iva: condIva.trim() || null,
          iibb: iibb.trim() || null,
          actividad: actividad.trim() || null,
          direccion: direccion.trim() || null
        })
      });
      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 400) || `HTTP ${res.status}` }; }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onCreated(data.company);
      // Refresh para que el resto de los módulos lea la nueva empresa
      window.location.reload();
    } catch (e: any) {
      setErr(e.message || "Error inesperado");
    } finally { setSaving(false); }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="card p-7">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-brand-soft text-brand">
            <Icon.Sparkles/>
          </div>
          <div>
            <div className="sf-display text-[20px] font-semibold">Creá tu empresa</div>
            <div className="text-[13px] text-ink-2">Es el primer paso antes de subir facturas o documentos.</div>
          </div>
        </div>

        {/* Autocompletar con IA */}
        <AiAutocompleteZone
          onFiles={extractFromDocs}
          busy={extracting}
          detected={detectedFiles}
          error={extractErr}
          notice={aiNotice}
        />

        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-line"/>
          <div className="text-[11px] uppercase tracking-wider text-ink-3">o completá a mano</div>
          <div className="flex-1 h-px bg-line"/>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Field label="Razón social *" value={razon} onChange={setRazon} />
          </div>
          <Field label="CUIT *" value={cuit} onChange={setCuit} />
          <Field label="Condición IVA" value={condIva} onChange={setCondIva} />
          <Field label="N° IIBB" value={iibb} onChange={setIibb} />
          <Field label="Actividad principal" value={actividad} onChange={setActividad} />
          <div className="md:col-span-2">
            <Field label="Dirección fiscal" value={direccion} onChange={setDireccion} />
          </div>
        </div>
        {err && <div className="mt-3 text-[13px] text-danger">{err}</div>}
        <div className="flex justify-end mt-5">
          <button className="btn btn-primary" onClick={create} disabled={saving}>
            <Icon.Check/> {saving ? "Creando..." : "Crear empresa y continuar"}
          </button>
        </div>
      </div>
      <div className="mt-3 text-[12px] text-ink-3 text-center">
        Vas a quedar como <b>Administrador</b> de esta empresa. Después podés invitar a tu contador desde esta misma página.
      </div>
    </div>
  );
}

function AiAutocompleteZone({
  onFiles, busy, detected, error, notice
}: {
  onFiles: (files: FileList | File[]) => void;
  busy: boolean;
  detected: { fileName: string; ok: boolean; error?: string; tipo_documento?: string; confidence?: number }[];
  error: string | null;
  notice: string | null;
}) {
  const [drag, setDrag] = useState(false);
  return (
    <div>
      <div
        className={`drop ${drag ? "drag" : ""} p-6 text-center cursor-pointer`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}
        onClick={() => document.getElementById("ai-company-input")?.click()}
      >
        <input
          id="ai-company-input"
          type="file"
          accept="application/pdf,image/*"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && onFiles(e.target.files)}
        />
        <div className="flex items-center justify-center gap-2 mb-2 text-brand">
          <Icon.Sparkles/>
          <div className="sf-display text-[15px] font-semibold">Autocompletar con IA</div>
        </div>
        <div className="text-[13px] text-ink-2 leading-relaxed">
          {busy
            ? "Leyendo tus documentos con Claude…"
            : <>Arrastrá aquí <b>constancia de CUIT, inscripción ARCA/AFIP, inscripción IIBB</b> o similares.<br/>La IA completa los campos por vos.</>
          }
        </div>
        <div className="text-[11px] text-ink-3 mt-2">PDF o imagen · hasta 6 archivos</div>
      </div>

      {detected.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {detected.map((d, i) => (
            <div key={i} className="flex items-center justify-between p-2.5 rounded-lg border border-line bg-surface-2 text-[12px]">
              <div className="min-w-0 flex items-center gap-2">
                <div className="w-6 h-6 rounded flex items-center justify-center bg-brand-soft text-brand">
                  <Icon.File/>
                </div>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{d.fileName}</div>
                  <div className="truncate text-ink-3">
                    {d.ok
                      ? <>{d.tipo_documento ?? "documento"} · confianza {Math.round((d.confidence ?? 0) * 100)}%</>
                      : (d.error || "Error")}
                  </div>
                </div>
              </div>
              <Badge tone={d.ok ? "success" : "danger"}>{d.ok ? "OK" : "Error"}</Badge>
            </div>
          ))}
        </div>
      )}

      {notice && (
        <div className="mt-3 p-3 rounded-xl border border-[#d5e2ff] bg-[#eef4ff] text-[12px] text-[#2d4d94]">
          <Icon.Sparkles/> {notice}
        </div>
      )}
      {error && (
        <div className="mt-3 p-3 rounded-xl border border-[#f8c3cf] bg-[#fdeaef] text-[12px] text-[#9c2944]">
          {error}
        </div>
      )}
    </div>
  );
}

// ==========================================================================
// Ficha fiscal pública — toggle, slug, copiar link
// ==========================================================================
function PublicFichaCard({
  empresa, onChange
}: {
  empresa: Company;
  onChange: (c: Company) => void;
}) {
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgKind, setMsgKind] = useState<"info" | "error">("info");
  const [copied, setCopied] = useState(false);

  const enabled = Boolean((empresa as any).public_enabled);
  const slug = (empresa as any).public_slug as string | null;
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const url = slug ? `${base}/p/${slug}` : null;

  async function call(action: "enable" | "disable" | "regenerate") {
    setWorking(true); setMsg(null); setMsgKind("info");
    try {
      const r = await fetch("/api/company/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      onChange({ ...empresa, public_slug: d.slug, public_enabled: d.enabled } as any);
      setMsgKind("info");
      if (action === "enable")     setMsg("Ficha pública activada.");
      if (action === "disable")    setMsg("Ficha pública desactivada.");
      if (action === "regenerate") setMsg("Link regenerado. El anterior ya no funciona.");
    } catch (e: any) {
      setMsgKind("error");
      setMsg(e.message);
    } finally { setWorking(false); }
  }

  function copyUrl() {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="card p-6">
      <div className="flex items-start justify-between mb-3 gap-3">
        <div>
          <div className="sf-display text-[17px] font-semibold flex items-center gap-2">
            Ficha fiscal pública
            <Badge tone={enabled ? "success" : "pendiente"}>{enabled ? "Activa" : "Inactiva"}</Badge>
          </div>
          <div className="text-[12px] text-ink-3">
            Compartí datos fiscales y documentación de la empresa con un link público. Útil para trámites, bancos, proveedores.
          </div>
        </div>
      </div>

      {!enabled && (
        <>
          <div className="text-[13px] text-ink-2 mb-3">
            Al activar se genera una URL única. Solo se comparten: datos fiscales básicos, documentación societaria/fiscal/contable y DDJJ. <b>No</b> se comparten facturas, movimientos bancarios, integraciones ni credenciales.
          </div>
          <button className="btn btn-primary" onClick={() => call("enable")} disabled={working}>
            <Icon.Sparkles/> {working ? "Activando…" : "Activar ficha pública"}
          </button>
        </>
      )}

      {enabled && url && (
        <>
          <div className="mt-1">
            <div className="text-[11px] uppercase tracking-wider text-ink-3 mb-1">URL pública</div>
            <div className="flex items-center gap-2">
              <input className="input flex-1 font-mono text-[12px]" readOnly value={url}/>
              <button className="btn btn-ghost" onClick={copyUrl}>
                <Icon.Link/> {copied ? "Copiado" : "Copiar"}
              </button>
              <a className="btn btn-ghost" href={url} target="_blank" rel="noreferrer">
                <Icon.Download/> Abrir
              </a>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <button className="btn btn-ghost" onClick={() => call("regenerate")} disabled={working}>
              <Icon.Refresh/> Regenerar link
            </button>
            <button className="btn btn-ghost" onClick={() => call("disable")} disabled={working} style={{ color: "#f04f6f" }}>
              <Icon.Close/> Desactivar
            </button>
          </div>
          <div className="text-[11px] text-ink-3 mt-3">
            <b>Regenerar</b> invalida el link actual y crea uno nuevo — útil si por accidente lo compartiste con alguien que no debía verlo.
          </div>
        </>
      )}

      {msg && (
        <div className={`mt-3 p-2.5 rounded-lg text-[12px] ${
          msgKind === "error"
            ? "bg-[#fdeaef] text-[#9c2944] border border-[#f8c3cf]"
            : "bg-[#e6f6ed] text-[#176a4a]"
        }`}>
          {msg}
        </div>
      )}
    </div>
  );
}

function HealthTile({
  title, subtitle, configured, ok, detail, lines
}: {
  title: string;
  subtitle: string;
  configured: boolean | undefined;
  ok: boolean | undefined;
  detail: string | undefined;
  lines: [string, string][];
}) {
  const tone = ok ? "success" : configured ? "danger" : "pendiente";
  const label = ok ? "Conectado" : configured ? "Con error" : "Sin configurar";
  return (
    <div className="p-4 rounded-xl border border-line bg-surface-2">
      <div className="flex items-center justify-between mb-2">
        <div className="min-w-0 pr-2">
          <div className="text-[14px] font-semibold truncate">{title}</div>
          <div className="text-[12px] text-ink-3 truncate">{subtitle}</div>
        </div>
        <Badge tone={tone as any}>{label}</Badge>
      </div>
      {detail && (
        <div className="text-[12px] text-ink-2 mb-2 leading-snug">{detail}</div>
      )}
      <div className="space-y-1">
        {lines.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between text-[12px]">
            <span className="text-ink-3">{k}</span>
            <span className="font-mono truncate ml-2 max-w-[60%] text-right">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Card de gestion de Socios
// ============================================================================
function PartnersCard({
  partners, onAdded, onDeleted, onOpenAdd
}: {
  partners: PartnerRow[];
  onAdded: (p: PartnerRow) => void;
  onDeleted: (id: string) => void;
  onOpenAdd: () => void;
}) {
  async function deletePartner(id: string, nombre: string) {
    if (!confirm(`Eliminar al socio "${nombre}"? Los movimientos bancarios no se tocan.`)) return;
    const r = await fetch("/api/partners/delete", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id })
    });
    if (r.ok) onDeleted(id);
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div>
          <div className="sf-display text-[17px] font-semibold flex items-center gap-2">
            Socios y administradores
            <Badge tone={partners.length > 0 ? "success" : "pendiente"}>
              {partners.length} {partners.length === 1 ? "socio" : "socios"}
            </Badge>
          </div>
          <div className="text-[12px] text-ink-3">
            Cargá los CUITs y DNIs de los socios para identificar automaticamente sus movimientos bancarios (aportes / retiros de capital).
          </div>
        </div>
        <button className="btn btn-primary shrink-0" onClick={onOpenAdd}>
          <Icon.Plus/> Nuevo socio
        </button>
      </div>

      {partners.length === 0 ? (
        <div className="p-6 text-center text-[13px] text-ink-3 border border-dashed border-line rounded-xl">
          Todavia no cargaste socios. Al agregar el CUIT y DNI de cada socio,
          el sistema detecta automaticamente las transferencias bancarias hacia / desde ellos
          y calcula la cuenta particular (aportes vs retiros).
        </div>
      ) : (
        <table className="clean">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Relacion</th>
              <th>CUIT</th>
              <th>DNI</th>
              <th className="text-right">Participacion</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {partners.map(p => (
              <tr key={p.id}>
                <td className="font-medium">{p.nombre}</td>
                <td className="text-ink-2 capitalize">{p.relacion}</td>
                <td className="text-ink-2 font-mono text-[12px]">{p.cuit ? formatCuitDisplay(p.cuit) : "—"}</td>
                <td className="text-ink-2 font-mono text-[12px]">{p.dni ?? "—"}</td>
                <td className="text-right text-ink-2">{p.porcentaje ? `${p.porcentaje}%` : "—"}</td>
                <td className="text-right">
                  <button className="btn btn-ghost" style={{padding:"6px 10px", color: "#f04f6f"}}
                          onClick={() => deletePartner(p.id, p.nombre)}>
                    <Icon.Close/>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function formatCuitDisplay(c?: string | null) {
  if (!c) return "";
  const d = c.replace(/\D/g, "");
  if (d.length !== 11) return c;
  return `${d.slice(0,2)}-${d.slice(2,10)}-${d.slice(10)}`;
}

// ============================================================================
// Modal para agregar socio desde Settings
// ============================================================================
function AddPartnerSettingsModal({
  onClose, onCreated
}: { onClose: () => void; onCreated: (p: PartnerRow) => void }) {
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
            <div className="text-[12px] uppercase tracking-wider text-ink-3">Configuracion</div>
            <div className="sf-display text-[20px] font-semibold mt-1">Agregar socio</div>
            <div className="text-[12px] text-ink-3">Con el CUIT y DNI, detectamos sus movimientos bancarios automaticamente.</div>
          </div>
          <button className="btn btn-ghost" style={{padding:"6px 10px"}} onClick={onClose}><Icon.Close/></button>
        </div>

        <div className="space-y-3">
          <div>
            <div className="text-[11px] font-medium text-ink-2 mb-1">Nombre completo *</div>
            <input className="input" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej: Martin Tascione"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] font-medium text-ink-2 mb-1">CUIT</div>
              <input className="input" value={cuit} onChange={e => setCuit(e.target.value)} placeholder="20-44267590-3"/>
            </div>
            <div>
              <div className="text-[11px] font-medium text-ink-2 mb-1">DNI</div>
              <input className="input" value={dni} onChange={e => setDni(e.target.value)} placeholder="44267590"/>
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-ink-2 mb-1">Relacion</div>
            <select className="input" value={relacion} onChange={e => setRelacion(e.target.value)}>
              <option value="socio">Socio</option>
              <option value="administrador">Administrador</option>
              <option value="director">Director</option>
              <option value="apoderado">Apoderado</option>
              <option value="accionista">Accionista</option>
            </select>
          </div>
          <div>
            <div className="text-[11px] font-medium text-ink-2 mb-1">% Participacion (opcional)</div>
            <input className="input" value={porcentaje} onChange={e => setPorcentaje(e.target.value)} placeholder="Ej: 50"/>
          </div>
          <div>
            <div className="text-[11px] font-medium text-ink-2 mb-1">Observaciones</div>
            <textarea className="input" rows={2} value={observaciones} onChange={e => setObservaciones(e.target.value)}/>
          </div>

          {err && <div className="p-2.5 rounded-lg bg-[#fdeaef] text-[#9c2944] text-[12px]">{err}</div>}

          <div className="flex justify-end gap-2 mt-4">
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              <Icon.Check/> {saving ? "Guardando..." : "Guardar socio"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
