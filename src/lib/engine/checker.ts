import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { PLATFORMS, VERDICTS, type PlatformId, type QuestionCategory, type Verdict } from "@/lib/domain/constants";
import { ERROR_TYPE_IDS, type ErrorType } from "@/lib/domain/playbook";
import { relevantFacts, type BrandContext, type FactEntry } from "./context";
import { anthropicClient, anthropicError } from "./providers/anthropic";
import { providerKey, type Settings } from "./settings";
import type { SimulatedStatement } from "./simulator";
import { contentWords, jaccard, namesIn, numericValues, sentences, sleep, today } from "./text";

/*
  The accuracy checker. For every answer it extracts the factual claims about
  the company as exact quotes, matches each to a Fact Sheet entry and gives a
  verdict, a confidence and a sentiment.

  - Simulated answers: the simulator stored what it wrote, so those verdicts are read back.
  - Real answers with an Anthropic key: a cheap Claude model with structured output.
  - Real answers without a key: a heuristic comparison of numbers and names, with low confidence.
*/

export type CheckedStatement = {
  text: string;
  factId: string | null;
  verdict: Verdict;
  confidence: number;
  sentiment: "positive" | "neutral" | "negative";
  issueTitle: string | null;
  errorType: ErrorType | null;
};

export type CheckResult = {
  statements: CheckedStatement[];
  method: "simulator" | "model" | "heuristic";
  usage: { provider: string; model: string; tokensIn: number; tokensOut: number } | null;
  /** Set when the answer could not be checked; the pipeline leaves it for the next run. */
  error: string | null;
};

export type CheckInput = {
  settings: Settings;
  ctx: BrandContext;
  question: { text: string; category: QuestionCategory };
  platform: PlatformId;
  answerText: string;
  simulatedStatements: SimulatedStatement[] | null;
  now: Date;
};

const VERDICT_IDS = Object.keys(VERDICTS) as [Verdict, ...Verdict[]];

const CheckSchema = z.object({
  statements: z.array(
    z.object({
      text: z.string().describe("The claim copied exactly from the answer, character for character."),
      factId: z.string().nullable().describe("Id of the Fact Sheet entry the claim is about, or null."),
      verdict: z.enum(VERDICT_IDS),
      confidence: z.number().describe("From 0 to 1."),
      sentiment: z.enum(["positive", "neutral", "negative"]),
      issueTitle: z.string().nullable(),
      errorType: z.enum(ERROR_TYPE_IDS as [ErrorType, ...ErrorType[]]).nullable(),
    }),
  ),
});

const INSTRUCTIONS = `You check what an AI assistant said about a company against the company's approved Fact Sheet.

List every factual claim the answer makes about the company: prices, plans, products, people, dates, places, numbers, policies, certifications and incidents. For each claim give:
- text: the claim copied exactly as it appears in the answer, character for character, as one contiguous span (the sentence or clause that carries it). Never paraphrase.
- factId: the id of the Fact Sheet entry the claim is about, or null when no entry covers it.
- verdict:
  correct: matches a current fact.
  incorrect: contradicts a current fact.
  outdated: matches a former fact, one that is no longer valid.
  confused: describes something that belongs to another company, such as an incident, a person or a product.
  unsupported: the Fact Sheet does not cover it, so it cannot be verified.
  missing: the answer says it has no information, or leaves out what the question asked, while the Fact Sheet covers it. Use the sentence where it says so as the text and the fact it should have given as factId.
- confidence: from 0 to 1, how sure you are of the verdict.
- sentiment: how the claim makes the company sound: positive, neutral or negative.
- issueTitle: for incorrect, outdated, confused and missing claims only, a short title for the company's team in sentence case, under eight words, saying what is wrong, such as "Wrong price for Basic plan" or "Names the former CEO". Null for other verdicts.
- errorType: for errors only, one of wrong_price, product_status, confused_company, false_scandal, outdated_facts, wrong_policy, unreadable_pages, old_reviews, other. Null for other verdicts.

Leave out claims about competitors or the market in general, and never list a claim that is not in the answer. If the answer makes no claims about the company, return an empty list.`;

function factLine(ctx: BrandContext, fact: FactEntry): string {
  if (fact.former) {
    const replacement = ctx.replacement.get(fact.id);
    return `[${fact.id}] (${fact.category}) ${fact.statement} (valid until ${fact.validTo}${replacement ? `; replaced by [${replacement.id}]` : ""})`;
  }
  return `[${fact.id}] (${fact.category}, ${fact.importance} importance) ${fact.statement}${fact.validFrom ? ` (valid from ${fact.validFrom})` : ""}`;
}

