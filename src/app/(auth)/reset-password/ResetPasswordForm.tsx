"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BRAND, Logo } from "@/components/ui/Brand";

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        setErr("El enlace de recuperación venció o no es válido. Pedí uno nuevo.");
      }
      setReady(true);
    });
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) { setErr("La contraseña debe tener al menos 8 caracteres."); return; }
    if (password !== confirm) { setErr("Las contraseñas no coinciden."); return; }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setDone(true);
    setTimeout(() => {
      router.push("/dashboard");
      router.refresh();
    }, 1500);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6"
         style={{ background: "radial-gradient(1200px 600px at 50% -10%, #e8f1fd 0%, #f5f5f7 60%)" }}>
      <div className="w-full max-w-md fade-in">
        <div className="flex items-center justify-center mb-8">
          <Logo size="lg" subtitle={BRAND.tagline} />
        </div>
        <div className="card soft p-8">
          <div className="sf-display text-[22px] font-semibold mb-1">Nueva contraseña</div>
          <div className="text-[13px] text-ink-2">Elegí una contraseña segura para tu cuenta.</div>

          {!ready ? (
            <div className="mt-6 text-[13px] text-ink-3">Verificando enlace…</div>
          ) : done ? (
            <div className="mt-6 rounded-xl border border-line bg-brand-soft p-4 text-[13px] text-ink-1">
              Contraseña actualizada. Redirigiendo…
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div>
                <label className="text-[12px] font-medium text-ink-2">Nueva contraseña</label>
                <input className="input mt-1" type="password" required minLength={8}
                       value={password} onChange={(e)=>setPassword(e.target.value)}
                       placeholder="Mínimo 8 caracteres" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-ink-2">Confirmar contraseña</label>
                <input className="input mt-1" type="password" required minLength={8}
                       value={confirm} onChange={(e)=>setConfirm(e.target.value)}
                       placeholder="Repetí la contraseña" />
              </div>
              {err && <div className="text-[13px] text-danger">{err}</div>}
              <button className="btn btn-primary w-full justify-center" disabled={loading}>
                {loading ? "Guardando…" : "Guardar nueva contraseña"}
              </button>
            </form>
          )}

          <div className="divider my-5" />
          <div className="text-center text-[13px] text-ink-2">
            <Link className="link" href="/login">Volver al inicio de sesión</Link>
          </div>
        </div>
        <div className="text-center text-[11px] mt-6 text-ink-3">{BRAND.copyright}</div>
      </div>
    </div>
  );
}
