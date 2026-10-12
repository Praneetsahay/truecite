import "server-only";
import type { FactCategory, PlatformId, QuestionCategory, Verdict } from "@/lib/domain/constants";
import { relevantFacts, type BrandContext, type FactEntry } from "./context";
import type { AskCitation, AskResult } from "./providers/types";
import { hash32, numbersIn, pick, roll, sleep, slugify } from "./text";

/*
  The built-in simulator answers when a platform has no API key and simulated
  answers are on. It is deterministic: the same brand, question, platform, run
  and scan always give the same answer, with no Math.random.

  It writes believable answers from the brand's approved current facts. Each
  platform "believes" some outdated or wrong facts (seeded per brand, fact and
  platform, so the belief repeats across runs and scans, as real model memory
  does) and occasionally makes a one-off slip. About 15 to 25 percent of answers
  carry one error. What it wrote is stored in rawResponse.simulatedStatements so
  the checker can read the verdicts without an API key.
*/

export type SimulatedStatement = {
  text: string;
  factId: string | null;
  verdict: Verdict;
  sentiment: "positive" | "neutral" | "negative";
};

export type SimulatorInput = {
  ctx: BrandContext;
  question: { id: string; text: string; category: QuestionCategory };
  platform: PlatformId;
  runNumber: number;
  scanId: string;
  model: string;
  webSearch: boolean;
  signal?: AbortSignal;
};

type Injected = {
  verdict: "incorrect" | "outdated" | "confused" | "missing";
  text: string;
  factId: string;
  /** The fact the error replaces in the answer. */
  forFactId: string;
  /** From AI memory: the answer carrying it cites nothing. */
  memory: boolean;
  thirdParty: AskCitation | null;
};

/** How often a platform keeps repeating a belief it holds, per answer. */
const BELIEF_REPEAT = 0.7;
/** After the client fixed the source, a belief shows up much less. */
const BELIEF_REPEAT_AFTER_FIX = 0.15;
/** Chance of a one-off slip in an answer without a belief error. */
const ONE_OFF = 0.06;

const TOPIC: Record<FactCategory, string> = {
  pricing: "pricing",
  products: "current products",
  leadership: "leadership team",
  company: "company details",
  policies: "policies",
  support: "support options",
  security: "security practices",
  legal: "legal matters",
  careers: "hiring and workplace",
};

const OWN_PAGE: Record<FactCategory, { path: string; title: string }> = {
  pricing: { path: "/pricing", title: "Pricing" },
  products: { path: "/products", title: "Products" },
  leadership: { path: "/about/leadership", title: "Leadership" },
  company: { path: "/about", title: "About us" },
  policies: { path: "/legal/refund-policy", title: "Refund policy" },
  support: { path: "/support", title: "Support" },
  security: { path: "/security", title: "Security" },
  legal: { path: "/legal", title: "Legal" },
  careers: { path: "/careers", title: "Careers" },
};

function simulatedLatency(...parts: (string | number)[]): number {
  const max = Number(process.env.SIMULATOR_LATENCY_MS ?? 700);
  if (!Number.isFinite(max) || max <= 0) return 0;
  return 100 + (hash32(parts.join("|")) % Math.max(1, Math.round(max)));
}

function descriptor(ctx: BrandContext): string {
  const industry = ctx.brand.industry?.trim();
  if (!industry) return "";
  const lower = /^[A-Z]{2}/.test(industry) ? industry : industry.charAt(0).toLowerCase() + industry.slice(1);
  const noun = /\b(company|provider|platform|software|service|services|bank|insurer|firm|brand)\b/i.test(lower) ? lower : `${lower} company`;
  const article = /^[aeiou]/i.test(noun) ? "an" : "a";
  return `${ctx.brand.name} is ${article} ${noun}.`;
}

function opener(ctx: BrandContext, platform: PlatformId, seed: string): string {
  const describe = descriptor(ctx);
  const options: Record<PlatformId, string[]> = {
    chatgpt: [describe, ""],
    gemini: [`Here is what I found about ${ctx.brand.name}.`, describe],
    perplexity: [""],
    claude: ["From what I can find, here is the current picture.", describe],
  };
  return pick(options[platform], seed, "open");
}

function closer(ctx: BrandContext, platform: PlatformId, seed: string): string {
  const options: Record<PlatformId, string[]> = {
    chatgpt: [`For the latest details, check ${ctx.domain}.`, ""],
    gemini: ["Details like these can change, so it is worth confirming on the official website."],
    perplexity: [""],
    claude: [`It's worth confirming on ${ctx.domain}, since details like this change over time.`],
  };
  return pick(options[platform], seed, "close");
}

