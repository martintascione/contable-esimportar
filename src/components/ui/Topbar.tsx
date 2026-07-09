export function Topbar({
  title, subtitle, right
}: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="glass sticky top-0 z-10 px-8 py-4 flex items-center justify-between border-b border-line">
      <div>
        <div className="sf-display text-[22px] font-semibold leading-tight">{title}</div>
        {subtitle && <div className="text-[12px] text-ink-2">{subtitle}</div>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}
