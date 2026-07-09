/**
 * Branding centralizado de esImportar.
 * Si más adelante guardás el logo local en /public/logo.png,
 * cambiá LOGO_URL a "/logo.png" y listo.
 */

export const BRAND = {
  name: "Panel Contable",
  company: "esImportar",
  fullName: "Panel Contable esImportar",
  tagline: "Gestión contable inteligente con IA",
  logoUrl: "https://misfotosMartin.b-cdn.net/Logotipo-Color-03-%20sin%20fondo.png",
  copyright: "© 2026 esImportar · Todos los derechos reservados."
};

type Size = "sm" | "md" | "lg" | "xl";
const sizeMap: Record<Size, { img: string; text: string; sub: string }> = {
  sm: { img: "h-7",  text: "text-[14px]", sub: "text-[10px]" },
  md: { img: "h-9",  text: "text-[16px]", sub: "text-[11px]" },
  lg: { img: "h-12", text: "text-[20px]", sub: "text-[12px]" },
  xl: { img: "h-16", text: "text-[26px]", sub: "text-[13px]" }
};

export function Logo({
  size = "md",
  showText = true,
  subtitle
}: { size?: Size; showText?: boolean; subtitle?: string }) {
  const s = sizeMap[size];
  return (
    <div className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={BRAND.logoUrl}
        alt="esImportar"
        className={`${s.img} w-auto object-contain`}
        style={{ imageRendering: "auto" }}
      />
      {showText && (
        <div className="min-w-0">
          <div className={`sf-display ${s.text} font-semibold leading-tight tracking-tight truncate`}>
            {BRAND.name}
          </div>
          {subtitle ? (
            <div className={`${s.sub} text-ink-3 leading-tight truncate`}>{subtitle}</div>
          ) : (
            <div className={`${s.sub} text-ink-3 leading-tight truncate`}>{BRAND.company}</div>
          )}
        </div>
      )}
    </div>
  );
}
