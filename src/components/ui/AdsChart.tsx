/**
 * Gráfico diario: barras de gasto + línea de resultados. SVG puro, sin dependencias.
 */
export function AdsChart({ data, currency }: { data: { date: string; spend: number; results: number }[]; currency: string }) {
  const W = 800, H = 260, padL = 52, padR = 44, padT = 16, padB = 30;
  const n = Math.max(1, data.length);
  const maxSpend = Math.max(1, ...data.map(d => d.spend));
  const maxRes = Math.max(1, ...data.map(d => d.results));
  const nice = (v: number) => { const p = Math.pow(10, Math.floor(Math.log10(v))); return Math.ceil(v / p) * p; };
  const sMax = nice(maxSpend), rMax = nice(maxRes);
  const bw = (W - padL - padR) / n;
  const yS = (v: number) => H - padB - (v / sMax) * (H - padT - padB);
  const yR = (v: number) => H - padB - (v / rMax) * (H - padT - padB);
  const ticks = [0, .25, .5, .75, 1];
  const short = (v: number) => v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + "k" : v.toFixed(0);
  const sym = currency === "ARS" ? "$" : currency === "USD" ? "US$" : currency + " ";
  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${padL + i * bw + bw / 2},${yR(d.results)}`).join(" ");
  const labelEvery = n > 20 ? 5 : n > 10 ? 2 : 1;

  if (!data.length) return <div className="text-[13px] text-ink-3 py-10 text-center">Sin datos para el período.</div>;

  return (
    <div className="w-full overflow-x-auto scroll-clean">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[320px] md:min-w-[560px]" preserveAspectRatio="xMidYMid meet">
        <g className="grid-lines">
          {ticks.map((t, i) => <line key={i} x1={padL} x2={W - padR} y1={yS(t * sMax)} y2={yS(t * sMax)} />)}
        </g>
        {ticks.map((t, i) => <text key={"l" + i} x={padL - 8} y={yS(t * sMax) + 4} textAnchor="end" className="axis-text">{sym}{short(t * sMax)}</text>)}
        {ticks.map((t, i) => <text key={"r" + i} x={W - padR + 8} y={yR(t * rMax) + 4} textAnchor="start" className="axis-text">{short(t * rMax)}</text>)}
        {data.map((d, i) => {
          const x = padL + i * bw + bw * 0.2;
          const w = Math.max(2, bw * 0.6);
          return (
            <g key={d.date}>
              <rect x={x} y={yS(d.spend)} width={w} height={Math.max(0, H - padB - yS(d.spend))} rx={Math.min(5, w / 2)} fill="#0071e3" opacity={d.spend ? 0.85 : 0.12} />
              {i % labelEvery === 0 && (
                <text x={padL + i * bw + bw / 2} y={H - padB + 16} textAnchor="middle" className="axis-text">{d.date.slice(8, 10)}/{d.date.slice(5, 7)}</text>
              )}
            </g>
          );
        })}
        <path d={line} fill="none" stroke="#30a46c" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => d.results > 0 && (
          <circle key={"c" + d.date} cx={padL + i * bw + bw / 2} cy={yR(d.results)} r={3} fill="#fff" stroke="#30a46c" strokeWidth={2} />
        ))}
      </svg>
      <div className="flex items-center gap-4 px-1 mt-1 text-[12px] text-ink-2">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#0071e3" }} />Gasto</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-0.5 rounded" style={{ background: "#30a46c" }} />Resultados</span>
      </div>
    </div>
  );
}
