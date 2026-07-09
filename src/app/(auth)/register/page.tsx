"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BRAND, Logo } from "@/components/ui/Brand";

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin"|"contador">("admin");
  const [razon, setRazon] = useState("");
  const [cuit, setCuit] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const supabase = createClient();

    const { data: signUp, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: fullName, role } }
    });
    if (error || !signUp.user) { setLoading(false); setErr(error?.message ?? "No se pudo crear la cuenta."); return; }

    // Si el usuario quedó confirmado de inmediato, creamos la empresa y vinculamos el perfil.
    if (signUp.session) {
      const { data: company, error: cErr } = await supabase
        .from("companies")
        .insert({ razon_social: razon, cuit, owner_id: signUp.user.id })
        .select()
        .single();
      if (cErr) { setLoading(false); setErr(cErr.message); return; }

      await supabase
        .from("profiles")
        .update({ company_id: company.id, role })
        .eq("id", signUp.user.id);

      router.push("/dashboard");
      router.refresh();
    } else {
      setLoading(false);
      setErr("Revisá tu correo para confirmar la cuenta antes de iniciar sesión.");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6"
         style={{ background: "radial-gradient(1200px 600px at 50% -10%, #e8f1fd 0%, #f5f5f7 60%)" }}>
      <div className="w-full max-w-lg fade-in">
        <div className="flex items-center justify-center mb-6">
          <Logo size="lg" subtitle={BRAND.tagline} />
        </div>
        <div className="card soft p-8">
          <div className="sf-display text-[22px] font-semibold mb-1">Crear cuenta</div>
          <div className="text-[13px] text-ink-2">Empezá con tu empresa en menos de un minuto.</div>
          <form onSubmit={onSubmit} className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="text-[12px] font-medium text-ink-2">Tu nombre</label>
              <input className="input mt-1" required value={fullName} onChange={e=>setFullName(e.target.value)} />
            </div>
            <div>
              <label className="text-[12px] font-medium text-ink-2">Email</label>
              <input className="input mt-1" type="email" required value={email} onChange={e=>setEmail(e.target.value)} />
            </div>
            <div>
              <label className="text-[12px] font-medium text-ink-2">Contraseña</label>
              <input className="input mt-1" type="password" required minLength={8} value={password} onChange={e=>setPassword(e.target.value)} />
            </div>
            <div className="md:col-span-2 divider mt-2" />
            <div>
              <label className="text-[12px] font-medium text-ink-2">Razón social</label>
              <input className="input mt-1" required value={razon} onChange={e=>setRazon(e.target.value)} />
            </div>
            <div>
              <label className="text-[12px] font-medium text-ink-2">CUIT</label>
              <input className="input mt-1" required value={cuit} onChange={e=>setCuit(e.target.value)} placeholder="30-71234567-8" />
            </div>
            <div className="md:col-span-2">
              <label className="text-[12px] font-medium text-ink-2">Tu perfil</label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {[{k:"admin",t:"Administrador",s:"Acceso total"},{k:"contador",t:"Contador",s:"Carga y reportes"}].map(r=>(
                  <button type="button" key={r.k} onClick={()=>setRole(r.k as any)}
                          className={`text-left p-3 rounded-xl border transition ${role===r.k ? "border-brand bg-brand-soft" : "border-line bg-white hover:bg-[#fafafb]"}`}>
                    <div className="text-[13px] font-semibold">{r.t}</div>
                    <div className="text-[11px] text-ink-2">{r.s}</div>
                  </button>
                ))}
              </div>
            </div>
            {err && <div className="md:col-span-2 text-[13px] text-danger">{err}</div>}
            <button className="btn btn-primary md:col-span-2 justify-center" disabled={loading}>
              {loading ? "Creando…" : "Crear cuenta"}
            </button>
          </form>
          <div className="divider my-5" />
          <div className="text-center text-[13px] text-ink-2">
            ¿Ya tenés cuenta? <Link className="link" href="/login">Iniciar sesión</Link>
          </div>
        </div>
        <div className="text-center text-[11px] mt-6 text-ink-3">{BRAND.copyright}</div>
      </div>
    </div>
  );
}
