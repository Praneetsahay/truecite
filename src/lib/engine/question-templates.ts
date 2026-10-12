import "server-only";
import { MARKETS, QUESTION_CATEGORY_IDS, type MarketId, type QuestionCategory } from "@/lib/domain/constants";

/*
  Question templates: the questions customers, journalists and job seekers
  actually type into AI assistants, filled with the brand name, its products and
  plans from approved facts, its competitors and its markets. Key questions are
  marked: they are checked on every scan.
*/

export type TemplateContext = {
  brand: string;
  /** A noun phrase such as "payroll and HR software", or null. */
  industry: string | null;
  /** Product names from approved facts, such as "Acme Payroll". */
  products: string[];
  /** Plan names from approved pricing facts, such as "Basic". */
  plans: string[];
  /** Features from approved product facts, such as "automatic tax filing". */
  features: string[];
  competitors: string[];
  /** Market phrases, such as "India" or "the United States". */
  markets: string[];
};

export type QuestionCandidate = { text: string; category: QuestionCategory; key: boolean };

function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

/** "the United States", "India" */
export function marketPhrase(id: MarketId): string {
  const label: string = MARKETS[id].label;
  return /^United\b/.test(label) ? `the ${label}` : label;
}

/** "Payroll and HR software" becomes "payroll and HR software"; "HR software" stays as written. */
export function industryNoun(industry: string | null | undefined): string | null {
  const trimmed = industry?.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  const lowered = /^[A-Z][a-z]/.test(trimmed) ? trimmed[0].toLowerCase() + trimmed.slice(1) : trimmed;
  return /(software|apps?|platforms?|tools?|services?|providers?|banks?|insurance|insurers?|compan(y|ies)|products?|solutions?|brands?|firms?)$/i.test(
    lowered,
  )
    ? lowered
    : `${lowered} companies`;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const COMPANY_SUFFIXES = /^(inc|ltd|limited|pvt|private|llc|llp|corp|corporation|technologies|group|holdings|gmbh|plc)$/i;

/** Products, plans and features named in approved facts, for filling templates. */
export function readFactContext(brand: string, facts: { category: string; statement: string }[]) {
  const products = new Set<string>();
  const plans = new Set<string>();
  const features = new Set<string>();
  const productPattern = new RegExp(`\\b${escapeRegex(brand)}((?:\\s+[A-Z][A-Za-z0-9&+]*){1,3})`, "g");
  for (const fact of facts) {
    if (fact.category === "products" || fact.category === "pricing") {
      for (const match of fact.statement.matchAll(productPattern)) {
        const words = match[1].trim().split(/\s+/);
        const kept: string[] = [];
        for (const word of words) {
          if (COMPANY_SUFFIXES.test(word) || /^(Plan|Plans|The|A|An)$/.test(word)) break;
          kept.push(word);
        }
        if (kept.length > 0) products.add(`${brand} ${kept.join(" ")}`);
      }
    }
    if (fact.category === "pricing") {
      for (const match of fact.statement.matchAll(/\b([A-Z][A-Za-z0-9+]*(?:\s+[A-Z][A-Za-z0-9+]*)?)\s+plan\b/g)) {
        const name = match[1]
          .replace(/^(The|A|An|This|That|Each|Every|Its|Our|Your)(\s+|$)/, "")
          .replace(new RegExp(`^${escapeRegex(brand)}('s)?(\\s+|$)`), "")
          .trim();
        if (name && !products.has(`${brand} ${name}`)) plans.add(name);
      }
    }
    if (fact.category === "products") {
      const match = /\b(?:offers|includes|supports|provides)\s+([a-z][a-z0-9 -]{3,48}?)(?=[.,;]|\s+(?:and|for|to|in|with|at|on|across)\b|$)/.exec(
        fact.statement,
      );
      if (match) {
        const feature = match[1].trim();
        const words = feature.split(/\s+/).length;
        if (words >= 2 && words <= 5) features.add(feature);
      }
    }
  }
  return { products: [...products].slice(0, 4), plans: [...plans].slice(0, 3), features: [...features].slice(0, 3) };
}

/** Every candidate question, per category, most useful first. */
export function buildCandidates(ctx: TemplateContext): Record<QuestionCategory, QuestionCandidate[]> {
  const b = ctx.brand;
  const bs = possessive(b);
  const out = Object.fromEntries(QUESTION_CATEGORY_IDS.map((id) => [id, [] as QuestionCandidate[]])) as Record<
    QuestionCategory,
    QuestionCandidate[]
  >;
  const add = (category: QuestionCategory, text: string, key = false) => out[category].push({ text, category, key });

  // Pricing and plans
  add("pricing", `How much does ${b} cost?`, true);
  add("pricing", `Does ${b} have a free plan?`, true);
  ctx.plans.forEach((plan, i) => {
    add("pricing", `How much is ${bs} ${plan} plan?`, i === 0);
    if (i === 0) add("pricing", `What is included in ${bs} ${plan} plan?`);
  });
  add("pricing", `What plans does ${b} offer?`);
  add("pricing", `Is there a free trial for ${b}?`);
  ctx.markets.slice(0, 2).forEach((market) => add("pricing", `How much does ${b} cost in ${market}?`));
  add("pricing", `Is ${b} priced per user?`);
  add("pricing", `Are there any hidden fees with ${b}?`);
  add("pricing", `Does ${b} offer a discount for annual billing?`);

  // Products and features
  add("products", `What does ${b} do?`, true);
  ctx.products.forEach((product, i) => {
    add("products", `What is ${product}?`, i === 0);
    if (i < 2) add("products", `Is ${product} still available?`);
  });
  ctx.features.forEach((feature) => add("products", `Does ${b} offer ${feature}?`));
  add("products", `What products does ${b} offer?`);
  ctx.markets.slice(0, 3).forEach((market) => add("products", `Is ${b} available in ${market}?`));
  add("products", `Which countries does ${b} support?`);
  add("products", `What integrations does ${b} have?`);
  add("products", `Does ${b} have a mobile app?`);

  // Company facts
  add("company", `Who is the CEO of ${b}?`, true);
  add("company", `Where is ${b} headquartered?`, true);
  add("company", `When was ${b} founded?`);
  add("company", `Who founded ${b}?`);
  add("company", `How many employees does ${b} have?`);
  add("company", `Who owns ${b}?`);
  add("company", `How many customers does ${b} have?`);
  add("company", `Is ${b} a public company?`);

  // Trust and safety
  add("trust", `Is ${b} legit?`, true);
  add("trust", `Is ${b} safe to use?`, true);
  add("trust", `Is ${b} SOC 2 certified?`);
  add("trust", `Where does ${b} store customer data?`);
  add("trust", `Is ${b} GDPR compliant?`);
  add("trust", `Does ${b} sell customer data?`);

  // Comparisons
  ctx.competitors.forEach((competitor, i) => add("comparisons", `${b} vs ${competitor}, which is better?`, i === 0));
  add("comparisons", `Best alternatives to ${b}`);
  ctx.competitors.slice(0, 3).forEach((competitor) => add("comparisons", `Is ${b} cheaper than ${competitor}?`));
  if (ctx.industry) {
    add("comparisons", `What is the best ${ctx.industry}?`);
    ctx.markets.slice(0, 1).forEach((market) => add("comparisons", `Best ${ctx.industry} in ${market}`));
  }
  ctx.competitors.slice(0, 2).forEach((competitor) => add("comparisons", `Should I switch from ${competitor} to ${b}?`));
  add("comparisons", `Is ${b} worth it?`);
  add("comparisons", `Is ${b} good for small businesses?`);

  // Policies and support
  add("policies", `What is ${bs} refund policy?`, true);
  add("policies", `Does ${b} offer 24/7 support?`);
  add("policies", `How do I cancel ${b}?`);
  add("policies", `How can I contact ${b} support?`);
  add("policies", `Does ${b} charge a cancellation fee?`);
  add("policies", `Can I export my data if I leave ${b}?`);

  // Reputation and controversies
  add("reputation", `Has ${b} had a data breach?`, true);
  add("reputation", `Are there lawsuits against ${b}?`, true);
  add("reputation", `What do customers complain about with ${b}?`);
  add("reputation", `What do reviews say about ${b}?`);
  add("reputation", `Has ${b} been fined by a regulator?`);
  add("reputation", `Is ${b} going out of business?`);

  // Careers
  add("careers", `Is ${b} a good place to work?`);
  add("careers", `How are salaries at ${b}?`);
  add("careers", `Is ${b} hiring?`);
  add("careers", `What is the interview process at ${b}?`);
  add("careers", `Does ${b} allow remote work?`);

  return out;
}

/** The order categories are filled in, and the order key questions are promoted in. */
export const CATEGORY_ORDER: QuestionCategory[] = [
  "pricing",
  "company",
  "trust",
  "reputation",
  "products",
  "policies",
  "comparisons",
  "careers",
];

/** Categories that must always keep at least one key question. */
const ALWAYS_KEY: QuestionCategory[] = ["pricing", "company", "trust"];

/**
 * Picks `target` questions round-robin across categories, so a small plan still
 * covers every category, then marks about a third of them as key questions.
 */
export function selectQuestions(
  candidates: Record<QuestionCategory, QuestionCandidate[]>,
  target: number,
  isDuplicate: (text: string) => boolean,
): QuestionCandidate[] {
  const queues = CATEGORY_ORDER.map((category) => candidates[category].filter((c) => !isDuplicate(c.text)));
  const picked: QuestionCandidate[] = [];
  const taken = new Set<string>();
  let progress = true;
  while (picked.length < target && progress) {
    progress = false;
    for (const queue of queues) {
      if (picked.length >= target) break;
      while (queue.length > 0) {
        const next = queue.shift()!;
        const norm = normalizeQuestion(next.text);
        if (taken.has(norm)) continue;
        taken.add(norm);
        picked.push({ ...next });
        progress = true;
        break;
      }
    }
  }

  const wanted = Math.max(1, Math.round(picked.length / 3));
  let keyCount = picked.filter((q) => q.key).length;
  // Promote: the first standard question of each category in turn, most important categories first.
  while (keyCount < wanted) {
    let promoted = false;
    for (const category of CATEGORY_ORDER) {
      if (keyCount >= wanted) break;
      const next = picked.find((q) => q.category === category && !q.key);
      if (next) {
        next.key = true;
        keyCount++;
        promoted = true;
      }
    }
    if (!promoted) break;
  }
  // Demote: from the least important categories, keeping one key question in pricing, company and trust.
  for (let i = picked.length - 1; i >= 0 && keyCount > wanted; i--) {
    const q = picked[i];
    if (!q.key) continue;
    const keysInCategory = picked.filter((p) => p.key && p.category === q.category).length;
    if (ALWAYS_KEY.includes(q.category) && keysInCategory <= 1) continue;
    q.key = false;
    keyCount--;
  }
  return picked;
}

/** Comparison key for duplicates: case, spacing and the closing question mark do not matter. */
export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[?.!\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
