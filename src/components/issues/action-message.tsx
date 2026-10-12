import type { ActionState } from "@/lib/actions";
import { cx } from "@/lib/cx";

/**
 * The line a form shows after its action runs. Confirmations stay in ink:
 * green is kept for correct statements and resolved issues.
 */
export function ActionMessage({ state, className }: { state: ActionState; className?: string }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={cx("text-sm", state.ok ? "text-ink" : "text-correction", className)}>
      {state.message}
    </p>
  );
}
