"use client";

import { useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "./Icons";

/**
 * Floating Action Button para capturar facturas con la cámara del móvil.
 * Visible solo en pantallas chicas (mobile/tablet).
 * En /dashboard se oculta porque el Hero ya tiene un botón grande de subida.
 *
 * Usa el atributo capture="environment" del input file → en móviles abre
 * directamente la cámara trasera. En desktop, abre el selector de archivos.
 */
export function CameraFab() {
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string>("");
  const [done, setDone] = useState<{ ok: boolean; msg: string } | null>(null);

  // En /dashboard ya hay un botón grande "Subir factura" en el Hero — evitamos duplicar.
  if (pathname?.startsWith("/dashboard")) return null;

  async function handle(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true); setDone(null);
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setStage(files.length > 1 ? `Procesando ${i + 1}/${files.length}…` : "Procesando con IA…");
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch("/api/ingest/invoice", { method: "POST", body: fd });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Error" }));
          throw new Error(err.error ?? "Fallo");
        }
      }
      setDone({ ok: true, msg: files.length > 1 ? `${files.length} facturas cargadas` : "Factura cargada" });
      router.refresh();
    } catch (e: any) {
      setDone({ ok: false, msg: e.message });
    } finally {
      setBusy(false);
      setStage("");
      // Auto ocultar el toast después de 3s
      setTimeout(() => setDone(null), 3000);
    }
  }

  return (
    <>
      {/* FAB visible solo en mobile (md:hidden) */}
      <button
        aria-label="Sacar foto de factura"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="md:hidden fixed bottom-5 right-5 z-30 w-16 h-16 rounded-full text-white shadow-lg flex items-center justify-center transition-transform active:scale-95"
        style={{
          background: busy
            ? "linear-gradient(135deg,#86868b,#a8a8ad)"
            : "linear-gradient(135deg,#0071e3,#54a0ff)",
          boxShadow: "0 6px 20px rgba(0,113,227,0.45)"
        }}
      >
        {busy ? <Spinner/> : <Icon.Camera />}
      </button>

      {/* Toast de progreso/resultado */}
      {(busy || done) && (
        <div
          className="md:hidden fixed bottom-24 left-4 right-4 z-30 rounded-2xl px-4 py-3 text-[13px] shadow-lg fade-in"
          style={{
            background: done
              ? (done.ok ? "#0f5132" : "#7b1d1d")
              : "#1d1d1f",
            color: "white"
          }}
        >
          <div className="flex items-center gap-2">
            {busy && <Spinner small/>}
            <span className="font-semibold">
              {busy ? stage : done?.ok ? "✓ " + done?.msg : "✗ " + done?.msg}
            </span>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        multiple
        hidden
        onChange={(e) => { handle(e.target.files); e.target.value = ""; }}
      />
    </>
  );
}

function Spinner({ small = false }: { small?: boolean }) {
  const s = small ? 14 : 22;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" className="animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25"/>
      <path d="M21 12a9 9 0 0 1-9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
}
