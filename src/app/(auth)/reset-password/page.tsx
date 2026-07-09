import { Suspense } from "react";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-ink-3 text-[13px]">Cargando…</div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
