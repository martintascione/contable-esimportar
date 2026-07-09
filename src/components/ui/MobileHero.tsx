"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./Icons";
import { Badge } from "./Badge";
import { money } from "@/lib/format";

type CompanyEntry = {
  id: string;
  role: "admin" | "contador";
  company: { id: string; razon_social: string; cuit: string };
};

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

/**
 * Hero principal mobile: chips de empresas, posición IVA del mes, botón "Subir factura".
 * Solo visible en pantallas chicas (md:hidden).
 */
export function MobileHero({
  invoices,
  onUploaded
}: {
  invoices: { fecha: string; tipo: "venta" | "compra"; iva_total: number; neto_gravado: number }[];
  onUploaded?: () => void;
}) {
  const router = useRouter();
  const [companies, setCompanies] = useState<CompanyEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Cargar empresas
  useEffect(() => {
    fetch("/api/company/list", { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        if (d.companies) {
          setCompanies(d.companies);
          setActiveId(d.activeCompanyId);
        }
      }).catch(() => {});
  }, []);

  async function switchTo(companyId: string) {
    if (companyId === activeId || switching) return;
    setSwitching(true);
    try {
      const r = await fetch("/api/company/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ company_id: companyId })
      });
      if (r.ok) {
        setActiveId(companyId);
        window.location.reload();
      }
    } finally { setSwitching(false); }
  }

  // KPIs del mes en curso
  const snapshot = useMemo(() => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const month = invoices.filter(i => i.fecha?.startsWith(ym));
    const debito  = month.filter(i => i.tipo === "venta").reduce((a, b) => a + Number(b.iva_total ?? 0), 0);
    const credito = month.filter(i => i.tipo === "compra").reduce((a, b) => a + Number(b.iva_total ?? 0), 0);
    return {
      label: `${MESES[now.getMonth()]} ${now.getFullYear()}`,
      debito, credito,
      saldo: debito - credito,
      cantidad: month.length
    };
  }, [invoices]);

  return (
    <>
      <div className="md:hidden space-y-3 mb-3">
        {/* === 1) Selector de empresas en chips === */}
        {companies.length > 0 && (
          <div className="overflow-x-auto scroll-clean -mx-4 px-4">
            <div className="flex gap-2 pb-1">
              {companies.map(c => {
                const isActive = c.id === activeId;
                return (
                  <button
                    key={c.id}
                    onClick={() => switchTo(c.id)}
                    disabled={switching}
                    className={[
                      "flex items-center gap-2 px-3 py-2 rounded-2xl shrink-0 transition",
                      "border-2 bg-white",
                      isActive ? "border-[var(--accent)]" : "border-line"
                    ].join(" ")}
                    style={isActive ? { boxShadow: "0 0 0 4px var(--accent-soft)" } : undefined}
                  >
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-[12px] font-bold shrink-0"
                         style={{ background: "linear-gradient(135deg,#0071e3,#54a0ff)" }}>
                      {initials(c.company.razon_social)}
                    </div>
                    <div className="text-left min-w-0">
                      <div className={`text-[12px] truncate max-w-[160px] ${isActive ? "font-bold text-[var(--accent)]" : "font-semibold text-ink-1"}`}>
                        {c.company.razon_social}
                      </div>
                      <div className="text-[10px] text-ink-3 truncate font-mono">
                        {c.company.cuit}
                      </div>
                    </div>
                    {isActive && <Icon.Check />}
                  </button>
                );
              })}
              {/* Botón crear nueva empresa */}
              <a href="/settings"
                 className="flex items-center justify-center gap-1 px-4 py-2 rounded-2xl border-2 border-dashed border-line text-ink-3 hover:border-[var(--accent)] hover:text-[var(--accent)] shrink-0 text-[12px] font-medium">
                <Icon.Plus/> Nueva
              </a>
            </div>
          </div>
        )}

        {/* === 2) Mini snapshot del mes en curso === */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-3">Tu posición IVA</div>
              <div className="sf-display text-[16px] font-bold mt-0.5">{snapshot.label}</div>
            </div>
            <Badge tone={snapshot.cantidad > 0 ? "info" : "pendiente"}>
              {snapshot.cantidad} facturas
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <KpiBox
              label="IVA Débito"
              value={money(snapshot.debito)}
              hint="Ventas"
              tone="positive"
            />
            <KpiBox
              label="IVA Crédito"
              value={money(snapshot.credito)}
              hint="Compras"
              tone="info"
            />
          </div>
          <div className="mt-3 pt-3 border-t border-line flex items-center justify-between">
            <div className="text-[12px] text-ink-2">
              {snapshot.saldo >= 0 ? "Saldo a pagar" : "Saldo a favor"}
            </div>
            <div className="sf-display text-[20px] font-bold"
                 style={{ color: snapshot.saldo >= 0 ? "#f04f6f" : "#30a46c" }}>
              {money(Math.abs(snapshot.saldo))}
            </div>
          </div>
        </div>

        {/* === 3) Botón grande "Subir factura" === */}
        <button
          onClick={() => setSheetOpen(true)}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-white font-bold text-[16px] active:scale-[0.98] transition-transform"
          style={{
            background: "linear-gradient(135deg,#0071e3,#54a0ff)",
            boxShadow: "0 8px 24px rgba(0,113,227,0.35)"
          }}
        >
          <Icon.Camera /> Subir factura
        </button>
      </div>

      {/* Bottom sheet con opciones */}
      {sheetOpen && (
        <UploadInvoiceSheet onClose={() => setSheetOpen(false)} onDone={() => { setSheetOpen(false); onUploaded?.(); router.refresh(); }} />
      )}
    </>
  );
}

