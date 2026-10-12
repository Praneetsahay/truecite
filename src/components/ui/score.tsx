import { displayScore, scoreDelta } from "@/lib/domain/score";
import { cx } from "@/lib/cx";

/** The Accuracy Score as a large figure out of 100, with the change since the previous scan. */
export function ScoreFigure({
  score,
  previous,
  label = "Accuracy Score",
  size = "lg",
  deltaLabel = "since the last scan",
  className,
}: {
  score: number | null | undefined;
  previous?: number | null;
  label?: string;
  size?: "lg" | "md";
  deltaLabel?: string;
  className?: string;
}) {
  const delta = scoreDelta(score, previous);
  return (
    <div className={className}>
      <p className="text-sm text-graphite">{label}</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span
          className={cx(
            "figures font-medium tracking-[-0.03em] text-ink",
            size === "lg" ? "text-5xl" : "text-3xl",
          )}
        >
          {displayScore(score)}
        </span>
        <span className="text-graphite">/100</span>
      </p>
      {delta !== null ? <Delta value={delta} suffix={deltaLabel} className="mt-1.5" /> : null}
    </div>
  );
}

/** "Up 4 since the last scan" – written out, with an arrow for scanning. */
export function Delta({ value, suffix, className }: { value: number; suffix?: string; className?: string }) {
  const word = value > 0 ? "Up" : value < 0 ? "Down" : "No change";
  const arrow = value > 0 ? "↑" : value < 0 ? "↓" : "→";
  return (
    <p className={cx("text-sm text-graphite", className)}>
      <span aria-hidden="true" className="mr-1 text-ink">
        {arrow}
      </span>
      {word}
      {value !== 0 ? ` ${Math.abs(value)}` : ""}
      {suffix ? ` ${suffix}` : ""}
    </p>
  );
}

/** A large count with a short label, such as Open Risks. */
export function CountFigure({
  value,
  label,
  detail,
  size = "lg",
  className,
}: {
  value: number;
  label: string;
  detail?: React.ReactNode;
  size?: "lg" | "md";
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-sm text-graphite">{label}</p>
      <p className={cx("figures mt-1 font-medium tracking-[-0.03em] text-ink", size === "lg" ? "text-5xl" : "text-3xl")}>
        {value}
      </p>
      {detail ? <div className="mt-1.5 text-sm text-graphite">{detail}</div> : null}
    </div>
  );
}