/** Changes the first number in a statement to a plausible wrong value. */
function mutateNumber(statement: string, seed: string): string | null {
  const match = statement.match(/([$₹€£]?)(\d[\d,]*)(\.\d+)?/);
  if (!match || match.index === undefined) return null;
  const [whole, symbol, digits, decimals = ""] = match;
  const value = Number(digits.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  let wrong: number;
  if (!symbol && value >= 1900 && value <= 2100) {
    wrong = value - 1 - (hash32(seed) % 3);
  } else {
    const factor = pick([0.6, 0.75, 1.25, 1.5], seed, "factor");
    wrong = Math.max(1, Math.round(value * factor));
    if (wrong === value) wrong = value + 1;
  }
  const formatted = digits.includes(",") ? wrong.toLocaleString("en-US") : String(wrong);
  return statement.slice(0, match.index) + symbol + formatted + decimals + statement.slice(match.index + whole.length);
}

function thirdPartyFor(ctx: BrandContext, fact: FactEntry, verdict: Injected["verdict"]): AskCitation {
  const slug = slugify(ctx.brand.name);
  const name = ctx.brand.name;
  if (verdict === "confused") {
    return { url: `https://businessnews.example/${slug}-group-data-incident`, title: `${name} Group confirms a data incident` };
  }
  switch (fact.category) {
    case "pricing":
      return { url: `https://softwarereviews.example/${slug}-review`, title: `${name} review: pricing, features and alternatives` };
    case "leadership":
    case "company":
      return { url: `https://companydirectory.example/${slug}`, title: `${name} company profile` };
    case "products":
      return { url: `https://techblog.example/${slug}-product-roundup`, title: `Everything ${name} offers` };
    case "policies":
    case "support":
      return { url: `https://founderforum.example/t/${slug}-refunds-and-support`, title: `${name} refunds and support, anyone?` };
    default:
      return { url: `https://techblog.example/${slug}`, title: `${name}, explained` };
  }
}

/** A belief this platform holds about a fact: seeded per brand, fact and platform, so it repeats. */
function beliefFor(ctx: BrandContext, fact: FactEntry, platform: PlatformId): Omit<Injected, "forFactId"> | null {
  const r = roll(ctx.brand.id, fact.id, platform, "belief");
  const memory = platform !== "perplexity" && roll(ctx.brand.id, fact.id, platform, "origin") < 0.45;
  const former = ctx.former.find((old) => ctx.replacement.get(old.id)?.id === fact.id);
  let belief: Pick<Injected, "verdict" | "text" | "factId"> | null = null;

  if (former && r < 0.35) {
    belief = { verdict: "outdated", text: former.statement, factId: former.id };
  } else if ((fact.category === "security" || fact.category === "legal") && r < 0.2) {
    if (/breach/i.test(fact.statement)) {
      const year = 2024 + (hash32(`${ctx.brand.id}|${fact.id}|year`) % 2);
      belief = { verdict: "confused", text: `${ctx.brand.name} disclosed a data breach in ${year} that exposed customer records.`, factId: fact.id };
    } else if (/lawsuit|litigation|court|fine/i.test(fact.statement)) {
      belief = { verdict: "confused", text: `${ctx.brand.name} is facing a class action lawsuit over billing practices.`, factId: fact.id };
    }
  } else if (r >= 0.35 && r < 0.42 && numbersIn(fact.statement).length > 0) {
    const text = mutateNumber(fact.statement, `${ctx.brand.id}|${fact.id}|${platform}`);
    if (text && text !== fact.statement) belief = { verdict: "incorrect", text, factId: fact.id };
  }
  if (!belief) return null;
  return { ...belief, memory, thirdParty: memory ? null : thirdPartyFor(ctx, fact, belief.verdict) };
}

function oneOff(ctx: BrandContext, fact: FactEntry, seed: string): Omit<Injected, "forFactId"> | null {
  const kind = roll(seed, "kind");
  const former = ctx.former.find((old) => ctx.replacement.get(old.id)?.id === fact.id);
  if (kind < 0.4) {
    return {
      verdict: "missing",
      text: `I don't have current information about ${ctx.brand.name}'s ${TOPIC[fact.category]}.`,
      factId: fact.id,
      memory: true,
      thirdParty: null,
    };
  }
  if (kind < 0.8 || !former) {
    const text = mutateNumber(fact.statement, seed);
    if (!text || text === fact.statement) return null;
    return { verdict: "incorrect", text, factId: fact.id, memory: roll(seed, "origin") < 0.5, thirdParty: null };
  }
  return { verdict: "outdated", text: former.statement, factId: former.id, memory: true, thirdParty: null };
}

function sentimentFor(category: QuestionCategory, verdict: Verdict, seed: string): SimulatedStatement["sentiment"] {
  if (verdict === "confused") return "negative";
  if (verdict !== "correct") return "neutral";
  if (category === "trust" || category === "reputation") return "positive";
  return roll(seed, "sentiment") < 0.25 ? "positive" : "neutral";
}

export async function simulateAnswer(input: SimulatorInput): Promise<AskResult & { statements: SimulatedStatement[] }> {
  const { ctx, question, platform, runNumber, scanId } = input;
  const seed = `${ctx.brand.id}|${question.id}|${platform}|${runNumber}|${scanId}`;
  const latency = simulatedLatency(seed, "latency");
  await sleep(latency, input.signal);

  const candidates = relevantFacts(ctx, question).slice(0, 4);
  const count = Math.min(candidates.length, 1 + (hash32(`${seed}|count`) % 3));
  const chosen = candidates.length
    ? [candidates[0], ...candidates.slice(1).sort((a, b) => roll(seed, a.id) - roll(seed, b.id))].slice(0, count)
    : [];

  // At most one error per answer: a belief the platform holds, else rarely a one-off slip.
  let injected: Injected | null = null;
  for (const fact of chosen) {
    const belief = beliefFor(ctx, fact, platform);
    if (!belief) continue;
    const repeat = ctx.fixedFactIds.has(fact.id) ? BELIEF_REPEAT_AFTER_FIX : BELIEF_REPEAT;
    if (roll(seed, fact.id, "repeat") < repeat) {
      injected = { ...belief, forFactId: fact.id };
      break;
    }
  }
  if (!injected && chosen.length > 0 && roll(seed, "one-off") < ONE_OFF) {
    const slip = oneOff(ctx, chosen[0], `${seed}|slip`);
    if (slip) injected = { ...slip, forFactId: chosen[0].id };
  }

  const statements: SimulatedStatement[] = [];
  const body: string[] = [];
  for (const fact of chosen) {
    if (injected && injected.forFactId === fact.id) {
      body.push(injected.text);
      statements.push({
        text: injected.text,
        factId: injected.factId,
        verdict: injected.verdict,
        sentiment: sentimentFor(question.category, injected.verdict, seed),
      });
    } else {
      body.push(fact.statement);
      statements.push({ text: fact.statement, factId: fact.id, verdict: "correct", sentiment: sentimentFor(question.category, "correct", `${seed}|${fact.id}`) });
    }
  }

  if (question.category === "comparisons" && ctx.competitors.length > 0) {
    const names = ctx.competitors.map((c) => c.name);
    const shown = [...names].sort((a, b) => roll(seed, a) - roll(seed, b)).slice(0, Math.min(names.length, 1 + (hash32(`${seed}|rivals`) % 3)));
    const list = shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
    body.push(
      pick(
        [`People often compare ${ctx.brand.name} with ${list}.`, `${list} ${shown.length === 1 ? "is" : "are"} the alternatives mentioned most often.`],
        seed,
        "rivals-text",
      ),
    );
  }

  if (chosen.length === 0) {
    body.push(`I could not find specific, reliable details on this for ${ctx.brand.name}. The company's website, ${ctx.domain}, is the best place to check.`);
  }

  const text = [opener(ctx, platform, seed), ...body, chosen.length ? closer(ctx, platform, seed) : ""]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`))
    .join(" ");

  // Citations: Perplexity always cites; web search on other platforms usually does. Errors from memory cite nothing.
  const citeChance: Record<PlatformId, number> = { perplexity: 1, chatgpt: 0.85, gemini: 0.85, claude: 0.65 };
  const cites = input.webSearch && !(injected?.memory ?? false) && roll(seed, "cites") < citeChance[platform];
  const citations: AskCitation[] = [];
  if (cites) {
    if (injected?.thirdParty) citations.push(injected.thirdParty);
    for (const fact of chosen) {
      if (injected && injected.forFactId === fact.id) continue;
      const page = OWN_PAGE[fact.category];
      citations.push({ url: fact.sourceUrl ?? `https://${ctx.domain}${page.path}`, title: `${page.title} | ${ctx.brand.name}` });
    }
    if (roll(seed, "directory") < 0.3) {
      citations.push({ url: `https://companydirectory.example/${slugify(ctx.brand.name)}`, title: `${ctx.brand.name} company profile` });
    }
  }
  const unique = citations.filter((c, i) => citations.findIndex((other) => other.url === c.url) === i).slice(0, 4);

  return {
    text,
    citations: unique,
    model: input.model,
    tokensIn: 0,
    tokensOut: 0,
    searchCalls: 0,
    raw: { simulated: true, platform, runNumber, simulatedStatements: statements },
    latencyMs: latency,
    statements,
  };
}
