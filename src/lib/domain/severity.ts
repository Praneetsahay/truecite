import { SEVERITY_ORDER, type ErrorVerdict, type Importance, type QuestionCategory, type Severity } from "./constants";
import type { ErrorType } from "./playbook";

/**
 * Severity follows the importance of the fact and the type of error, so a false
 * claim about a lawsuit is critical while a wrong founding year is low.
 */
export function severityFor(input: {
  importance: Importance | null;
  verdict: ErrorVerdict;
  errorType: ErrorType;
  category?: QuestionCategory | null;
}): Severity {
  if (input.errorType === "false_scandal") return "critical";
  if (input.verdict === "confused" && (input.category === "reputation" || input.category === "trust")) {
    return "critical";
  }
  const base: Severity = input.importance ?? "medium";
  if (input.verdict === "missing") return lower(base);
  return base;
}

export function lower(severity: Severity): Severity {
  const index = SEVERITY_ORDER.indexOf(severity);
  return SEVERITY_ORDER[Math.min(index + 1, SEVERITY_ORDER.length - 1)];
}

export function compareSeverity(a: Severity, b: Severity): number {
  return SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b);
}

/** Bars shown next to a severity label, from 4 (critical) to 1 (low). */
export function severityLevel(severity: Severity): 1 | 2 | 3 | 4 {
  return (4 - SEVERITY_ORDER.indexOf(severity)) as 1 | 2 | 3 | 4;
}