function systemPrompt(ctx: BrandContext, now: Date): string {
  const lines = [
    INSTRUCTIONS,
    "",
    `Company: ${ctx.brand.name} (${ctx.domain})`,
    `Today: ${today(now)}`,
    "",
    "Fact Sheet, current facts:",
    ...(ctx.current.length ? ctx.current.map((fact) => factLine(ctx, fact)) : ["(none)"]),
    "",
    "Former facts, no longer valid:",
    ...(ctx.former.length ? ctx.former.map((fact) => factLine(ctx, fact)) : ["(none)"]),
  ];
  if (ctx.dismissed.length) {
    lines.push(
      "",
      "The company's team marked these statements as not errors. Do not flag the same statement again unless it clearly contradicts the Fact Sheet:",
      ...ctx.dismissed.slice(0, 30).map((d) => `- "${d.wrongStatement}"${d.note ? ` (their note: ${d.note})` : ""}`),
    );
  }
  return lines.join("\n");
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

async function checkWithModel(input: CheckInput, apiKey: string): Promise<CheckResult> {
  const { settings, ctx } = input;
  const checker = settings.models.checker;
  const client = anthropicClient(apiKey, settings.limits.requestTimeoutMs);
  let tokensIn = 0;
  let tokensOut = 0;
  let lastError = "The checker's reply could not be read.";

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await client.messages.parse({
        model: checker.model,
        max_tokens: 4000,
        output_config: { ...(checker.effort ? { effort: checker.effort } : {}), format: zodOutputFormat(CheckSchema) },
        system: [{ type: "text", text: systemPrompt(ctx, input.now), cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: `Question asked: ${input.question.text}\n\nAnswer from ${PLATFORMS[input.platform].name}:\n<answer>\n${input.answerText}\n</answer>`,
          },
        ],
      });
      tokensIn += response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0);
      tokensOut += response.usage.output_tokens;
      const parsed = response.parsed_output;
      if (response.stop_reason === "refusal" || !parsed) {
        lastError = response.stop_reason === "refusal" ? "The checker declined to check this answer." : "The checker's reply could not be read.";
        continue;
      }
      const statements: CheckedStatement[] = parsed.statements
        .filter((s) => s.text.trim().length > 0)
        .map((s) => {
          const isError = s.verdict === "incorrect" || s.verdict === "outdated" || s.verdict === "confused" || s.verdict === "missing";
          return {
            text: s.text.trim(),
            factId: s.factId && ctx.byId.has(s.factId) ? s.factId : null,
            verdict: s.verdict,
            confidence: clampConfidence(s.confidence),
            sentiment: s.sentiment,
            issueTitle: isError && s.issueTitle ? s.issueTitle.trim().replace(/[.!]+$/, "") : null,
            errorType: isError ? s.errorType : null,
          };
        });
      return {
        statements,
        method: "model",
        usage: { provider: checker.provider, model: checker.model, tokensIn, tokensOut },
        error: null,
      };
    } catch (error) {
      const problem = anthropicError(error);
      lastError = problem.message;
      if (!problem.retryable) break;
      await sleep(2000);
    }
  }
  return {
    statements: [],
    method: "model",
    usage: tokensIn || tokensOut ? { provider: checker.provider, model: checker.model, tokensIn, tokensOut } : null,
    error: lastError,
  };
}

