import { PLANS, PLATFORM_IDS, SCAN_FREQUENCIES, type PlanId, type ScanFrequency } from "@/lib/domain/constants";

/*
  Plan limits as numbers, for onboarding. "custom" and "all" become concrete
  numbers so forms can count against them.
*/

/** Continue from the Fact Sheet needs at least this many approved facts. */
export const MIN_APPROVED_FACTS = 5;

/** Custom plans are capped here during onboarding; an admin can raise limits later. */
const CUSTOM_QUESTIONS = 200;
const CUSTOM_COMPETITORS = 10;

export function planQuestionLimit(plan: PlanId): number {
  const limit = PLANS[plan].questions;
  return limit === "custom" ? CUSTOM_QUESTIONS : limit;
}

export function planCompetitorLimit(plan: PlanId): number {
  const limit = PLANS[plan].competitors;
  return limit === "custom" ? CUSTOM_COMPETITORS : limit;
}

export function planPlatformLimit(plan: PlanId): number {
  const limit = PLANS[plan].platforms;
  return limit === "all" ? PLATFORM_IDS.length : Math.min(limit, PLATFORM_IDS.length);
}

/** The plan's scan frequency; custom plans start weekly. */
export function planScanFrequency(plan: PlanId): ScanFrequency {
  const frequency = PLANS[plan].frequency;
  return frequency === "custom" ? "weekly" : frequency;
}

const INTERVAL_DAYS: Record<ScanFrequency, number | null> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  manual: null,
};

/** When the next scheduled scan runs after the first one, or null when scans only run by hand. */
export function nextScanAt(frequency: ScanFrequency, from: Date): Date | null {
  const days = INTERVAL_DAYS[frequency];
  return days === null ? null : new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

export function frequencyLabel(frequency: ScanFrequency): string {
  return SCAN_FREQUENCIES[frequency].label;
}
