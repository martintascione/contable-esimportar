"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { Badge } from "@/components/ui/Badge";
import { BRAND, Logo } from "@/components/ui/Brand";

type Creds = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  anthropicKey: string;
  anthropicModel: string;
};

type CheckState = { ok: boolean; message: string } | null;
type Validation = {
  supabase: CheckState;
  supabaseTables: CheckState;
  supabaseStorage: CheckState;
  anthropic: CheckState;
};

export function SetupWizard({ initial }: { initial: Creds }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [creds, setCreds] = useState<Creds>(initial);
  const [validation, setValidation] = useState<Validation>({
    supabase: null, supabaseTables: null, supabaseStorage: null, anthropic: null
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ saved: boolean; message: string; envText?: string } | null>(null);

  async function runValidation() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/setup/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(creds)
      });
      const data = await r.json();
      setValidation(data);
    } catch (e: any) {
      setErr(e.message);
    } finally { setBusy(false); }
  }

  async function saveCreds() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/setup/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(creds)
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Fallo al guardar");
      setSaved(data);
      setStep(4);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  const supabaseReady = validation.supabase?.ok && validation.supabaseTables?.ok;
  const anthropicReady = validation.anthropic?.ok;
  const allReady = supabaseReady && anthropicReady;

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="mb-8">
        <Logo size="lg" subtitle={BRAND.company} />
        <div className="sf-display text-[34px] font-bold tracking-tight mt-5">Configuración inicial</div>
        <div className="text-ink-2 text-[15px]">
          Conectá tu {BRAND.fullName} en 3 pasos. No vas a tener que tocar archivos a mano.
        </div>
      </div>

      <Stepper step={step} />

      {step === 1 && (
        <Card>
          <H>1 · Datos de Supabase</H>
          <P>
            Entrá a <a className="link" href="https://app.supabase.com" target="_blank" rel="noreferrer">app.supabase.com</a>{" "}
            → tu proyecto → <b>Settings · API</b>. Copiá los 3 campos de ahí.
          </P>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <Field label="Project URL"
              placeholder="https://xxxx.supabase.co"
              value={creds.supabaseUrl}
              onChange={v => setCreds({ ...creds, supabaseUrl: v })} />
            <div className="md:col-span-2">
              <Field label="anon public key" secret
                placeholder="eyJhbGci..."
                value={creds.anonKey}
                onChange={v => setCreds({ ...creds, anonKey: v })} />
            </div>
            <div className="md:col-span-2">
              <Field label="service_role key (secreta)" secret
                placeholder="eyJhbGci..."
                value={creds.serviceRoleKey}
                onChange={v => setCreds({ ...creds, serviceRoleKey: v })} />
            </div>
          </div>
          <Note>
            ¿Todavía no ejecutaste el SQL de migración? Copiá{" "}
            <code className="code">supabase/migrations/0001_initial_schema.sql</code>{" "}
            y pegalo en <b>SQL Editor</b> de Supabase. Crea tablas, RLS y buckets.
          </Note>
          <Footer>
            <button className="btn btn-primary" onClick={() => setStep(2)}
              disabled={!creds.supabaseUrl || !creds.anonKey || !creds.serviceRoleKey}>
              Siguiente <Icon.Chevron/>
            </button>
          </Footer>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <H>2 · API key de Claude (Anthropic)</H>
          <P>
            Entrá a <a className="link" href="https://console.anthropic.com" target="_blank" rel="noreferrer">console.anthropic.com</a>{" "}
            → <b>API Keys</b> → <b>Create key</b>. Pegala acá, nunca se expone en el navegador.
          </P>
          <div className="space-y-4 mt-4">
            <Field label="ANTHROPIC_API_KEY" secret
              placeholder="sk-ant-api03-..."
              value={creds.anthropicKey}
              onChange={v => setCreds({ ...creds, anthropicKey: v })} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-[12px] font-medium text-ink-2 mb-1">Modelo</div>
                <select className="input"
                  value={creds.anthropicModel}
                  onChange={e => setCreds({ ...creds, anthropicModel: e.target.value })}>
                  <option value="claude-sonnet-4-5">claude-sonnet-4-5 (recomendado)</option>
                  <option value="claude-opus-4-6">claude-opus-4-6 (máxima precisión)</option>
                  <option value="claude-haiku-4-5-20251001">claude-haiku-4-5 (rápido, más barato)</option>
                </select>
              </div>
            </div>
          </div>
          <Footer>
            <button className="btn btn-ghost" onClick={() => setStep(1)}>Atrás</button>
            <button className="btn btn-primary" onClick={() => { setStep(3); runValidation(); }}
              disabled={!creds.anthropicKey}>
              Probar conexión <Icon.Chevron/>
            </button>
          </Footer>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <H>3 · Probando credenciales</H>
          <P>Hago un ping real a Supabase y a la API de Claude para validar antes de guardar.</P>
          <div className="mt-4 space-y-2">
            <CheckRow title="Supabase — proyecto accesible" state={validation.supabase} />
            <CheckRow title="Supabase — tablas (migración SQL)" state={validation.supabaseTables} />
            <CheckRow title="Supabase — Storage buckets" state={validation.supabaseStorage} />
            <CheckRow title="Claude — API key válida" state={validation.anthropic} />
          </div>
          {err && <div className="mt-3 text-danger text-[13px]">{err}</div>}
          <Footer>
            <button className="btn btn-ghost" onClick={() => setStep(2)}>Atrás</button>
            <button className="btn btn-ghost" onClick={runValidation} disabled={busy}>
              {busy ? "Probando..." : "Reintentar"}
            </button>
            <button className="btn btn-primary" onClick={saveCreds}
              disabled={busy || !supabaseReady || !anthropicReady}>
              {busy ? "Guardando..." : "Guardar y terminar"}
            </button>
          </Footer>
          {!allReady && !busy && (validation.supabase || validation.anthropic) && (
            <Note tone="warn">
              Podés guardar igual si algún check rojo ya lo tenés resuelto por afuera (por ejemplo,
              variables cargadas en Vercel). Pero lo ideal es que todo esté en verde.
            </Note>
          )}
        </Card>
      )}

      {step === 4 && saved && (
        <Card>
          <H>✓ Configuración lista</H>
          <P>{saved.message}</P>
          {saved.saved ? (
            <>
              <Note>
                Reiniciá el servidor de desarrollo (<code className="code">Ctrl+C</code> y{" "}
                <code className="code">npm run dev</code>) y entrá al{" "}
                <a className="link" href="/login">login</a> para crear tu cuenta de administrador.
              </Note>
              <Footer>
                <a className="btn btn-primary" href="/login">Ir al login</a>
              </Footer>
            </>
          ) : (
            <>
              <Note tone="warn">
                No se pudo escribir <code className="code">.env.local</code> (posiblemente estás
                en producción). Copiá este bloque y pegálo en las variables de entorno de tu proveedor:
              </Note>
              <pre className="mt-3 p-4 rounded-xl bg-[#0b0b0e] text-[#dcdce4] text-[12px] overflow-auto">
                {saved.envText}
              </pre>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="card p-7 mt-5">{children}</div>;
}
function H({ children }: { children: React.ReactNode }) {
  return <div className="sf-display text-[22px] font-bold tracking-tight mb-1">{children}</div>;
}
function P({ children }: { children: React.ReactNode }) {
  return <div className="text-[14px] text-ink-2 leading-relaxed">{children}</div>;
}
function Footer({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-2 justify-end mt-6">{children}</div>;
}
function Note({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" }) {
  const cls = tone === "warn"
    ? "bg-[#fff4e5] border-[#ffd9a8] text-[#8a5a10]"
    : "bg-[#eef4ff] border-[#d5e2ff] text-[#2d4d94]";
  return (
    <div className={`mt-4 p-3 rounded-xl border ${cls} text-[13px] leading-relaxed`}>
      {children}
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, secret
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; secret?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[12px] font-medium text-ink-2">{label}</div>
        {secret && (
          <button type="button" className="text-[11px] text-ink-3 hover:text-ink-1"
            onClick={() => setShow(s => !s)}>
            {show ? "Ocultar" : "Mostrar"}
          </button>
        )}
      </div>
      <input
        className="input"
        type={secret && !show ? "password" : "text"}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}

function CheckRow({ title, state }: { title: string; state: CheckState }) {
  const tone = state == null ? "pendiente" : state.ok ? "success" : "danger";
  const label = state == null ? "Probando…" : state.ok ? "OK" : "Error";
  return (
    <div className="flex items-center justify-between p-3 rounded-xl border border-line bg-surface-2">
      <div className="min-w-0 pr-3">
        <div className="text-[14px] font-semibold truncate">{title}</div>
        <div className="text-[12px] text-ink-3 truncate">
          {state ? state.message : "Ejecutando prueba..."}
        </div>
      </div>
      <Badge tone={tone as any}>{label}</Badge>
    </div>
  );
}

function Stepper({ step }: { step: 1 | 2 | 3 | 4 }) {
  const labels = ["Supabase", "Claude", "Probar", "Listo"];
  return (
    <div className="flex items-center gap-2 mb-2">
      {labels.map((l, i) => {
        const n = (i + 1) as 1 | 2 | 3 | 4;
        const done = n < step;
        const active = n === step;
        return (
          <div key={l} className="flex items-center gap-2">
            <div className={[
              "w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-semibold",
              done ? "bg-[#22c55e] text-white" :
              active ? "bg-ink-1 text-white" :
              "bg-surface-2 text-ink-3 border border-line"
            ].join(" ")}>
              {done ? "✓" : n}
            </div>
            <div className={active ? "text-[13px] font-semibold" : "text-[13px] text-ink-3"}>{l}</div>
            {i < 3 && <div className="w-8 h-px bg-line mx-1" />}
          </div>
        );
      })}
    </div>
  );
}
