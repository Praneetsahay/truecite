import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { getDb, usageCosts } from "@/lib/db";
import {
  FACT_CATEGORIES,
  IMPORTANCE,
  QUESTION_CATEGORIES,
  type FactCategory,
  type Importance,
  type QuestionCategory,
} from "@/lib/domain/constants";
import { requestCost } from "@/lib/domain/costs";
import { displayUrl } from "@/lib/domain/format";
import type { CrawledPage } from "./crawler";
import { normalizeWebsite } from "./crawler";
import { priceFor, providerKey, type Settings } from "./settings";

/*
  Turns crawled pages into draft facts, either with the checker model (when an
  Anthropic key is set and the checker runs on Anthropic) or with a small set of
  rules that only state what the pages say word for word.
*/

export type DraftFact = {
  category: FactCategory;
  statement: string;
  importance: Importance;
  sourceUrl: string | null;
  /** YYYY-MM-DD */
  validFrom: string | null;
};

export type BrandBasics = {
  id: string;
  organizationId: string;
  name: string;
  website: string;
  description: string | null;
  industry: string | null;
};

type CheckerUsage = { provider: string; model: string; tokensIn: number; tokensOut: number };

/** True when the checker model can be called: it runs on Anthropic and the key is set. */
export function checkerAvailable(settings: Settings): boolean {
  return settings.models.checker.provider === "anthropic" && providerKey("anthropic") !== null;
}

async function askChecker<T>(input: {
  settings: Settings;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  maxTokens: number;
}): Promise<{ parsed: T | null; usage: CheckerUsage }> {
  const { settings } = input;
  const checker = settings.models.checker;
  const client = new Anthropic({
    apiKey: providerKey("anthropic") ?? undefined,
    timeout: Math.max(settings.limits.requestTimeoutMs, 120_000),
    maxRetries: Math.max(0, settings.limits.maxAttempts - 1),
  });
  const response = await client.messages.parse({
    model: checker.model,
    max_tokens: input.maxTokens,
    system: input.system,
    messages: [{ role: "user", content: input.prompt }],
    output_config: { effort: checker.effort ?? "low", format: zodOutputFormat(input.schema) },
  });
  const usage = response.usage;
  return {
    parsed: response.stop_reason === "refusal" ? null : (response.parsed_output ?? null),
    usage: {
      provider: "anthropic",
      model: checker.model,
      tokensIn: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
      tokensOut: usage.output_tokens,
    },
  };
}

/** Writes the cost of a checker call to usage_costs, priced from the settings table. */
export async function recordUsage(input: {
  settings: Settings;
  organizationId: string;
  brandId: string;
  purpose: "facts" | "questions";
  usage: CheckerUsage;
}): Promise<void> {
  const price = priceFor(input.settings.prices, input.usage.provider, input.usage.model);
  const costUsd = price
    ? requestCost({ tokensIn: input.usage.tokensIn, tokensOut: input.usage.tokensOut, searchCalls: 0 }, price)
    : 0;
  const db = await getDb();
  await db.insert(usageCosts).values({
    organizationId: input.organizationId,
    brandId: input.brandId,
    provider: input.usage.provider,
    model: input.usage.model,
    purpose: input.purpose,
    tokensIn: input.usage.tokensIn,
    tokensOut: input.usage.tokensOut,
    searchCalls: 0,
    costUsd,
    day: new Date().toISOString().slice(0, 10),
  });
}

/* With the checker model. */

const factCategoryIds = Object.keys(FACT_CATEGORIES) as [FactCategory, ...FactCategory[]];
const importanceIds = Object.keys(IMPORTANCE) as [Importance, ...Importance[]];

const FactsSchema = z.object({
  facts: z.array(
    z.object({
      category: z.enum(factCategoryIds),
      statement: z.string(),
      importance: z.enum(importanceIds),
      sourceUrl: z.string(),
      validFrom: z.string().nullable(),
    }),
  ),
});

const FACTS_SYSTEM = `You draft a company's Fact Sheet from its own public web pages. TrueCite later checks what AI assistants say about the company against the facts the company approves, so every fact must be:
- one plain sentence that names the company or the product and can be checked against an AI answer, such as "Acme's Basic plan costs $79 per month." or "Priya Nair is the chief executive of Acme.";
- stated on one of the pages given, never taken from memory or inferred;
- specific: prices with currency and billing period, plan and product names, what each product does, leaders with their titles, founding year, headquarters and offices, customer or employee numbers when stated, refund, cancellation and support policies, security certifications, legal and regulatory facts.

Leave out marketing claims and opinions (fastest, best, easy, trusted), testimonials, customer logos, blog posts and anything about other companies.

Fields:
- category: pricing, products, leadership, company, policies, support, security, legal or careers.
- importance: critical when an AI error would cause legal, financial or safety harm (prices, security and compliance, legal status); high for leadership, core products and refund or cancellation policies; medium for other company facts; low for minor details.
- sourceUrl: the URL of the page the fact came from, exactly as given.
- validFrom: the date the fact took effect as YYYY-MM-DD, only when the page states it; otherwise null.

Include one fact that states the company's official website. Return at most 40 facts, the most important first.`;

