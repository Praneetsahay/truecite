import type { Effort, ProviderId } from "../settings";

/*
  Every AI platform sits behind the same small interface, so adding a provider
  or switching a model is a settings change, not a rewrite of the scan logic.
*/

export type AskInput = {
  question: string;
  model: string;
  webSearch: boolean;
  effort?: Effort;
  signal: AbortSignal;
  apiKey: string;
};

export type AskCitation = { url: string; title: string | null };

export type AskResult = {
  text: string;
  citations: AskCitation[];
  /** The model as served, which can differ from the one requested (aliases, fallbacks). */
  model: string;
  tokensIn: number;
  tokensOut: number;
  searchCalls: number;
  raw: unknown;
  latencyMs: number;
  /** The assistant declined to answer. The answer is stored, but it has no statements to check. */
  refusal?: boolean;
};

export type ProviderAdapter = {
  provider: ProviderId;
  ask(input: AskInput): Promise<AskResult>;
};

/** How people see each provider in error messages. */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: "OpenAI API",
  google: "Gemini API",
  perplexity: "Perplexity API",
  anthropic: "Anthropic API",
};

/**
 * A failed request. `retryable` tells the queue whether waiting and trying again
 * can help (timeouts, rate limits, server errors) or not (a rejected key, a bad request).
 */
export class ProviderError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;
  readonly kind: "timeout" | "rate_limit" | "auth" | "bad_request" | "server" | "network" | "config";

  constructor(input: {
    message: string;
    retryable: boolean;
    status?: number | null;
    kind: ProviderError["kind"];
  }) {
    super(input.message);
    this.name = "ProviderError";
    this.retryable = input.retryable;
    this.status = input.status ?? null;
    this.kind = input.kind;
  }
}

/** Turns an HTTP status from a provider into a ProviderError with a message written for people. */
export function httpError(provider: ProviderId, status: number, detail: string | null): ProviderError {
  const label = PROVIDER_LABELS[provider];
  const suffix = detail ? `: ${detail.slice(0, 200)}` : "";
  if (status === 401 || status === 403) {
    return new ProviderError({
      message: `${label} rejected the API key (HTTP ${status}). Check the key in the server environment.`,
      retryable: false,
      status,
      kind: "auth",
    });
  }
  if (status === 429) {
    return new ProviderError({ message: `${label} rate limit reached`, retryable: true, status, kind: "rate_limit" });
  }
  if (status === 408 || status === 409 || status >= 500) {
    return new ProviderError({ message: `${label} returned an error (HTTP ${status})`, retryable: true, status, kind: "server" });
  }
  return new ProviderError({
    message: `${label} rejected the request (HTTP ${status})${suffix}`,
    retryable: false,
    status,
    kind: "bad_request",
  });
}

/** Converts an aborted or failed fetch into a ProviderError. */
export function fetchError(provider: ProviderId, error: unknown, signal: AbortSignal): ProviderError {
  if (error instanceof ProviderError) return error;
  const label = PROVIDER_LABELS[provider];
  if (signal.aborted) {
    return new ProviderError({ message: `${label} request timed out`, retryable: true, kind: "timeout" });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ProviderError({ message: `Could not reach the ${label}: ${message}`, retryable: true, kind: "network" });
}

/** Reads a JSON body, or null when the body is not JSON. */
export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** The provider's own error message from a JSON error body, when there is one. */
export function errorDetail(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return null;
}

export function dedupeCitations(citations: AskCitation[]): AskCitation[] {
  const seen = new Set<string>();
  const result: AskCitation[] = [];
  for (const citation of citations) {
    const url = citation.url.trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    result.push({ url, title: citation.title?.trim() || null });
  }
  return result;
}
