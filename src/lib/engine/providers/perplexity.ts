import "server-only";
import { dedupeCitations, errorDetail, fetchError, httpError, readJson, type AskCitation, type AskInput, type AskResult, type ProviderAdapter } from "./types";

/* Perplexity through its chat completions API, which always searches and returns citations. */

type ChatCompletionOutput = {
  model?: string;
  choices?: { message?: { content?: string } }[];
  search_results?: { url?: string; title?: string }[];
  citations?: string[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/** Removes inline markers such as "[1]" or "[2][3]" and the spaces they leave. */
export function stripCitationMarkers(text: string): string {
  return text
    .replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, "")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export const perplexityAdapter: ProviderAdapter = {
  provider: "perplexity",
  async ask(input: AskInput): Promise<AskResult> {
    const started = performance.now();
    let body: unknown;
    try {
      const response = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${input.apiKey}` },
        body: JSON.stringify({ model: input.model, messages: [{ role: "user", content: input.question }] }),
        signal: input.signal,
      });
      body = await readJson(response);
      if (!response.ok) throw httpError("perplexity", response.status, errorDetail(body));
    } catch (error) {
      throw fetchError("perplexity", error, input.signal);
    }

    const data = (body ?? {}) as ChatCompletionOutput;
    const text = stripCitationMarkers(data.choices?.[0]?.message?.content ?? "");
    const citations: AskCitation[] = data.search_results?.length
      ? data.search_results.filter((r) => r.url).map((r) => ({ url: r.url as string, title: r.title ?? null }))
      : (data.citations ?? []).map((url) => ({ url, title: null }));

    return {
      text,
      citations: dedupeCitations(citations),
      model: data.model ?? input.model,
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
      searchCalls: 1,
      raw: body,
      latencyMs: Math.round(performance.now() - started),
    };
  },
};
