import { cx } from "@/lib/cx";

/** A thin horizontal bar for a 0–100 value, used next to the number in tables. */
export function Meter({
  value,
  max = 100,
  label,
  className,
  muted,
}: {
  value: number | null;
  max?: number;
  label: string;
  className?: string;
  /** Lighter fill, for estimates such as competitor scores. */
  muted?: boolean;
}) {
  const share = value === null ? 0 : Math.max(0, Math.min(1, value / max));
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value ?? undefined}
      className={cx("relative block h-1.5 w-full overflow-hidden rounded-xs bg-rule", className)}
    >
      <span
        className={cx("absolute inset-y-0 left-0 rounded-xs", muted ? "bg-graphite/45" : "bg-ink")}
        style={{ width: `${share * 100}%` }}
      />
    </span>
  );
}

/** A three-part bar for sentiment: positive, neutral, negative. Shapes differ so color is not the only signal. */
export function SentimentBar({
  positive,
  neutral,
  negative,
  className,
}: {
  positive: number;
  neutral: number;
  negative: number;
  className?: string;
}) {
  const total = positive + neutral + negative || 1;
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  return (
    <span className={cx("block", className)}>
      <span
        aria-hidden="true"
        className="flex h-1.5 w-full overflow-hidden rounded-xs bg-rule"
      >
        <span className="h-full bg-ink" style={{ width: pct(positive) }} />
        <span className="h-full bg-graphite/35" style={{ width: pct(neutral) }} />
        <span
          className="h-full bg-[repeating-linear-gradient(135deg,var(--color-graphite)_0_2px,transparent_2px_4px)]"
          style={{ width: pct(negative) }}
        />
      </span>
      <span className="sr-only">
        {pct(positive)} positive, {pct(neutral)} neutral, {pct(negative)} negative
      </span>
    </span>
  );
}
