import { Suspense } from "react";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-ink-3 text-[13px]">Cargando…</div>}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
