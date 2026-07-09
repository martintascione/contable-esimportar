export function AnnualChart({ data }: { data: { m: string; debito: number; credito: number }[] }) {
  const W = 800, H = 300, padL = 46, padR = 12, padT = 16, padB = 32;
  const max = Math.max(1, ...data.map(d => Math.max(d.debito, d.credito)));
  const niceMax = Math.ceil(max / 100000) * 100000;
  const bw = (W - padL - padR) / data.length;
  const y = (v: number) => H - padB - (v / niceMax) * (H - padT - padB);
  const ticks = [0, .25, .5, .75, 1].map(t => t * niceMax);
  const short = (n: number) => n >= 1e9 ? (n/1e9).toFixed(1)+"B" : n >= 1e6 ? (n/1e6).toFixed(1)+"M" : n >= 1e3 ? (n/1e3).toFixed(0)+"k" : String(n);

  return (
    <div className="w-full overflow-x-auto scroll-clean">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[640px]" preserveAspectRatio="xMidYMid meet">
        <g className="grid-lines">
          {ticks.map((t, i) => <line key={i} x1={padL} x2={W-padR} y1={y(t)} y2={y(t)} />)}
        </g>
        {ticks.map((t, i) => <text key={i} x={padL-8} y={y(t)+4} textAnchor="end" className="axis-text">{short(t)}</text>)}
        {data.map((d, i) => {
          const x0 = padL + i * bw + 8;
          const w = (bw - 16) / 2;
          return (
            <g key={d.m}>
              <rect x={x0} y={y(d.debito)} width={w} height={H-padB-y(d.debito)} rx="5" fill="#0071e3" opacity={d.debito?1:0.12}/>
              <rect x={x0+w+4} y={y(d.credito)} width={w} height={H-padB-y(d.credito)} rx="5" fill="#54a0ff" opacity={d.credito?1:0.12}/>
              <text x={x0 + bw/2 - 4} y={H-padB+16} textAnchor="middle" className="axis-text">{d.m}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
