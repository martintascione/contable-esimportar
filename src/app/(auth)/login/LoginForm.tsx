"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BRAND, Logo } from "@/components/ui/Brand";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    router.push(params.get("redirect") ?? "/dashboard");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6"
         style={{ background: "radial-gradient(1200px 600px at 50% -10%, #e8f1fd 0%, #f5f5f7 60%)" }}>
      <div className="w-full max-w-md fade-in">
        <div className="flex items-center justify-center mb-8">
          <Logo size="lg" subtitle={BRAND.tagline} />
        </div>
        <div className="card soft p-8">
          <div className="sf-display text-[22px] font-semibold mb-1">Iniciar sesión</div>
          <div className="text-[13px] text-ink-2">Accedé a tu panel contable inteligente.</div>
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label className="text-[12px] font-medium text-ink-2">Correo electrónico</label>
              <input className="input mt-1" type="email" required value={email}
                     onChange={(e)=>setEmail(e.target.value)} placeholder="tu@empresa.com" />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-[12px] font-medium text-ink-2">Contraseña</label>
                <Link className="link text-[12px]" href="/forgot-password">¿Olvidaste tu contraseña?</Link>
              </div>
              <input className="input mt-1" type="password" required value={password}
                     onChange={(e)=>setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            {err && <div className="text-[13px] text-danger">{err}</div>}
            <button className="btn btn-primary w-full justify-center" disabled={loading}>
              {loading ? "Ingresando…" : "Ingresar"}
            </button>
          </form>
          <div className="divider my-5" />
          <div className="text-center text-[13px] text-ink-2">
            ¿Todavía no tenés cuenta?{" "}
            <Link className="link" href="/register">Crear cuenta</Link>
          </div>
        </div>
        <div className="text-center text-[11px] mt-6 text-ink-3">{BRAND.copyright}</div>
      </div>
    </div>
  );
}
