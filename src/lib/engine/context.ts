import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  brands,
  competitors,
  facts,
  getDb,
  issues,
  organizations,
  type Brand,
  type Competitor,
  type Fact,
  type Organization,
} from "@/lib/db";
import type { FactCategory, QuestionCategory } from "@/lib/domain/constants";
import { contentWords, domainFromWebsite, jaccard, today } from "./text";

/*
  What the engine knows about a brand while it asks and checks: the approved
  Fact Sheet split into current and former facts, which current fact replaced
  each former one, competitors, and which facts have a fix in progress.
*/

export type FactEntry = Pick<Fact, "id" | "category" | "statement" | "importance" | "sourceUrl" | "validFrom" | "validTo"> & {
  former: boolean;
};

export type BrandContext = {
  brand: Brand;
  organization: Organization;
  domain: string;
  current: FactEntry[];
  former: FactEntry[];
  byId: Map<string, FactEntry>;
  /** Former fact id → the current fact that replaced it. */
  replacement: Map<string, FactEntry>;
  competitors: Competitor[];
  /** Facts whose issue the client marked as fixed or that resolved: the simulator stops repeating most of them. */
  fixedFactIds: Set<string>;
  /** What the client marked as "Not an error", fed back to the checker. */
  dismissed: { wrongStatement: string; note: string | null }[];
};

/** Which Fact Sheet categories answer which question categories. */
export const FACT_CATEGORIES_FOR: Record<QuestionCategory, FactCategory[]> = {
  pricing: ["pricing"],
  products: ["products"],
  company: ["company", "leadership"],
  trust: ["security", "company"],
  comparisons: ["pricing", "products"],
  policies: ["policies", "support"],
  reputation: ["security", "legal"],
  careers: ["careers", "company"],
};

export async function loadBrandContext(brandId: string, now: Date): Promise<BrandContext> {
  const db = await getDb();
  const [row] = await db
    .select({ brand: brands, organization: organizations })
    .from(brands)
    .innerJoin(organizations, eq(organizations.id, brands.organizationId))
    .where(eq(brands.id, brandId))
    .limit(1);
  if (!row) throw new Error(`Brand ${brandId} was not found.`);

  const [factRows, competitorRows, fixedRows, dismissedRows] = await Promise.all([
    db
      .select()
      .from(facts)
      .where(and(eq(facts.brandId, brandId), inArray(facts.status, ["approved", "archived"]))),
    db.select().from(competitors).where(eq(competitors.brandId, brandId)),
    db
      .select({ factId: issues.factId })
      .from(issues)
      .where(and(eq(issues.brandId, brandId), inArray(issues.status, ["fixed_rechecking", "resolved"]), isNotNull(issues.factId))),
    db
      .select({ wrongStatement: issues.wrongStatement, note: issues.dismissNote })
      .from(issues)
      .where(and(eq(issues.brandId, brandId), isNotNull(issues.dismissedAt))),
  ]);

  const day = today(now);
  const current: FactEntry[] = [];
  const former: FactEntry[] = [];
  for (const fact of factRows) {
    const isFormer = Boolean(fact.validTo && fact.validTo < day);
    // Archived facts only matter as former facts, to label outdated answers.
    if (fact.status === "archived" && !isFormer) continue;
    const entry: FactEntry = {
      id: fact.id,
      category: fact.category,
      statement: fact.statement,
      importance: fact.importance,
      sourceUrl: fact.sourceUrl,
      validFrom: fact.validFrom,
      validTo: fact.validTo,
      former: isFormer,
    };
    (isFormer ? former : current).push(entry);
  }
  // Stable order, so prompts and the simulator do not depend on database order.
  current.sort((a, b) => a.id.localeCompare(b.id));
  former.sort((a, b) => a.id.localeCompare(b.id));

  const replacement = new Map<string, FactEntry>();
  for (const old of former) {
    const match = replacementFor(old, current);
    if (match) replacement.set(old.id, match);
  }

  return {
    brand: row.brand,
    organization: row.organization,
    domain: domainFromWebsite(row.brand.website),
    current,
    former,
    byId: new Map([...current, ...former].map((fact) => [fact.id, fact])),
    replacement,
    competitors: competitorRows.sort((a, b) => a.name.localeCompare(b.name)),
    fixedFactIds: new Set(fixedRows.map((r) => r.factId).filter((id): id is string => Boolean(id))),
    dismissed: dismissedRows,
  };
}

/**
 * The current fact that replaced a former one: same category, the most similar
 * wording, preferring the one that became valid when the old one stopped.
 */
function replacementFor(old: FactEntry, current: readonly FactEntry[]): FactEntry | null {
  const oldWords = contentWords(old.statement).filter((w) => !/\d/.test(w));
  let best: FactEntry | null = null;
  let bestScore = 0;
  for (const candidate of current) {
    if (candidate.category !== old.category) continue;
    let score = jaccard(oldWords, contentWords(candidate.statement).filter((w) => !/\d/.test(w)));
    if (old.validTo && candidate.validFrom === old.validTo) score += 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore >= 0.3 ? best : null;
}

/** The fact an issue is about: for an outdated claim, the current fact that replaced the former one. */
export function issueFactFor(ctx: BrandContext, factId: string | null): FactEntry | null {
  if (!factId) return null;
  const fact = ctx.byId.get(factId);
  if (!fact) return null;
  if (fact.former) return ctx.replacement.get(fact.id) ?? fact;
  return fact;
}

/** Current facts that answer a question, best first. */
export function relevantFacts(ctx: BrandContext, question: { text: string; category: QuestionCategory }): FactEntry[] {
  const wanted = FACT_CATEGORIES_FOR[question.category];
  const brandWords = new Set(contentWords(ctx.brand.name));
  const questionWords = contentWords(question.text).filter((w) => !brandWords.has(w));
  const scored = ctx.current
    .map((fact) => {
      const categoryRank = wanted.indexOf(fact.category);
      const shared = questionWords.filter((w) => contentWords(fact.statement).includes(w)).length;
      const score = (categoryRank === 0 ? 3 : categoryRank > 0 ? 2 : 0) + shared;
      return { fact, score, shared, inCategory: categoryRank >= 0 };
    })
    .filter((entry) => entry.inCategory || entry.shared >= 2)
    .sort((a, b) => b.score - a.score || a.fact.id.localeCompare(b.fact.id));
  return scored.map((entry) => entry.fact);
}
