export function Kpi({
  label,
  value,
  delta,
  hint
}: {
  label: string;
  value: string;
  delta?: number;
  hint?: string;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-medium uppercase tracking-wider text-ink-3">{label}</div>
        {delta != null && (
          <span className="chip" style={{
            background: delta >= 0 ? "#e6f6ed" : "#fdeaef",
            color: delta >= 0 ? "#30a46c" : "#f04f6f"
          }}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="kpi-num mt-2">{value}</div>
      {hint && <div className="text-[12px] mt-1 text-ink-2">{hint}</div>}
    </div>
  );
}
