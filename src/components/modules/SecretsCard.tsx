"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icons";

type SecretRow = {
  key: string; label: string; group: string; desc: string; secret: boolean; placeholder?: string;
  source: "env" | "db" | "none"; preview: string | null; updated_at: string | null;
};

/**
 * Configuración → APIs y secrets.
 * Los valores se guardan cifrados en la base (app_secrets). Si la misma clave existe
 * como variable de entorno del servidor, esa tiene prioridad y acá se muestra como "Entorno".
 */
export function SecretsCard() {
  const [rows, setRows] = useState<SecretRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [encryption, setEncryption] = useState<boolean | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/secrets", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo cargar");
      setRows(j.secrets); setEncryption(j.encryption);
    } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function save(key: string) {
    if (!value.trim()) return;
    setSaving(true); setErr(null);
    try {
      const r = await fetch("/api/secrets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar");
      setEditing(null); setValue(""); setShow(false);
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }
  async function remove(key: string) {
    if (!confirm("¿Borrar este valor guardado?")) return;
    await fetch(`/api/secrets?key=${key}`, { method: "DELETE" });
    await load();
  }

  const groups = rows ? [...new Set(rows.map(r => r.group))] : [];

  return (
    <div className="card p-6" id="apis">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="sf-display text-[17px] font-semibold">APIs y secrets</div>
          <div className="text-[12px] text-ink-3">Credenciales de Meta Ads, IA e integraciones. Se guardan cifradas y solo las usa el servidor.</div>
        </div>
        <button className="btn btn-ghost" onClick={load}><Icon.Refresh /> Actualizar</button>
      </div>
      {encryption === false && (
        <div className="text-[12px] mt-2 p-3 rounded-xl bg-warn-soft text-warn">
          Cifrado con clave derivada. Para máxima seguridad definí <code>APP_ENCRYPTION_KEY</code> en el servidor (<code>openssl rand -hex 32</code>) antes de cargar secrets.
        </div>
      )}
      {err && <div className="text-[13px] text-danger mt-3">{err}</div>}
      {!rows && !err && <div className="text-[13px] text-ink-3 py-6 text-center">Cargando…</div>}

      {groups.map(g => (
        <div key={g} className="mt-5">
          <div className="text-[12px] font-medium uppercase tracking-wider text-ink-3 mb-2">{g}</div>
          <div className="space-y-2">
            {rows!.filter(r => r.group === g).map(r => {
              const isEditing = editing === r.key;
              return (
                <div key={r.key} className="p-4 rounded-xl border border-line bg-surface-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-[14px] font-semibold">{r.label}</div>
                        <code className="text-[11px] text-ink-3">{r.key}</code>
                        {r.source === "env" && <Badge tone="info">Entorno</Badge>}
                        {r.source === "db" && <Badge tone="success">Guardado</Badge>}
                        {r.source === "none" && <Badge tone="pendiente">Sin configurar</Badge>}
                      </div>
                      <div className="text-[12px] text-ink-2 mt-0.5">{r.desc}</div>
                      {r.preview && <div className="text-[12px] font-mono text-ink-3 mt-1 truncate">{r.preview}</div>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {r.source !== "env" && !isEditing && (
                        <button className="btn btn-ghost" style={{ padding: "6px 12px" }} onClick={() => { setEditing(r.key); setValue(""); setShow(!r.secret); }}>
                          {r.source === "db" ? "Cambiar" : "Cargar"}
                        </button>
                      )}
                      {r.source === "db" && !isEditing && (
                        <button className="btn btn-ghost" style={{ padding: "6px 8px" }} title="Borrar" onClick={() => remove(r.key)}><Icon.Trash /></button>
                      )}
                    </div>
                  </div>
                  {r.source === "env" && <div className="text-[11px] text-ink-3 mt-2">Definido como variable de entorno del servidor; para cambiarlo editá el entorno (Vercel / .env.local).</div>}
                  {isEditing && (
                    <div className="mt-3 flex flex-col md:flex-row gap-2">
                      <div className="relative flex-1">
                        <input
                          className="input pr-10 font-mono text-[13px]"
                          type={show ? "text" : "password"}
                          autoComplete="off"
                          placeholder={r.placeholder ?? (r.secret ? "Pegá el valor" : "Valor")}
                          value={value}
                          onChange={e => setValue(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") save(r.key); if (e.key === "Escape") setEditing(null); }}
                          autoFocus
                        />
                        {r.secret && (
                          <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink" onClick={() => setShow(s => !s)} title={show ? "Ocultar" : "Mostrar"}><Icon.Eye /></button>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancelar</button>
                        <button className="btn btn-primary" onClick={() => save(r.key)} disabled={saving || !value.trim()}>{saving ? "Guardando…" : "Guardar"}</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
