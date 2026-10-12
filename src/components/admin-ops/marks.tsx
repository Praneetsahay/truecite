import { Meter } from "@/components/charts/meter";
import { MARGIN_LIMIT, SCAN_STATUSES, type ScanStatus } from "@/lib/domain/constants";
import { formatNumber, formatPercent } from "@/lib/domain/format";
import { LOW_CONFIDENCE_BELOW, type Health, type Margin } from "@/lib/queries/admin-ops";
import { cx } from "@/lib/cx";

/*
  Small marks used across the admin panel. Each one says its meaning in words;
  color and shape only support the words.
*/

/** The checker's confidence. Below 0.8 it sits on the highlighter with the words "Low confidence". */
export function ConfidenceMark({ value, className }: { value: number; className?: string }) {
  const low = value < LOW_CONFIDENCE_BELOW;
  return (
    <span className={cx("inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5", className)}>
      <span className="figures">{formatPercent(value)}</span>
      {low ? <span className="highlight text-sm whitespace-nowrap text-ink">Low confidence</span> : null}
    </span>
  );
}

/** Account health as a plain word, with the reasons underneath. */
export function HealthMark({ health, className }: { health: Health; className?: string }) {
  if (health.healthy) return <span className={cx("text-graphite", className)}>Healthy</span>;
  return (
    <span className={cx("grid gap-0.5", className)}>
      <span className="font-medium text-ink">Needs attention</span>
      {health.reasons.map((reason) => (
        <span key={reason} className="text-sm text-graphite">
          {reason}
        </span>
      ))}
    </span>
  );
}

/** API cost as a share of revenue. Above the margin rule it says so in words. */
export function MarginShare({
  margin,
  trial,
  align = "end",
  className,
}: {
  margin: Margin;
  trial?: boolean;
  /** "end" in numeric table columns, "start" in label and value lists. */
  align?: "start" | "end";
  className?: string;
}) {
  if (margin.share === null) {
    return <span className={cx("text-graphite", className)}>{trial ? "Trial" : "No revenue"}</span>;
  }
  if (!margin.overLimit) return <span className={cx("figures", className)}>{formatPercent(margin.share)}</span>;
  return (
    <span className={cx("inline-grid gap-0.5", align === "end" ? "justify-items-end" : "justify-items-start", className)}>
      <span className="figures font-medium text-ink">{formatPercent(margin.share)}</span>
      <span className="text-sm whitespace-nowrap text-ink">Over {formatPercent(MARGIN_LIMIT)}</span>
    </span>
  );
}

/** A scan's status in words. Stopped scans read slightly stronger than finished ones. */
export function ScanStatusLabel({ status, className }: { status: ScanStatus; className?: string }) {
  return (
    <span
      className={cx(
        "whitespace-nowrap",
        (status === "failed" || status === "cancelled") && "font-medium text-ink",
        status === "completed" && "text-graphite",
        className,
      )}
    >
      {SCAN_STATUSES[status].label}
    </span>
  );
}

/** Jobs done out of jobs total, as a bar and in words. */
export function ScanProgress({ done, total, className }: { done: number; total: number; className?: string }) {
  const share = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <span className={cx("grid gap-1.5", className)}>
      <Meter value={share} label={`${share}% of jobs done`} className="w-full max-w-48" />
      <span className="text-sm text-graphite">
        {formatNumber(done)} of {formatNumber(total)} jobs
      </span>
    </span>
  );
}

/** Whether a scan's answers came from the real APIs or from the built-in simulator. */
export function AnswerSourceLabel({ simulated, className }: { simulated: boolean; className?: string }) {
  return <span className={cx(simulated ? "text-ink" : "text-graphite", className)}>{simulated ? "Simulated" : "Live APIs"}</span>;
}
