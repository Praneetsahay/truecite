import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/**
 * The note beside a struck-through statement: what was wrong, then the
 * correct fact and where it comes from. Red to green, problem to fix.
 */
export function MarginNote({
  verdictLabel = "Incorrect",
  detail,
  correct,
  source,
  children,
  className,
}: {
  /** "Incorrect", "Outdated", "Confused with another company", "Missing" */
  verdictLabel?: string;
  /** Short context after the verdict, such as "Seen in 3 of 3 runs". */
  detail?: ReactNode;
  /** The correct fact, as approved on the Fact Sheet. */
  correct: ReactNode;
  /** Where the correct fact comes from, such as "Fact Sheet, valid from 1 Mar 2026". */
  source?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <aside aria-label="Correction" className={cx("border-l border-rule-strong pl-5", className)}>
      <p className="text-sm">
        <span className="font-medium text-correction">{verdictLabel}</span>
        {detail ? <span className="text-graphite"> · {detail}</span> : null}
      </p>
      <p className="mt-4 text-sm font-medium text-verified">Correct</p>
      <p className="mt-1 font-serif text-xl leading-snug text-ink [font-optical-sizing:auto]">{correct}</p>
      {source ? <p className="mt-2 text-sm text-graphite">{source}</p> : null}
      {children ? <div className="mt-5">{children}</div> : null}
    </aside>
  );
}
