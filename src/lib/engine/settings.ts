import "server-only";
import { eq, inArray } from "drizzle-orm";
import { getDb, settings as settingsTable } from "@/lib/db";
import type { PlatformId } from "@/lib/domain/constants";
import type { ModelPrice } from "@/lib/domain/costs";

/*
  Models, prices and feature switches live in the settings table, not in code,
  so changing a model or a price is a setting change. These defaults apply only
  when a row is missing.
*/

export type ProviderId = "openai" | "google" | "perplexity" | "anthropic";
export type Effort = "low" | "medium" | "high";

export type ModelsSetting = {
  /** The model that answers customer questions on each platform, with web search where available. */
  answer: Record<PlatformId, { provider: ProviderId; model: string; webSearch: boolean; effort?: Effort }>;
  /** A cheaper model that extracts and checks statements. */
  checker: { provider: ProviderId; model: string; effort?: Effort };
};

export type FeaturesSetting = {
  /** Every new issue waits for an admin before the client sees it. */
  reviewQueue: boolean;
  competitorScans: boolean;
  sourceTracing: boolean;
  instantAlerts: boolean;
  /** Without an API key, a platform answers from the built-in simulator instead of failing. */
  simulateWithoutKeys: boolean;
  crisisMode: boolean;
  indianLanguages: boolean;
};

export type LimitsSetting = {
  maxConcurrentRequests: number;
  requestTimeoutMs: number;
  maxAttempts: number;
};

export type Settings = {
  models: ModelsSetting;
  prices: ModelPrice[];
  features: FeaturesSetting;
  limits: LimitsSetting;
};

export const DEFAULT_SETTINGS: Settings = {
  models: {
    answer: {
      chatgpt: { provider: "openai", model: "gpt-5-mini", webSearch: true },
      gemini: { provider: "google", model: "gemini-2.5-flash", webSearch: true },
      perplexity: { provider: "perplexity", model: "sonar", webSearch: true },
      claude: { provider: "anthropic", model: "claude-opus-5-5", webSearch: true, effort: "medium" },
    },
    checker: { provider: "anthropic", model: "claude-haiku-5-5", effort: "low" },
  },
  prices: [
    { provider: "openai", model: "gpt-5-mini", inputPerMTok: 0.25, outputPerMTok: 2, perSearchCall: 0.01 },
    { provider: "google", model: "gemini-2.5-flash", inputPerMTok: 0.3, outputPerMTok: 2.5, perSearchCall: 0.035 },
    { provider: "perplexity", model: "sonar", inputPerMTok: 1, outputPerMTok: 1, perSearchCall: 0.005 },
    { provider: "anthropic", model: "claude-opus-5-5", inputPerMTok: 4, outputPerMTok: 20, perSearchCall: 0.01 },
    { provider: "anthropic", model: "claude-sonnet-5-5", inputPerMTok: 2, outputPerMTok: 10, perSearchCall: 0.01 },
    { provider: "anthropic", model: "claude-haiku-5-5", inputPerMTok: 0.1, outputPerMTok: 0.5, perSearchCall: 0.01 },
  ],
  features: {
    reviewQueue: true,
    competitorScans: true,
    sourceTracing: true,
    instantAlerts: true,
    simulateWithoutKeys: true,
    crisisMode: false,
    indianLanguages: false,
  },
  limits: { maxConcurrentRequests: 4, requestTimeoutMs: 60_000, maxAttempts: 3 },
};

const KEYS = ["models", "prices", "features", "limits"] as const;
type SettingKey = (typeof KEYS)[number];

export async function getSettings(): Promise<Settings> {
  const db = await getDb();
  const rows = await db.select().from(settingsTable).where(inArray(settingsTable.key, [...KEYS]));
  const stored = Object.fromEntries(rows.map((row) => [row.key, row.value])) as Partial<Settings>;
  return {
    models: {
      answer: { ...DEFAULT_SETTINGS.models.answer, ...(stored.models?.answer ?? {}) },
      checker: { ...DEFAULT_SETTINGS.models.checker, ...(stored.models?.checker ?? {}) },
    },
    prices: Array.isArray(stored.prices) && stored.prices.length > 0 ? stored.prices : DEFAULT_SETTINGS.prices,
    features: { ...DEFAULT_SETTINGS.features, ...(stored.features ?? {}) },
    limits: { ...DEFAULT_SETTINGS.limits, ...(stored.limits ?? {}) },
  };
}

export async function updateSetting<K extends SettingKey>(key: K, value: Settings[K]): Promise<void> {
  const db = await getDb();
  const [existing] = await db.select({ key: settingsTable.key }).from(settingsTable).where(eq(settingsTable.key, key)).limit(1);
  if (existing) {
    await db.update(settingsTable).set({ value, updatedAt: new Date() }).where(eq(settingsTable.key, key));
  } else {
    await db.insert(settingsTable).values({ key, value });
  }
}

export function priceFor(prices: readonly ModelPrice[], provider: string, model: string): ModelPrice | null {
  return prices.find((p) => p.provider === provider && p.model === model) ?? null;
}

/** API keys stay on the server, in environment variables. This only reports whether each is set. */
export const PROVIDER_ENV = {
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  email: "RESEND_API_KEY",
} as const;

export function providerKey(provider: keyof typeof PROVIDER_ENV): string | null {
  const value = process.env[PROVIDER_ENV[provider]];
  return value && value.trim() ? value.trim() : null;
}

export function providerStatus(): Record<keyof typeof PROVIDER_ENV, { configured: boolean; envVar: string }> {
  return Object.fromEntries(
    (Object.keys(PROVIDER_ENV) as (keyof typeof PROVIDER_ENV)[]).map((provider) => [
      provider,
      { configured: providerKey(provider) !== null, envVar: PROVIDER_ENV[provider] },
    ]),
  ) as Record<keyof typeof PROVIDER_ENV, { configured: boolean; envVar: string }>;
}