function KpiBox({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: "positive" | "info" }) {
  const colors = tone === "positive"
    ? { bg: "#e6f6ed", text: "#176a4a" }
    : { bg: "#e8f1fd", text: "#0062c2" };
  return (
    <div className="rounded-xl p-3" style={{ background: colors.bg, color: colors.text }}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="sf-display text-[18px] font-bold mt-0.5 leading-tight">{value}</div>
      <div className="text-[10px] mt-0.5 opacity-70">{hint}</div>
    </div>
  );
}

function initials(name?: string | null) {
  if (!name) return "–";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase() ?? "").join("") || name[0]?.toUpperCase() || "?";
}

// ============================================================================
// Bottom sheet con opciones de subida
// ============================================================================
function UploadInvoiceSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [stage, setStage] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function processFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true); setErr(null);
    try {
      for (let i = 0; i < files.length; i++) {
        setStage(files.length > 1 ? `Procesando ${i + 1} de ${files.length}…` : "Procesando con IA…");
        const fd = new FormData();
        fd.append("file", files[i]);
        const r = await fetch("/api/ingest/invoice", { method: "POST", body: fd });
        if (!r.ok) {
          const e = await r.json().catch(() => ({ error: "Error" }));
          throw new Error(e.error ?? "Fallo procesando " + files[i].name);
        }
      }
      setStage("¡Listo!");
      setTimeout(() => { setUploading(false); onDone(); }, 600);
    } catch (e: any) {
      setErr(e.message);
      setUploading(false);
    }
  }

  return (
    <>
      <div className="modal-back md:hidden" onClick={uploading ? undefined : onClose} />
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl z-50 fade-in" style={{ boxShadow: "0 -8px 24px rgba(0,0,0,0.2)" }}>
        <div className="w-12 h-1 bg-line rounded-full mx-auto mt-3" />
        <div className="p-5">
          {!uploading ? (
            <>
              <div className="sf-display text-[18px] font-bold mb-1">Subir factura</div>
              <div className="text-[12px] text-ink-3 mb-4">¿De dónde la querés cargar?</div>

              <div className="space-y-2">
                <SheetButton
                  icon={<Icon.Camera/>}
                  title="Sacar foto"
                  desc="Abrir la cámara y fotografiar la factura"
                  primary
                  onClick={() => cameraRef.current?.click()}
                />
                <SheetButton
                  icon={<Icon.Upload/>}
                  title="Subir desde galería"
                  desc="Elegir foto/imagen del rollo"
                  onClick={() => galleryRef.current?.click()}
                />
                <SheetButton
                  icon={<Icon.File/>}
                  title="Subir desde archivos"
                  desc="PDF u otros archivos del dispositivo"
                  onClick={() => filesRef.current?.click()}
                />
              </div>

              {err && (
                <div className="mt-3 p-2.5 rounded-lg bg-[#fdeaef] text-[#9c2944] text-[12px]">{err}</div>
              )}

              <button onClick={onClose} className="w-full mt-4 py-3 text-[14px] text-ink-2 font-medium">
                Cancelar
              </button>
            </>
          ) : (
            <div className="py-8 text-center">
              <div className="w-14 h-14 mx-auto rounded-full flex items-center justify-center text-white mb-3"
                   style={{ background: "linear-gradient(135deg,#0071e3,#54a0ff)" }}>
                <Spinner/>
              </div>
              <div className="sf-display text-[16px] font-bold">{stage}</div>
              <div className="text-[12px] text-ink-3 mt-1">No cierres la app</div>
            </div>
          )}
        </div>

        <input ref={cameraRef}  type="file" accept="image/*" capture="environment" hidden
               onChange={e => { processFiles(e.target.files); e.target.value = ""; }} />
        <input ref={galleryRef} type="file" accept="image/*" multiple hidden
               onChange={e => { processFiles(e.target.files); e.target.value = ""; }} />
        <input ref={filesRef}   type="file" accept="application/pdf,image/*" multiple hidden
               onChange={e => { processFiles(e.target.files); e.target.value = ""; }} />
      </div>
    </>
  );
}

function SheetButton({ icon, title, desc, onClick, primary }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-4 rounded-2xl border-2 transition active:scale-[0.98]"
      style={primary
        ? { background: "var(--accent)", borderColor: "var(--accent)", color: "white" }
        : { background: "var(--surface-2)", borderColor: "var(--line)", color: "var(--text)" }}
    >
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
           style={primary ? { background: "rgba(255,255,255,0.2)" } : { background: "var(--accent-soft)", color: "var(--accent)" }}>
        {icon}
      </div>
      <div className="text-left min-w-0 flex-1">
        <div className="font-semibold text-[15px]">{title}</div>
        <div className={`text-[12px] ${primary ? "opacity-85" : "text-ink-3"}`}>{desc}</div>
      </div>
      <Icon.Chevron/>
    </button>
  );
}

function Spinner() {
  return (
    <svg width={28} height={28} viewBox="0 0 24 24" fill="none" className="animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25"/>
      <path d="M21 12a9 9 0 0 1-9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
}
