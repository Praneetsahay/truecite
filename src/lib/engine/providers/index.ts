import "server-only";
import { PLATFORMS, type PlatformId, type QuestionCategory } from "@/lib/domain/constants";
import type { BrandContext } from "../context";
import { PROVIDER_ENV, providerKey, type ProviderId, type Settings } from "../settings";
import { simulateAnswer, type SimulatedStatement } from "../simulator";
import { anthropicAdapter } from "./anthropic";
import { geminiAdapter } from "./gemini";
import { openaiAdapter } from "./openai";
import { perplexityAdapter } from "./perplexity";
import { ProviderError, type AskResult, type ProviderAdapter } from "./types";

export { ProviderError, PROVIDER_LABELS, type AskResult } from "./types";

const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  openai: openaiAdapter,
  google: geminiAdapter,
  perplexity: perplexityAdapter,
  anthropic: anthropicAdapter,
};

export type PlatformAnswer = AskResult & {
  provider: ProviderId;
  requestedModel: string;
  webSearch: boolean;
  effort: string | null;
  simulated: boolean;
  simulatedStatements?: SimulatedStatement[];
};

/**
 * Asks one question on one platform with the configured model. Without an API
 * key, answers from the simulator when that is switched on, and otherwise fails
 * with a message that says what to do.
 */
export async function askPlatform(input: {
  settings: Settings;
  ctx: BrandContext;
  platform: PlatformId;
  question: { id: string; text: string; category: QuestionCategory };
  runNumber: number;
  scanId: string;
  signal: AbortSignal;
}): Promise<PlatformAnswer> {
  const config = input.settings.models.answer[input.platform];
  const apiKey = providerKey(config.provider);
  const base = {
    provider: config.provider,
    requestedModel: config.model,
    webSearch: config.webSearch,
    effort: config.effort ?? null,
  };

  if (!apiKey) {
    if (!input.settings.features.simulateWithoutKeys) {
      throw new ProviderError({
        message: `No API key for ${PLATFORMS[input.platform].name}. Add ${PROVIDER_ENV[config.provider]}, or turn on simulated answers in Admin, Settings.`,
        retryable: false,
        kind: "config",
      });
    }
    const simulated = await simulateAnswer({
      ctx: input.ctx,
      question: input.question,
      platform: input.platform,
      runNumber: input.runNumber,
      scanId: input.scanId,
      model: config.model,
      webSearch: config.webSearch,
      signal: input.signal,
    });
    const { statements, ...answer } = simulated;
    return { ...answer, ...base, simulated: true, simulatedStatements: statements };
  }

  const answer = await ADAPTERS[config.provider].ask({
    question: input.question.text,
    model: config.model,
    webSearch: config.webSearch,
    effort: config.effort,
    signal: input.signal,
    apiKey,
  });
  return { ...answer, ...base, simulated: false };
}
