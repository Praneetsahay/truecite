import type { PlatformId } from "@/lib/domain/constants";
import { requestCost, type ModelPrice, type Usage } from "@/lib/domain/costs";
import { settings } from "../schema";

/*
  Models, prices, feature switches and limits. The scan engine reads these from the
  settings table; the seed also uses the same price table to cost every demo answer.
*/

export type AnswerModel = { provider: string; model: string; webSearch: boolean; effort?: "low" | "medium" | "high" };

export const ANSWER_MODELS: Record<PlatformId, AnswerModel> = {
  chatgpt: { provider: "openai", model: "gpt-5-mini", webSearch: true },
  gemini: { provider: "google", model: "gemini-2.5-flash", webSearch: true },
  perplexity: { provider: "perplexity", model: "sonar", webSearch: true },
  claude: { provider: "anthropic", model: "claude-opus-5-5", webSearch: true, effort: "medium" },
};

export const CHECKER_MODEL = { provider: "anthropic", model: "claude-haiku-5-5", effort: "low" as const };

/** USD prices. These are estimates to confirm against each provider's pricing page. */
export const PRICE_TABLE: ModelPrice[] = [
  { provider: "openai", model: "gpt-5-mini", inputPerMTok: 0.25, outputPerMTok: 2.0, perSearchCall: 0.01 },
  { provider: "google", model: "gemini-2.5-flash", inputPerMTok: 0.3, outputPerMTok: 2.5, perSearchCall: 0.035 },
  { provider: "perplexity", model: "sonar", inputPerMTok: 1.0, outputPerMTok: 1.0, perSearchCall: 0.005 },
  { provider: "anthropic", model: "claude-opus-5-5", inputPerMTok: 4.0, outputPerMTok: 20.0, perSearchCall: 0.01 },
  { provider: "anthropic", model: "claude-sonnet-5-5", inputPerMTok: 2.0, outputPerMTok: 10.0, perSearchCall: 0.01 },
  { provider: "anthropic", model: "claude-haiku-5-5", inputPerMTok: 0.1, outputPerMTok: 0.5, perSearchCall: 0.01 },
];

export function priceFor(provider: string, model: string): ModelPrice {
  const price = PRICE_TABLE.find((p) => p.provider === provider && p.model === model);
  if (!price) throw new Error(`No price for ${provider} ${model}`);
  return price;
}

export function answerCost(platform: PlatformId, usage: Usage): number {
  const m = ANSWER_MODELS[platform];
  return requestCost(usage, priceFor(m.provider, m.model));
}

export function checkerCost(usage: Usage): number {
  return requestCost(usage, priceFor(CHECKER_MODEL.provider, CHECKER_MODEL.model));
}

export function settingsRows(updatedAt: Date): (typeof settings.$inferInsert)[] {
  return [
    {
      key: "models",
      value: {
        answer: {
          chatgpt: { provider: "openai", model: "gpt-5-mini", webSearch: true },
          gemini: { provider: "google", model: "gemini-2.5-flash", webSearch: true },
          perplexity: { provider: "perplexity", model: "sonar", webSearch: true },
          claude: { provider: "anthropic", model: "claude-opus-5-5", webSearch: true, effort: "medium" },
        },
        checker: { provider: "anthropic", model: "claude-haiku-5-5", effort: "low" },
      },
      updatedAt,
    },
    { key: "prices", value: PRICE_TABLE, updatedAt },
    {
      key: "note",
      value:
        "Model prices are estimates. Confirm them against each provider's pricing page and with a small test run before setting client prices.",
      updatedAt,
    },
    {
      key: "features",
      value: {
        reviewQueue: true,
        competitorScans: true,
        sourceTracing: true,
        instantAlerts: true,
        simulateWithoutKeys: true,
        crisisMode: false,
        indianLanguages: false,
      },
      updatedAt,
    },
    { key: "limits", value: { maxConcurrentRequests: 4, requestTimeoutMs: 60000, maxAttempts: 3 }, updatedAt },
  ];
}
