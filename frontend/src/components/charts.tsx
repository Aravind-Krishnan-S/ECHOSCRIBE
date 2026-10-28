/* Small SVG charts drawn to the app rules: one hue on the data, 3–4 faint gridlines,
   no legend for a single series, straight 2px lines without markers. */

export function TrendLine({ points, max = 10, height = 160, label }: {
  points: { x: string; y: number }[]
  max?: number
  height?: number
  label: string
}) {
  if (!points.length) return <p className="text-muted">Not enough sessions yet to draw a trend.</p>
  const W = 600, H = height, padL = 28, padR = 8, padT = 10, padB = 24
  const iw = W - padL - padR, ih = H - padT - padB
  const xs = (i: number) => padL + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw)
  const ys = (v: number) => padT + ih - (Math.max(0, Math.min(max, v)) / max) * ih
  const ticks = [0, max / 2, max]
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(p.y).toFixed(1)}`).join(' ')
  const last = points[points.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={label}>
      {ticks.map(t => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={ys(t)} y2={ys(t)} stroke="var(--border)" strokeDasharray={t ? '3 4' : undefined} />
          <text x={padL - 8} y={ys(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)" className="num">{t}</text>
        </g>
      ))}
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx={xs(points.length - 1)} cy={ys(last.y)} r="3.5" fill="var(--accent)" />
      {points.map((p, i) => (points.length <= 8 || i % Math.ceil(points.length / 6) === 0 || i === points.length - 1) && (
        <text key={i} x={xs(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">{p.x}</text>
      ))}
    </svg>
  )
}

export function BarList({ items, unit = '' }: { items: { label: string; value: number }[]; unit?: string }) {
  if (!items.length) return <p className="text-muted">No topics recorded yet.</p>
  const max = Math.max(...items.map(i => i.value), 1)
  return (
    <ul className="m-0 p-0 list-none flex flex-col gap-2.5">
      {items.map((it, i) => (
        <li key={it.label} className="grid grid-cols-[minmax(0,1fr)_40px] items-center gap-3">
          <span className="relative h-8 bg-surface-2 overflow-hidden">
            <span className="absolute inset-y-0 left-0"
              style={{ width: `${(it.value / max) * 100}%`, background: i === 0 ? 'var(--accent-tint-2)' : 'var(--accent-tint)' }} />
            <span className="absolute inset-0 flex items-center px-3 truncate">{it.label}</span>
          </span>
          <span className="num text-right">{it.value}{unit}</span>
        </li>
      ))}
    </ul>
  )
}
