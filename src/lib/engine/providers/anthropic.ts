import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { dedupeCitations, PROVIDER_LABELS, ProviderError, type AskCitation, type AskInput, type AskResult, type ProviderAdapter } from "./types";

/*
  Claude through the official Anthropic SDK. Answers use web search, effort from
  settings, and server-side refusal fallbacks on the models that support them.
*/

const LABEL = PROVIDER_LABELS.anthropic;

/** Models that take the dynamic-filtering web search tool and server-side fallbacks. */
const CURRENT_GENERATION = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

const MAX_CONTINUATIONS = 3;

export function anthropicClient(apiKey: string, timeoutMs: number): Anthropic {
  // The scan queue retries with its own backoff, so the SDK does not retry on its own.
  return new Anthropic({ apiKey, maxRetries: 0, timeout: timeoutMs });
}

type AnyBlock = Anthropic.ContentBlock | Anthropic.Beta.BetaContentBlock;

/** Converts an SDK error into a ProviderError the queue understands. */
export function anthropicError(error: unknown, signal?: AbortSignal): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof Anthropic.APIUserAbortError || signal?.aborted) {
    return new ProviderError({ message: `${LABEL} request timed out`, retryable: true, kind: "timeout" });
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ProviderError({ message: `${LABEL} request timed out`, retryable: true, kind: "timeout" });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError({ message: `Could not reach the ${LABEL}: ${error.message}`, retryable: true, kind: "network" });
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError({
      message: `${LABEL} rejected the API key (HTTP ${error.status}). Check ANTHROPIC_API_KEY.`,
      retryable: false,
      status: error.status,
      kind: "auth",
    });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ProviderError({ message: `${LABEL} rate limit reached`, retryable: true, status: 429, kind: "rate_limit" });
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? null;
    if (status !== null && (status >= 500 || status === 408 || status === 409 || status === 529)) {
      return new ProviderError({ message: `${LABEL} returned an error (HTTP ${status})`, retryable: true, status, kind: "server" });
    }
    return new ProviderError({
      message: `${LABEL} rejected the request (HTTP ${status ?? "?"}): ${error.message.slice(0, 200)}`,
      retryable: false,
      status,
      kind: "bad_request",
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ProviderError({ message: `${LABEL} request failed: ${message}`, retryable: true, kind: "network" });
}

function collect(blocks: readonly AnyBlock[]): { text: string; citations: AskCitation[] } {
  let text = "";
  const cited: AskCitation[] = [];
  const searched: AskCitation[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      text += block.text;
      for (const citation of block.citations ?? []) {
        if (citation.type === "web_search_result_location") {
          cited.push({ url: citation.url, title: citation.title ?? null });
        }
      }
    } else if (block.type === "web_search_tool_result") {
      // A failed search returns an error object instead of a list of results.
      if (Array.isArray(block.content)) {
        for (const result of block.content) {
          if (result.type === "web_search_result") searched.push({ url: result.url, title: result.title ?? null });
        }
      }
    }
  }
  // Links the answer actually cited come first, then the other pages it read.
  return { text: text.trim(), citations: dedupeCitations([...cited, ...searched]) };
}

export const anthropicAdapter: ProviderAdapter = {
  provider: "anthropic",
  async ask(input: AskInput): Promise<AskResult> {
    const started = performance.now();
    const client = anthropicClient(input.apiKey, 10 * 60_000);
    const current = CURRENT_GENERATION.has(input.model);
    const tools: Anthropic.Beta.BetaToolUnion[] = input.webSearch
      ? [
          current
            ? { type: "web_search_20260209", name: "web_search", max_uses: 3 }
            : { type: "web_search_20250305", name: "web_search", max_uses: 3 },
        ]
      : [];

    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: input.question }];
    const blocks: AnyBlock[] = [];
    const responses: unknown[] = [];
    let tokensIn = 0;
    let tokensOut = 0;
    let searchCalls = 0;
    let servedModel = input.model;
    let refusal = false;

    try {
      for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
        const response = await client.beta.messages.create(
          {
            model: input.model,
            max_tokens: 8000,
            messages,
            ...(tools.length > 0 ? { tools } : {}),
            ...(input.effort ? { output_config: { effort: input.effort } } : {}),
            ...(current ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
          },
          { signal: input.signal },
        );
        responses.push(response);
        servedModel = response.model;
        tokensIn += response.usage.input_tokens;
        tokensOut += response.usage.output_tokens;
        searchCalls += response.usage.server_tool_use?.web_search_requests ?? 0;
        blocks.push(...response.content);

        if (response.stop_reason === "refusal") {
          refusal = true;
          break;
        }
        // A long search turn can pause; send the content back and let it continue.
        if (response.stop_reason === "pause_turn" && turn < MAX_CONTINUATIONS) {
          messages.push({ role: "assistant", content: response.content });
          continue;
        }
        // "max_tokens" keeps what was written so far; "end_turn" is the normal finish.
        break;
      }
    } catch (error) {
      throw anthropicError(error, input.signal);
    }

    const { text, citations } = collect(blocks);
    return {
      text: refusal ? "Claude declined to answer this question." : text,
      citations: refusal ? [] : citations,
      model: servedModel,
      tokensIn,
      tokensOut,
      searchCalls,
      raw: responses.length === 1 ? responses[0] : responses,
      latencyMs: Math.round(performance.now() - started),
      refusal,
    };
  },
};