const MAX_PAGE_CHARS = 15_000;
const MAX_PROMPT_CHARS = 110_000;

export async function extractFactsWithModel(input: {
  settings: Settings;
  brand: BrandBasics;
  pages: CrawledPage[];
}): Promise<DraftFact[] | null> {
  const { brand, pages, settings } = input;
  let budget = MAX_PROMPT_CHARS;
  const sections: string[] = [];
  for (const page of pages) {
    if (budget <= 0) break;
    const text = page.text.slice(0, Math.min(MAX_PAGE_CHARS, budget));
    budget -= text.length;
    const title = page.title.replace(/"/g, "'");
    const description = page.description ? `\n${page.description}` : "";
    sections.push(`<page url="${page.url}" title="${title}">${description}\n${text}\n</page>`);
  }
  const prompt = `Company: ${brand.name}\nOfficial website: ${brand.website}\n\n${sections.join("\n\n")}`;
  const { parsed, usage } = await askChecker({
    settings,
    schema: FactsSchema,
    system: FACTS_SYSTEM,
    prompt,
    maxTokens: 16_000,
  });
  await recordUsage({ settings, organizationId: brand.organizationId, brandId: brand.id, purpose: "facts", usage });
  if (!parsed) return null;

  const urls = new Set(pages.map((p) => p.url));
  return parsed.facts
    .map((fact) => ({
      category: fact.category,
      statement: sentence(fact.statement),
      importance: fact.importance,
      sourceUrl: urls.has(fact.sourceUrl) ? fact.sourceUrl : (pages[0]?.url ?? null),
      validFrom: fact.validFrom && /^\d{4}-\d{2}-\d{2}$/.test(fact.validFrom) ? fact.validFrom : null,
    }))
    .filter((fact) => fact.statement.length >= 12 && fact.statement.length <= 400)
    .slice(0, 40);
}

const questionCategoryIds = Object.keys(QUESTION_CATEGORIES) as [QuestionCategory, ...QuestionCategory[]];

const QuestionsSchema = z.object({
  questions: z.array(z.object({ text: z.string(), category: z.enum(questionCategoryIds) })),
});

const QUESTIONS_SYSTEM = `You write the questions real customers, journalists and job seekers type into AI assistants such as ChatGPT about one company. TrueCite asks these questions and checks the answers against the company's approved facts.

Write short, natural questions in plain English, the way a person would type them. Each question names the company or one of its products, and each is grounded in the approved facts given (a price, a plan, a product, a policy, a leader, a market). Do not repeat questions already in the set, do not put the answer in the question, and do not ask only about other companies.

Categories: pricing, products, company, trust, comparisons, policies, reputation, careers.`;

export async function suggestQuestionsWithModel(input: {
  settings: Settings;
  brand: BrandBasics;
  facts: string[];
  competitors: string[];
  existing: string[];
  limit: number;
}): Promise<{ text: string; category: QuestionCategory }[]> {
  const { brand, settings } = input;
  const prompt = [
    `Company: ${brand.name} (${brand.website})`,
    brand.industry ? `Industry: ${brand.industry}` : "",
    input.competitors.length ? `Competitors: ${input.competitors.join(", ")}` : "",
    `Approved facts:\n${input.facts.map((f) => `- ${f}`).join("\n")}`,
    `Questions already in the set:\n${input.existing.map((q) => `- ${q}`).join("\n")}`,
    `Write up to ${input.limit} new questions.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const { parsed, usage } = await askChecker({
    settings,
    schema: QuestionsSchema,
    system: QUESTIONS_SYSTEM,
    prompt,
    maxTokens: 4_000,
  });
  await recordUsage({ settings, organizationId: brand.organizationId, brandId: brand.id, purpose: "questions", usage });
  if (!parsed) return [];
  return parsed.questions
    .map((q) => ({ text: q.text.replace(/\s+/g, " ").trim(), category: q.category }))
    .filter((q) => q.text.length >= 10 && q.text.length <= 200)
    .slice(0, input.limit);
}

/* Without the model: only what the pages state, word for word. */

/** One sentence: collapsed spaces and a closing full stop. */
export function sentence(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return trimmed;
  return /[.!?"”)]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

const PRICE_PATTERN =
  /(US\$|\$|₹|€|£|Rs\.?\s?|INR\s?|USD\s?|EUR\s?|GBP\s?)(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(\s?k\b)?/g;

const UNIT_WORDS: Record<string, string> = {
  user: "user",
  users: "user",
  seat: "seat",
  seats: "seat",
  employee: "employee",
  employees: "employee",
  member: "member",
  members: "member",
  person: "person",
};

const PERIOD_WORDS: Record<string, string> = {
  month: "per month",
  mo: "per month",
  monthly: "per month",
  year: "per year",
  yr: "per year",
  annum: "per year",
  annually: "per year",
  yearly: "per year",
};

const NOT_PLAN_NAMES = new Set([
  "pricing",
  "plans",
  "plan",
  "monthly",
  "annual",
  "annually",
  "yearly",
  "popular",
  "most popular",
  "recommended",
  "best value",
  "features",
  "compare plans",
  "get started",
  "contact sales",
  "start free trial",
  "billed monthly",
  "billed annually",
  "per month",
  "save",
]);

function planNameFrom(text: string): string | null {
  const candidate = text
    .replace(/[:–—|-]+\s*$/, "")
    .replace(/\s+plan$/i, "")
    .trim();
  if (!candidate || candidate.length > 30 || /\d/.test(candidate)) return null;
  const words = candidate.split(/\s+/);
  if (words.length > 3 || !/^[A-Z]/.test(candidate)) return null;
  if (NOT_PLAN_NAMES.has(candidate.toLowerCase())) return null;
  return candidate;
}

function readPrices(page: CrawledPage, brandName: string): DraftFact[] {
  const lines = page.text.split("\n");
  const found = new Map<string, DraftFact>();
  lines.forEach((line, index) => {
    for (const match of line.matchAll(PRICE_PATTERN)) {
      if (found.size >= 6) return;
      const at = match.index ?? 0;
      const before = line.slice(Math.max(0, at - 24), at).toLowerCase();
      if (/\b(save|off|discount|worth|refund|fee of|up to)\b\s*$/.test(before) || /\b(save|off)\b/.test(before)) continue;
      const symbol = match[1].trim();
      const amount = match[2];
      const thousands = match[3] ? "k" : "";
      const price = /^[A-Z]{3}$|^Rs\.?$/.test(symbol) ? `${symbol} ${amount}${thousands}` : `${symbol}${amount}${thousands}`;
      const after = line.slice(at + match[0].length, at + match[0].length + 48).toLowerCase();
      const words = after.match(/[a-z]+/g) ?? [];
      let unit: string | null = null;
      let period: string | null = null;
      for (const word of words.slice(0, 6)) {
        if (!unit && UNIT_WORDS[word]) unit = UNIT_WORDS[word];
        if (!period && PERIOD_WORDS[word]) period = PERIOD_WORDS[word];
      }
      const terms = [unit ? `per ${unit}` : null, period].filter(Boolean).join(" ");

      // The plan name: the words before the price on the same line, or a short heading just above it.
      let plan = planNameFrom(line.slice(0, at).trim());
      for (let back = 1; !plan && back <= 4 && index - back >= 0; back++) {
        plan = planNameFrom(lines[index - back].trim());
      }
      const startsAt = /\b(from|starting at|starts at|as low as)\s*$/.test(before);
      const key = `${plan ?? ""}|${price}|${terms}`;
      if (found.has(key)) continue;
      const free = Number(amount.replace(/,/g, "")) === 0;
      let statement: string;
      if (plan && free) statement = `${possessive(brandName)} ${plan} plan is free.`;
      else if (plan) statement = `${possessive(brandName)} ${plan} plan costs ${price}${terms ? ` ${terms}` : ""}.`;
      else if (startsAt) statement = `${possessive(brandName)} plans start at ${price}${terms ? ` ${terms}` : ""}.`;
      else if (terms) statement = `${possessive(brandName)} pricing page lists a price of ${price} ${terms}.`;
      else continue; // a bare amount with no plan and no billing period says too little to check
      found.set(key, { category: "pricing", statement, importance: "high", sourceUrl: page.url, validFrom: null });
    }
  });
  return [...found.values()];
}

const EMAIL_PRIORITY = ["hello", "contact", "info", "support", "help", "sales", "press", "media", "team"];

function pickEmail(pages: CrawledPage[], siteHost: string): { email: string; url: string } | null {
  const found: { email: string; url: string }[] = [];
  for (const page of pages) {
    const inText = page.text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
    const structured = page.organization?.email ? [page.organization.email] : [];
    for (const email of [...structured, ...page.emails, ...inText]) {
      const lower = email.toLowerCase();
      const domain = lower.split("@")[1] ?? "";
      if (domain !== siteHost && !domain.endsWith(`.${siteHost}`)) continue;
      if (/^(no-?reply|donotreply|example|you|your|name|user|test)@/.test(lower)) continue;
      found.push({ email: lower, url: page.url });
    }
  }
  if (found.length === 0) return null;
  for (const prefix of EMAIL_PRIORITY) {
    const match = found.find((f) => f.email.startsWith(`${prefix}@`));
    if (match) return match;
  }
  return found[0];
}

const HQ_PATTERNS = [
  /\b(?:headquartered|head-quartered)\s+in\s+([A-Z][A-Za-z.'-]+(?:,?\s+[A-Z][A-Za-z.'-]+){0,4})/,
  /\b(?:headquarters|head office|registered office|HQ)\s+(?:is\s+|are\s+)?(?:located\s+)?in\s+([A-Z][A-Za-z.'-]+(?:,?\s+[A-Z][A-Za-z.'-]+){0,4})/,
  /\b(?:Headquarters|Head office|HQ)\s*[:–—-]\s*([A-Z][A-Za-z.'-]+(?:,?\s+[A-Z][A-Za-z.'-]+){0,4})/,
];

function readHeadquarters(pages: CrawledPage[], brandName: string): DraftFact | null {
  for (const page of pages) {
    for (const pattern of HQ_PATTERNS) {
      const match = pattern.exec(page.text);
      if (!match) continue;
      const place = match[1].replace(/[,\s]+$/, "").trim();
      if (place.length < 3) continue;
      return {
        category: "company",
        statement: `${brandName} is headquartered in ${place}.`,
        importance: "medium",
        sourceUrl: page.url,
        validFrom: null,
      };
    }
  }
  return null;
}

function describe(home: CrawledPage | undefined, brand: BrandBasics): DraftFact | null {
  const name = brand.name;
  const namePattern = new RegExp(`(^|[^A-Za-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`, "i");
  const mentionsName = (text: string) => namePattern.test(text);
  const quoted = (text: string, url: string | null, lead: string): DraftFact => {
    const body = text.replace(/\s+/g, " ").trim();
    const statement =
      mentionsName(body) && body.split(" ").length >= 5 ? sentence(body) : `${lead} “${body.replace(/[.\s]+$/, "")}.”`;
    return { category: "company", statement, importance: "medium", sourceUrl: url, validFrom: null };
  };

  if (home) {
    if (home.description && home.description.length >= 20) {
      return quoted(home.description.slice(0, 300), home.url, `${possessive(name)} website describes it as`);
    }
    const line = home.text
      .split("\n")
      .find((l) => l.length >= 40 && l.length <= 300 && l.split(" ").length >= 7 && !/cookie|javascript|browser/i.test(l));
    if (line) return quoted(line, home.url, `${possessive(name)} home page says:`);
    const parts = home.title.split(/\s+[|–—:-]\s+/).filter((p) => p.trim() && p.trim().toLowerCase() !== name.toLowerCase());
    const tagline = parts.find((p) => p.split(" ").length >= 3);
    if (tagline) return quoted(tagline, home.url, `${possessive(name)} home page describes it as`);
  }
  if (brand.description && brand.description.trim().length >= 10) {
    return quoted(brand.description.slice(0, 300), null, `${name} describes its business as`);
  }
  return null;
}

/**
 * The deterministic draft: the company name and website, what it does in its own
 * words, prices from pricing pages, a contact email and the headquarters when stated.
 */
export function draftFromPages(brand: BrandBasics, pages: CrawledPage[]): DraftFact[] {
  const site = normalizeWebsite(brand.website);
  const siteHost = site ? site.hostname.toLowerCase().replace(/^www\./, "") : "";
  const facts: DraftFact[] = [];
  if (site) {
    facts.push({
      category: "company",
      statement: `The official website of ${brand.name} is ${displayUrl(site.toString())}.`,
      importance: "high",
      sourceUrl: pages[0]?.url ?? site.toString(),
      validFrom: null,
    });
  }
  const home = pages.find((p) => p.kind === "home");
  const description = describe(home, brand);
  if (description) facts.push(description);
  for (const page of pages.filter((p) => p.kind === "pricing")) facts.push(...readPrices(page, brand.name));
  const email = siteHost ? pickEmail(pages, siteHost) : null;
  if (email) {
    facts.push({
      category: "support",
      statement: `${possessive(brand.name)} contact email address is ${email.email}.`,
      importance: "low",
      sourceUrl: email.url,
      validFrom: null,
    });
  }
  const headquarters = readHeadquarters(pages, brand.name);
  if (headquarters) facts.push(headquarters);
  return facts;
}
