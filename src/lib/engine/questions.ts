import "server-only";
import { and, eq } from "drizzle-orm";
import { brands, competitors, facts, getDb, organizations, questions } from "@/lib/db";
import { PLANS, type QuestionCategory } from "@/lib/domain/constants";
import { EngineError } from "./errors";
import { checkerAvailable, suggestQuestionsWithModel } from "./extract";
import {
  buildCandidates,
  industryNoun,
  marketPhrase,
  normalizeQuestion,
  readFactContext,
  selectQuestions,
} from "./question-templates";
import { getSettings } from "./settings";

/*
  Generates a Question Set of realistic customer questions, grouped by category,
  for the client to edit. Questions come from templates filled with the brand,
  its products and plans from approved facts, its competitors and its markets.
  With an Anthropic key, the checker model adds up to ten more natural questions
  grounded in the approved facts. Safe to run twice: duplicates are skipped, and
  the plan's question limit is never exceeded.
*/

/** How many questions a fresh set aims for, before any written by the checker model. */
const TEMPLATE_TARGET = 50;
const MODEL_EXTRA = 10;
/** "custom" plans count as this many questions. */
const CUSTOM_PLAN_QUESTIONS = 200;

export function questionLimit(plan: keyof typeof PLANS): number {
  const limit = PLANS[plan].questions;
  return limit === "custom" ? CUSTOM_PLAN_QUESTIONS : limit;
}

export async function generateQuestionSet(brandId: string): Promise<{ created: number }> {
  const db = await getDb();
  const [brand] = await db
    .select({
      id: brands.id,
      organizationId: brands.organizationId,
      name: brands.name,
      website: brands.website,
      description: brands.description,
      industry: brands.industry,
      markets: brands.markets,
      plan: organizations.plan,
    })
    .from(brands)
    .innerJoin(organizations, eq(organizations.id, brands.organizationId))
    .where(eq(brands.id, brandId))
    .limit(1);
  if (!brand) throw new EngineError("This company could not be found. Reload the page and try again.");

  const [competitorRows, approvedFacts, existing] = await Promise.all([
    db.select({ name: competitors.name }).from(competitors).where(eq(competitors.brandId, brandId)),
    db
      .select({ category: facts.category, statement: facts.statement })
      .from(facts)
      .where(and(eq(facts.brandId, brandId), eq(facts.status, "approved"))),
    db
      .select({ text: questions.text, active: questions.active, origin: questions.origin })
      .from(questions)
      .where(eq(questions.brandId, brandId)),
  ]);

  // The plan's limit counts active questions. A set that was already generated is only topped up,
  // so running this twice does not keep adding questions.
  const limit = questionLimit(brand.plan);
  const activeCount = existing.filter((q) => q.active).length;
  const alreadyGenerated = existing.filter((q) => q.origin === "generated").length;
  let capacity = Math.min(limit - activeCount, TEMPLATE_TARGET + MODEL_EXTRA - alreadyGenerated);
  if (capacity <= 0) return { created: 0 };

  const known = new Set(existing.map((q) => normalizeQuestion(q.text)));
  const isDuplicate = (text: string) => known.has(normalizeQuestion(text));

  const fromFacts = readFactContext(brand.name, approvedFacts);
  const candidates = buildCandidates({
    brand: brand.name,
    industry: industryNoun(brand.industry),
    products: fromFacts.products,
    plans: fromFacts.plans,
    features: fromFacts.features,
    competitors: competitorRows.map((c) => c.name).slice(0, 5),
    markets: brand.markets.map(marketPhrase),
  });

  const picked = selectQuestions(candidates, Math.max(0, Math.min(capacity, TEMPLATE_TARGET - alreadyGenerated)), isDuplicate);
  const rows: { text: string; category: QuestionCategory; priority: "key" | "standard" }[] = picked.map((q) => ({
    text: q.text,
    category: q.category,
    priority: q.key ? "key" : "standard",
  }));
  for (const row of rows) known.add(normalizeQuestion(row.text));
  capacity -= rows.length;

  // A few natural questions from the checker model, grounded in the approved facts.
  const settings = await getSettings();
  if (capacity > 0 && approvedFacts.length > 0 && checkerAvailable(settings)) {
    try {
      const suggested = await suggestQuestionsWithModel({
        settings,
        brand,
        facts: approvedFacts.map((f) => f.statement).slice(0, 60),
        competitors: competitorRows.map((c) => c.name),
        existing: [...existing.map((q) => q.text), ...rows.map((r) => r.text)],
        limit: Math.min(MODEL_EXTRA, capacity),
      });
      for (const question of suggested) {
        if (capacity <= 0) break;
        if (isDuplicate(question.text)) continue;
        known.add(normalizeQuestion(question.text));
        rows.push({ text: question.text, category: question.category, priority: "standard" });
        capacity--;
      }
    } catch (error) {
      // The template questions are enough on their own; the extra questions are a bonus.
      console.warn("[questions] The checker model could not suggest questions:", error instanceof Error ? error.message : error);
    }
  }

  if (rows.length === 0) return { created: 0 };
  await db.insert(questions).values(
    rows.map((row) => ({
      brandId,
      text: row.text,
      category: row.category,
      language: "en" as const,
      priority: row.priority,
      active: true,
      origin: "generated" as const,
    })),
  );
  return { created: rows.length };
}
