import "server-only";
import { dedupeCitations, errorDetail, fetchError, httpError, readJson, type AskInput, type AskResult, type ProviderAdapter } from "./types";

/* Gemini through the Gemini API, grounded with Google Search. */

type GenerateContentOutput = {
  modelVersion?: string;
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: string; thought?: boolean }[] };
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[]; webSearchQueries?: string[] };
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

const BLOCKED = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]);

export const geminiAdapter: ProviderAdapter = {
  provider: "google",
  async ask(input: AskInput): Promise<AskResult> {
    const started = performance.now();
    let body: unknown;
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": input.apiKey },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: input.question }] }],
            ...(input.webSearch ? { tools: [{ google_search: {} }] } : {}),
          }),
          signal: input.signal,
        },
      );
      body = await readJson(response);
      if (!response.ok) throw httpError("google", response.status, errorDetail(body));
    } catch (error) {
      throw fetchError("google", error, input.signal);
    }

    const data = (body ?? {}) as GenerateContentOutput;
    const candidate = data.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .filter((part) => !part.thought)
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    const grounding = candidate?.groundingMetadata;
    const citations = (grounding?.groundingChunks ?? [])
      .map((chunk) => chunk.web)
      .filter((web): web is { uri: string; title?: string } => Boolean(web?.uri))
      .map((web) => ({ url: web.uri, title: web.title ?? null }));
    const refusal = !text && (Boolean(data.promptFeedback?.blockReason) || BLOCKED.has(candidate?.finishReason ?? ""));

    return {
      text: refusal ? "Gemini declined to answer this question." : text,
      citations: dedupeCitations(citations),
      model: data.modelVersion ?? input.model,
      tokensIn: data.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: data.usageMetadata?.candidatesTokenCount ?? 0,
      searchCalls: grounding ? 1 : 0,
      raw: body,
      latencyMs: Math.round(performance.now() - started),
      refusal,
    };
  },
};
