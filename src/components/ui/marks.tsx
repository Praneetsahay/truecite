import {
  IMPORTANCE,
  ISSUE_STATUSES,
  PLATFORMS,
  REVIEW_STATES,
  VERDICTS,
  type IssueStatus,
  type PlatformId,
  type ReviewState,
  type Severity,
  type Verdict,
} from "@/lib/domain/constants";
import { listJoin } from "@/lib/domain/format";
import { severityLevel } from "@/lib/domain/severity";
import { cx } from "@/lib/cx";

/*
  Marks that carry meaning. Color is never the only signal: every mark has a
  shape and a word.
*/

/** Severity as four bars, like a signal meter, plus the word. No color. */
export function SeverityMark({ severity, showLabel = true, className }: { severity: Severity; showLabel?: boolean; className?: string }) {
  const level = severityLevel(severity);
  const label = IMPORTANCE[severity].label;
  return (
    <span className={cx("inline-flex items-center gap-2 whitespace-nowrap", className)}>
      <span aria-hidden="true" className="inline-flex h-3 items-end gap-[2px]">
        {[1, 2, 3, 4].map((bar) => (
          <span
            key={bar}
            className={cx("w-[3px] rounded-[1px]", bar <= level ? "bg-ink" : "bg-rule-strong/70")}
            style={{ height: `${3 + bar * 2.25}px` }}
          />
        ))}
      </span>
      {showLabel ? <span>{label}</span> : <span className="sr-only">{label} severity</span>}
    </span>
  );
}

function StatusIcon({ status }: { status: IssueStatus }) {
  const common = { width: 12, height: 12, viewBox: "0 0 12 12", "aria-hidden": true as const };
  switch (status) {
    case "open":
      return (
        <svg {...common} className="shrink-0 text-ink">
          <circle cx="6" cy="6" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "reopened":
      return (
        <svg {...common} className="shrink-0 text-ink">
          <circle cx="6" cy="6" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="6" cy="6" r="2" fill="currentColor" />
        </svg>
      );
    case "in_progress":
      return (
        <svg {...common} className="shrink-0 text-ink">
          <circle cx="6" cy="6" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 1.25 A4.75 4.75 0 0 1 6 10.75 Z" fill="currentColor" />
        </svg>
      );
    case "fixed_rechecking":
      return (
        <svg {...common} className="shrink-0 text-ink">
          <circle cx="6" cy="6" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 1.6" />
        </svg>
      );
    case "resolved":
      return (
        <svg {...common} className="shrink-0 text-verified">
          <circle cx="6" cy="6" r="5.5" fill="currentColor" />
          <path d="M3.6 6.1 5.3 7.7 8.4 4.5" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}

export function StatusMark({ status, className }: { status: IssueStatus; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2 whitespace-nowrap", status === "resolved" && "text-verified", className)}>
      <StatusIcon status={status} />
      <span>{ISSUE_STATUSES[status].label}</span>
    </span>
  );
}

/**
 * A verdict word. Wrong statements are correction red, correct ones verified
 * green, statements that need review sit on the highlighter.
 */
export function VerdictLabel({ verdict, className }: { verdict: Verdict; className?: string }) {
  const label = VERDICTS[verdict].label;
  const wrong = verdict === "incorrect" || verdict === "outdated" || verdict === "confused";
  return (
    <span
      className={cx(
        "text-sm font-medium whitespace-nowrap",
        wrong && "text-correction",
        verdict === "correct" && "text-verified",
        verdict === "unsupported" && "highlight text-ink",
        verdict === "missing" && "text-graphite italic",
        className,
      )}
    >
      {label}
    </span>
  );
}

export function ReviewLabel({ state, className }: { state: ReviewState; className?: string }) {
  return (
    <span className={cx("text-sm whitespace-nowrap", state === "pending" && "highlight", state === "rejected" && "text-graphite", className)}>
      {REVIEW_STATES[state].label}
    </span>
  );
}

/** "ChatGPT, Gemini and Perplexity" */
export function PlatformList({ platforms, className }: { platforms: readonly PlatformId[]; className?: string }) {
  return <span className={className}>{listJoin(platforms.map((id) => PLATFORMS[id].name))}</span>;
}

export function platformName(id: PlatformId): string {
  return PLATFORMS[id].name;
}

/** Marks a value as an estimate, such as competitor scores. */
export function EstimateMark({ className }: { className?: string }) {
  return (
    <span
      className={cx("text-sm text-graphite [font-variant-numeric:normal]", className)}
      title="Estimated from an unconfirmed Fact Sheet"
    >
      est.
    </span>
  );
}