const POSITIVE = /\b(trusted|reliable|popular|well[- ]regarded|praised|easy to use|strong|secure|leading|recommended|good|great|excellent|award)/i;
const NEGATIVE = /\b(breach|lawsuit|complain|complaints|scam|fraud|fine[ds]?|poor|bad|slow|expensive|issues|problems|criticized|controvers)/i;
const NO_INFORMATION =
  /\b(i (?:don't|do not|couldn't|could not|can't|cannot) (?:have|find|access|confirm|verify)|no (?:reliable |current |specific )?information|not (?:able|sure)|unable to (?:find|confirm|verify))/i;

function heuristicSentiment(text: string): CheckedStatement["sentiment"] {
  if (NEGATIVE.test(text)) return "negative";
  if (POSITIVE.test(text)) return "positive";
  return "neutral";
}

/** Facts that answer differently from the sentence: same numbers or names missing, or a former fact's values present. */
function compareWithFact(sentence: string, fact: FactEntry, ctx: BrandContext): { verdict: Verdict; factId: string; confidence: number } {
  const sentenceNumbers = numericValues(sentence);
  const factNumbers = numericValues(fact.statement);
  const sentenceNames = namesIn(sentence, ctx.brand.name);
  const factNames = namesIn(fact.statement, ctx.brand.name);
  const replacement = fact.former ? ctx.replacement.get(fact.id) ?? null : null;

  if (fact.former) {
    // Matches an old fact: outdated when the old values are there and the new ones are not.
    const oldValues = [...numericValues(fact.statement), ...namesIn(fact.statement, ctx.brand.name)];
    const newValues = replacement ? [...numericValues(replacement.statement), ...namesIn(replacement.statement, ctx.brand.name)] : [];
    const distinctive = oldValues.filter((v) => !newValues.includes(v));
    const said = [...sentenceNumbers, ...sentenceNames];
    if (distinctive.length > 0 && distinctive.every((v) => said.includes(v))) return { verdict: "outdated", factId: fact.id, confidence: 0.55 };
    return { verdict: "unsupported", factId: fact.id, confidence: 0.3 };
  }

  if (factNumbers.length > 0 && sentenceNumbers.length > 0) {
    if (factNumbers.every((n) => sentenceNumbers.includes(n))) return { verdict: "correct", factId: fact.id, confidence: 0.6 };
    const former = ctx.former.find((old) => ctx.replacement.get(old.id)?.id === fact.id);
    if (former && numericValues(former.statement).some((n) => sentenceNumbers.includes(n) && !factNumbers.includes(n))) {
      return { verdict: "outdated", factId: former.id, confidence: 0.5 };
    }
    return { verdict: "incorrect", factId: fact.id, confidence: 0.4 };
  }
  if (factNames.length > 0 && sentenceNames.length > 0) {
    if (factNames.every((n) => sentenceNames.includes(n))) return { verdict: "correct", factId: fact.id, confidence: 0.55 };
    const former = ctx.former.find((old) => ctx.replacement.get(old.id)?.id === fact.id);
    if (former && namesIn(former.statement, ctx.brand.name).some((n) => sentenceNames.includes(n) && !factNames.includes(n))) {
      return { verdict: "outdated", factId: former.id, confidence: 0.5 };
    }
    return { verdict: "unsupported", factId: fact.id, confidence: 0.3 };
  }
  return { verdict: "correct", factId: fact.id, confidence: 0.4 };
}

function checkHeuristically(input: CheckInput): CheckResult {
  const { ctx } = input;
  const facts = [...ctx.current, ...ctx.former];
  const brandWords = new Set(contentWords(ctx.brand.name));
  const statements: CheckedStatement[] = [];

  for (const sentence of sentences(input.answerText)) {
    if (NO_INFORMATION.test(sentence.text)) {
      const fact = relevantFacts(ctx, input.question)[0];
      if (fact) {
        statements.push({
          text: sentence.text,
          factId: fact.id,
          verdict: "missing",
          confidence: 0.5,
          sentiment: "neutral",
          issueTitle: null,
          errorType: null,
        });
      }
      continue;
    }
    const words = contentWords(sentence.text).filter((w) => !brandWords.has(w));
    let best: FactEntry | null = null;
    let bestScore = 0;
    for (const fact of facts) {
      const score = jaccard(words, contentWords(fact.statement).filter((w) => !brandWords.has(w)));
      if (score > bestScore) {
        bestScore = score;
        best = fact;
      }
    }
    const mentionsBrand = contentWords(sentence.text).some((w) => brandWords.has(w));
    if (!best || bestScore < 0.25) {
      if (mentionsBrand && sentence.text.length > 20) {
        statements.push({
          text: sentence.text,
          factId: null,
          verdict: "unsupported",
          confidence: 0.3,
          sentiment: heuristicSentiment(sentence.text),
          issueTitle: null,
          errorType: null,
        });
      }
      continue;
    }
    const result = compareWithFact(sentence.text, best, ctx);
    statements.push({
      text: sentence.text,
      factId: result.factId,
      verdict: result.verdict,
      confidence: result.confidence,
      sentiment: heuristicSentiment(sentence.text),
      issueTitle: null,
      errorType: null,
    });
  }
  return { statements, method: "heuristic", usage: null, error: null };
}

export async function checkAnswer(input: CheckInput): Promise<CheckResult> {
  if (input.simulatedStatements) {
    return {
      statements: input.simulatedStatements.map((s) => ({
        text: s.text,
        factId: s.factId && input.ctx.byId.has(s.factId) ? s.factId : null,
        verdict: s.verdict,
        confidence: 0.95,
        sentiment: s.sentiment,
        issueTitle: null,
        errorType: null,
      })),
      method: "simulator",
      usage: null,
      error: null,
    };
  }
  const checker = input.settings.models.checker;
  const apiKey = checker.provider === "anthropic" ? providerKey("anthropic") : null;
  if (apiKey) return checkWithModel(input, apiKey);
  return checkHeuristically(input);
}
