import { CLEAN_SCANS_TO_RESOLVE, type IssueStatus } from "./constants";

/**
 * Status changes a client's team can make by hand. Resolved and Reopened are set
 * by TrueCite after re-checking, never by hand.
 */
const MANUAL_TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  open: ["in_progress", "fixed_rechecking"],
  reopened: ["in_progress", "fixed_rechecking"],
  in_progress: ["open", "fixed_rechecking"],
  fixed_rechecking: ["in_progress"],
  resolved: [],
};

export function manualTransitions(status: IssueStatus): IssueStatus[] {
  return MANUAL_TRANSITIONS[status];
}

export function canTransition(from: IssueStatus, to: IssueStatus): boolean {
  return MANUAL_TRANSITIONS[from].includes(to);
}

/** Button labels for each manual change, written from the client's point of view. */
export const TRANSITION_ACTIONS: Partial<Record<IssueStatus, string>> = {
  in_progress: "Start working on it",
  fixed_rechecking: "Mark as fixed",
  open: "Move back to open",
};

export type RecheckOutcome = {
  status: IssueStatus;
  cleanScanStreak: number;
  event: "resolved" | "reopened" | "seen" | "clean" | null;
};

/**
 * What happens to an issue after a scan re-checks it.
 * - Error seen again: a resolved issue reopens; others reset their clean streak.
 * - Error not seen: the streak grows; a fixed issue resolves after two clean scans.
 */
export function afterRecheck(status: IssueStatus, cleanScanStreak: number, errorSeen: boolean): RecheckOutcome {
  if (errorSeen) {
    if (status === "resolved") return { status: "reopened", cleanScanStreak: 0, event: "reopened" };
    return { status, cleanScanStreak: 0, event: "seen" };
  }
  const streak = cleanScanStreak + 1;
  if (status === "resolved") return { status, cleanScanStreak: streak, event: null };
  if (streak >= CLEAN_SCANS_TO_RESOLVE && status === "fixed_rechecking") {
    return { status: "resolved", cleanScanStreak: streak, event: "resolved" };
  }
  return { status, cleanScanStreak: streak, event: "clean" };
}
