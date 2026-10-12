import { formatDay } from "@/lib/domain/format";
import { cx } from "@/lib/cx";

export type TrendPoint = { date: string | Date; value: number | null };

type Series = { label: string; points: TrendPoint[]; emphasis?: boolean };

/**
 * A quiet line chart: one ink line for the client, thin graphite lines for any
 * comparison series, labels on the ends instead of a legend. Scores run 0–100.
 */
export function TrendChart({
  series,
  height = 160,
  min = 0,
  max = 100,
  label,
  className,
}: {
  series: Series[];
  height?: number;
  min?: number;
  max?: number;
  /** A sentence describing the trend, read by screen readers. */
  label: string;
  className?: string;
}) {
  const width = 640;
  const pad = { top: 12, right: 40, bottom: 24, left: 28 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const longest = series.reduce((n, s) => Math.max(n, s.points.length), 0);
  const x = (i: number) => pad.left + (longest <= 1 ? innerW : (i / (longest - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - ((v - min) / (max - min)) * innerH;
  const ticks = [min, Math.round((min + max) / 2), max];
  const reference = series.find((s) => s.emphasis) ?? series[0];
  // End labels sit beside each line's last point; nudge them apart so close values don't overlap.
  const labelY: (number | undefined)[] = series.map((s) => {
    const lastValue = [...s.points].reverse().find((p) => p.value !== null)?.value;
    return lastValue === null || lastValue === undefined ? undefined : y(lastValue);
  });
  const order = labelY
    .map((value, index) => ({ value, index }))
    .filter((entry): entry is { value: number; index: number } => entry.value !== undefined)
    .sort((a, b) => a.value - b.value);
  for (let i = 1; i < order.length; i++) {
    if (order[i].value - order[i - 1].value < 12) order[i].value = order[i - 1].value + 12;
  }
  for (const entry of order) labelY[entry.index] = entry.value;
  const first = reference?.points[0];
  const last = reference?.points[reference.points.length - 1];

  return (
    <figure className={cx("w-full", className)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="h-auto w-full overflow-visible">
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(tick)}
              y2={y(tick)}
              className="stroke-rule"
              strokeWidth={1}
              strokeDasharray={tick === min ? undefined : "2 4"}
            />
            <text x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-graphite text-[11px]">
              {tick}
            </text>
          </g>
        ))}
        {series.map((s, seriesIndex) => {
          const pts = s.points
            .map((p, i) => (p.value === null ? null : ([x(i), y(p.value)] as const)))
            .filter((p): p is readonly [number, number] => p !== null);
          if (pts.length === 0) return null;
          const d = pts.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
          const end = pts[pts.length - 1];
          const lastValue = s.points[s.points.length - 1]?.value;
          return (
            <g key={s.label}>
              <path
                d={d}
                fill="none"
                className={s.emphasis ? "stroke-ink" : "stroke-graphite/50"}
                strokeWidth={s.emphasis ? 1.75 : 1.25}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {s.emphasis
                ? pts.map(([px, py], i) => <circle key={i} cx={px} cy={py} r={i === pts.length - 1 ? 3.25 : 1.75} className="fill-ink" />)
                : null}
              <text
                x={end[0] + 8}
                y={labelY[seriesIndex] ?? end[1]}
                dy="0.32em"
                className={cx("text-[11px]", s.emphasis ? "fill-ink font-medium" : "fill-graphite")}
              >
                {lastValue === null || lastValue === undefined ? "" : Math.round(lastValue)}
              </text>
            </g>
          );
        })}
        {first ? (
          <text x={x(0)} y={height - 6} className="fill-graphite text-[11px]">
            {formatDay(first.date)}
          </text>
        ) : null}
        {last && longest > 1 ? (
          <text x={x(longest - 1)} y={height - 6} textAnchor="end" className="fill-graphite text-[11px]">
            {formatDay(last.date)}
          </text>
        ) : null}
      </svg>
      {series.length > 1 ? (
        <figcaption className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-graphite">
          {series.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-2">
              <span aria-hidden="true" className={cx("inline-block h-[2px] w-4", s.emphasis ? "bg-ink" : "bg-graphite/50")} />
              <span className={s.emphasis ? "text-ink" : undefined}>{s.label}</span>
            </span>
          ))}
        </figcaption>
      ) : null}
    </figure>
  );
}
