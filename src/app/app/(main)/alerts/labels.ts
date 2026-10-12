import { IMPORTANCE, type Severity } from "@/lib/domain/constants";

/** How a rule's minimum severity reads: the threshold and everything above it. */
export const SEVERITY_THRESHOLDS: { value: Severity; label: string }[] = [
  { value: "critical", label: "Critical only" },
  { value: "high", label: "High and critical" },
  { value: "medium", label: "Medium and above" },
  { value: "low", label: "Every issue" },
];

export function thresholdLabel(severity: Severity): string {
  return SEVERITY_THRESHOLDS.find((option) => option.value === severity)?.label ?? IMPORTANCE[severity].label;
}

export const MESSAGE_STATUS: Record<"sent" | "logged" | "failed", string> = {
  sent: "Sent",
  logged: "Recorded",
  failed: "Not delivered",
};
