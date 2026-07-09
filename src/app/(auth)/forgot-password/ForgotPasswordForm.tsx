"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BRAND, Logo } from "@/components/ui/Brand";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`
    });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setSent(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6"
         style={{ background: "radial-gradient(1200px 600px at 50% -10%, #e8f1fd 0%, #f5f5f7 60%)" }}>
      <div className="w-full max-w-md fade-in">
        <div className="flex items-center justify-center mb-8">
          <Logo size="lg" subtitle={BRAND.tagline} />
        </div>
        <div className="card soft p-8">
          <div className="sf-display text-[22px] font-semibold mb-1">Recuperar contraseña</div>
          <div className="text-[13px] text-ink-2">
            Ingresá el correo asociado a tu cuenta y te enviamos un enlace para restablecerla.
          </div>

          {sent ? (
            <div className="mt-6 space-y-4">
              <div className="rounded-xl border border-line bg-brand-soft p-4 text-[13px] text-ink-1">
                Listo. Si <span className="font-medium">{email}</span> está registrado, vas a recibir
                un correo con el enlace de recuperación en los próximos minutos. Revisá también la
                carpeta de spam.
              </div>
              <Link href="/login" className="btn btn-primary w-full justify-center">
                Volver al inicio de sesión
              </Link>
            </div>
          ) : (
            <>
              <form onSubmit={onSubmit} className="mt-6 space-y-4">
                <div>
                  <label className="text-[12px] font-medium text-ink-2">Correo electrónico</label>
                  <input className="input mt-1" type="email" required value={email}
                         onChange={(e)=>setEmail(e.target.value)} placeholder="tu@empresa.com" />
                </div>
                {err && <div className="text-[13px] text-danger">{err}</div>}
                <button className="btn btn-primary w-full justify-center" disabled={loading}>
                  {loading ? "Enviando…" : "Enviar enlace de recuperación"}
                </button>
              </form>
              <div className="divider my-5" />
              <div className="text-center text-[13px] text-ink-2">
                <Link className="link" href="/login">Volver al inicio de sesión</Link>
              </div>
            </>
          )}
        </div>
        <div className="text-center text-[11px] mt-6 text-ink-3">{BRAND.copyright}</div>
      </div>
    </div>
  );
}
