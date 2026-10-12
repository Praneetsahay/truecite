import "server-only";
import { dedupeCitations, errorDetail, fetchError, httpError, readJson, type AskCitation, type AskInput, type AskResult, type ProviderAdapter } from "./types";

/* ChatGPT through the OpenAI Responses API, with the web search tool. */

type ResponsesOutput = {
  model?: string;
  output?: {
    type?: string;
    content?: { type?: string; text?: string; refusal?: string; annotations?: { type?: string; url?: string; title?: string }[] }[];
  }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

export const openaiAdapter: ProviderAdapter = {
  provider: "openai",
  async ask(input: AskInput): Promise<AskResult> {
    const started = performance.now();
    let body: unknown;
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${input.apiKey}` },
        body: JSON.stringify({
          model: input.model,
          input: input.question,
          ...(input.webSearch ? { tools: [{ type: "web_search" }] } : {}),
          ...(input.effort ? { reasoning: { effort: input.effort } } : {}),
        }),
        signal: input.signal,
      });
      body = await readJson(response);
      if (!response.ok) throw httpError("openai", response.status, errorDetail(body));
    } catch (error) {
      throw fetchError("openai", error, input.signal);
    }

    const data = (body ?? {}) as ResponsesOutput;
    let text = "";
    let refusal = false;
    const citations: AskCitation[] = [];
    let searchCalls = 0;
    for (const item of data.output ?? []) {
      if (item.type === "web_search_call") searchCalls += 1;
      if (item.type !== "message") continue;
      for (const part of item.content ?? []) {
        if (part.type === "output_text" && part.text) {
          text += part.text;
          for (const annotation of part.annotations ?? []) {
            if (annotation.type === "url_citation" && annotation.url) {
              citations.push({ url: annotation.url, title: annotation.title ?? null });
            }
          }
        } else if (part.type === "refusal") {
          refusal = true;
        }
      }
    }

    return {
      text: refusal && !text.trim() ? "ChatGPT declined to answer this question." : text.trim(),
      citations: dedupeCitations(citations),
      model: data.model ?? input.model,
      tokensIn: data.usage?.input_tokens ?? 0,
      tokensOut: data.usage?.output_tokens ?? 0,
      searchCalls,
      raw: body,
      latencyMs: Math.round(performance.now() - started),
      refusal: refusal && !text.trim(),
    };
  },
};
