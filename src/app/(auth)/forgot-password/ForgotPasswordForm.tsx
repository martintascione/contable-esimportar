"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BRAND, Logo } from "@/components/ui/Brand";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);

    const supabase = createClient();
    // Usamos window.location.origin dinámicamente para que funcione bien
    // sin importar el dominio (localhost, vercel.app, contable.esimportar.com)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`
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
          {!sent ? (
            <>
              <div className="sf-display text-[22px] font-semibold mb-1">Recuperar contraseña</div>
              <div className="text-[13px] text-ink-2">
                Ingresá tu email y te enviamos un link para elegir una nueva contraseña.
              </div>
              <form onSubmit={onSubmit} className="mt-6 space-y-4">
                <div>
                  <label className="text-[12px] font-medium text-ink-2">Correo electrónico</label>
                  <input className="input mt-1" type="email" required value={email}
                         onChange={(e) => setEmail(e.target.value)} placeholder="tu@empresa.com" />
                </div>
                {err && <div className="text-[13px] text-danger">{err}</div>}
                <button className="btn btn-primary w-full justify-center" disabled={loading}>
                  {loading ? "Enviando…" : "Enviar link de recuperación"}
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="sf-display text-[22px] font-semibold mb-1">Revisá tu correo</div>
              <div className="text-[13px] text-ink-2 leading-relaxed">
                Enviamos un link a <b className="text-ink-1">{email}</b>.
                Abrilo dentro de la próxima hora para elegir tu nueva contraseña.
                Si no lo ves, revisá la carpeta de spam.
              </div>
            </>
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