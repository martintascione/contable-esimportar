import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-ink-3 text-[13px]">Cargando…</div>}>
      <LoginForm />
    </Suspense>
  );
}
