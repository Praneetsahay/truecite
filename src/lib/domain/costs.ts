import { MARGIN_LIMIT, SCAN_FREQUENCIES, type ScanFrequency } from "./constants";

export type ModelPrice = {
  provider: string;
  model: string;
  /** USD per million input tokens. */
  inputPerMTok: number;
  /** USD per million output tokens. */
  outputPerMTok: number;
  /** USD per web search call. */
  perSearchCall: number;
};

export type Usage = {
  tokensIn: number;
  tokensOut: number;
  searchCalls: number;
};

/** Cost of one request, from its token usage and search calls, using the price table. */
export function requestCost(usage: Usage, price: ModelPrice): number {
  const cost =
    (usage.tokensIn / 1_000_000) * price.inputPerMTok +
    (usage.tokensOut / 1_000_000) * price.outputPerMTok +
    usage.searchCalls * price.perSearchCall;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** Monthly requests = questions × platforms × runs per question × scans per month. */
export function monthlyRequests(input: {
  questions: number;
  platforms: number;
  runsPerQuestion: number;
  frequency: ScanFrequency;
}): number {
  return Math.round(
    input.questions * input.platforms * input.runsPerQuestion * SCAN_FREQUENCIES[input.frequency].perMonth,
  );
}

/** Rough range at typical prices: about 1 to 5 cents per request with web search. */
export function estimateMonthlyCost(requests: number): { low: number; high: number } {
  return { low: Math.round(requests * 0.01), high: Math.round(requests * 0.05) };
}

export type MarginCheck = {
  share: number | null;
  withinRule: boolean;
};

/** The margin rule: keep API costs below about 20% of what each client pays. */
export function marginCheck(apiCostUsd: number, revenueUsd: number): MarginCheck {
  if (revenueUsd <= 0) return { share: null, withinRule: apiCostUsd === 0 };
  const share = apiCostUsd / revenueUsd;
  return { share, withinRule: share <= MARGIN_LIMIT };
}

/** A fixed conversion used only for internal margin views, not for billing. */
export const INR_PER_USD = 88;

export function toUsd(amount: number, currency: "USD" | "INR"): number {
  return currency === "USD" ? amount : amount / INR_PER_USD;
}
