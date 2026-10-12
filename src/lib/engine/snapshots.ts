import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  answers,
  competitorSnapshots,
  getDb,
  issues,
  questions,
  scoreSnapshots,
  statements,
  type CategoryBreakdown,
  type PlatformBreakdown,
  type SentimentSplit,
} from "@/lib/db";
import { UNRESOLVED_STATUSES, type Importance, type PlatformId, type QuestionCategory, type Verdict } from "@/lib/domain/constants";
import { accuracyScore, scoreBy } from "@/lib/domain/score";
import type { BrandContext } from "./context";
import { domainFromWebsite, sentences } from "./text";

/*
  After a scan finishes, its statements become a score snapshot: the Accuracy
  Score overall, per platform and per category, open issue counts, the
  sentiment split and share of voice. Competitor scans write competitor
  snapshots instead. Both are upserted per scan, so a re-run never duplicates.
*/

type ScanStatement = {
  answerId: string;
  verdict: Verdict;
  factId: string | null;
  sentiment: "positive" | "neutral" | "negative" | null;
  platform: PlatformId;
  category: QuestionCategory;
};

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether a text names an entity, by name or by its domain. */
export function mentions(text: string, name: string, website?: string): boolean {
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(name)}(?=$|[^\\p{L}\\p{N}])`, "iu");
  if (pattern.test(text)) return true;
  if (website) {
    const domain = domainFromWebsite(website);
    if (domain && text.toLowerCase().includes(domain)) return true;
  }
  return false;
}

function importanceOf(ctx: BrandContext, factId: string | null): Importance | null {
  if (!factId) return null;
  const fact = ctx.byId.get(factId);
  if (!fact) return null;
  // An outdated claim weighs as much as the current fact it gets wrong.
  if (fact.former) return ctx.replacement.get(fact.id)?.importance ?? fact.importance;
  return fact.importance;
}

function share(split: { positive: number; neutral: number; negative: number }): SentimentSplit | null {
  const total = split.positive + split.neutral + split.negative;
  if (total === 0) return null;
  const round = (n: number) => Math.round((n / total) * 1000) / 1000;
  return { positive: round(split.positive), neutral: round(split.neutral), negative: round(split.negative) };
}

/** Each answer's tone, from its statements: more positive than negative claims reads positive, and so on. */
function answerSentiment(rows: readonly ScanStatement[]): SentimentSplit | null {
  const byAnswer = new Map<string, { positive: number; negative: number }>();
  for (const row of rows) {
    const entry = byAnswer.get(row.answerId) ?? { positive: 0, negative: 0 };
    if (row.sentiment === "positive") entry.positive += 1;
    if (row.sentiment === "negative") entry.negative += 1;
    byAnswer.set(row.answerId, entry);
  }
  const split = { positive: 0, neutral: 0, negative: 0 };
  for (const entry of byAnswer.values()) {
    if (entry.negative > entry.positive) split.negative += 1;
    else if (entry.positive > entry.negative) split.positive += 1;
    else split.neutral += 1;
  }
  return share(split);
}

/** Tone of the sentences that name a competitor, from simple word lists (competitors have no Fact Sheet). */
function sentenceSentiment(texts: readonly string[], name: string): SentimentSplit | null {
  const split = { positive: 0, neutral: 0, negative: 0 };
  for (const text of texts) {
    for (const sentence of sentences(text)) {
      if (!mentions(sentence.text, name)) continue;
      if (/\b(breach|lawsuit|complain|scam|fraud|poor|slow|expensive|problems|criticized)/i.test(sentence.text)) split.negative += 1;
      else if (/\b(popular|trusted|reliable|leading|recommended|strong|easy to use|well[- ]regarded)/i.test(sentence.text)) split.positive += 1;
      else split.neutral += 1;
    }
  }
  return share(split);
}

async function loadScan(scanId: string) {
  const db = await getDb();
  const [statementRows, answerRows] = await Promise.all([
    db
      .select({
        answerId: statements.answerId,
        verdict: statements.verdict,
        factId: statements.factId,
        sentiment: statements.sentiment,
        platform: answers.platform,
        category: questions.category,
      })
      .from(statements)
      .innerJoin(answers, eq(answers.id, statements.answerId))
      .innerJoin(questions, eq(questions.id, answers.questionId))
      .where(eq(answers.scanId, scanId)),
    db
      .select({ id: answers.id, text: answers.text, category: questions.category })
      .from(answers)
      .innerJoin(questions, eq(questions.id, answers.questionId))
      .where(eq(answers.scanId, scanId)),
  ]);
  return { statementRows: statementRows as ScanStatement[], answerRows };
}

/** Share of voice: of all mentions of the brand and its competitors in comparison answers, the share each one gets. */
function shareOfVoice(ctx: BrandContext, answerTexts: readonly string[]): { brand: number | null; competitors: Map<string, number | null> } {
  const competitorCounts = new Map<string, number>();
  let brandCount = 0;
  for (const text of answerTexts) {
    if (mentions(text, ctx.brand.name, ctx.brand.website)) brandCount += 1;
    for (const competitor of ctx.competitors) {
      if (mentions(text, competitor.name, competitor.website)) competitorCounts.set(competitor.id, (competitorCounts.get(competitor.id) ?? 0) + 1);
    }
  }
  const total = brandCount + [...competitorCounts.values()].reduce((sum, n) => sum + n, 0);
  const ratio = (n: number) => (total === 0 ? null : Math.round((n / total) * 1000) / 1000);
  return {
    brand: ratio(brandCount),
    competitors: new Map(ctx.competitors.map((c) => [c.id, ratio(competitorCounts.get(c.id) ?? 0)])),
  };
}

export async function upsertScoreSnapshot(input: { scanId: string; ctx: BrandContext; now: Date }): Promise<{ accuracyScore: number | null }> {
  const { scanId, ctx, now } = input;
  const db = await getDb();
  const { statementRows, answerRows } = await loadScan(scanId);

  const scored = statementRows.map((row) => ({
    verdict: row.verdict,
    importance: importanceOf(ctx, row.factId),
    platform: row.platform,
    category: row.category,
  }));
  const overall = accuracyScore(scored);
  const platformScores = scoreBy(scored.map((s) => ({ ...s, key: s.platform })));
  const categoryScores = scoreBy(scored.map((s) => ({ ...s, key: s.category })));

  const openRows = await db
    .select({ severity: issues.severity, platforms: issues.platforms, category: issues.category })
    .from(issues)
    .where(
      and(
        eq(issues.brandId, ctx.brand.id),
        eq(issues.reviewState, "approved"),
        isNull(issues.dismissedAt),
        inArray(issues.status, [...UNRESOLVED_STATUSES]),
      ),
    );
  const openByPlatform = new Map<PlatformId, number>();
  const openByCategory = new Map<QuestionCategory, number>();
  for (const row of openRows) {
    for (const platform of new Set(row.platforms)) openByPlatform.set(platform, (openByPlatform.get(platform) ?? 0) + 1);
    if (row.category) openByCategory.set(row.category, (openByCategory.get(row.category) ?? 0) + 1);
  }

  const byPlatform: PlatformBreakdown = {};
  for (const [platform, value] of platformScores) {
    byPlatform[platform] = { score: value.score, checked: value.checked, openIssues: openByPlatform.get(platform) ?? 0 };
  }
  const byCategory: CategoryBreakdown = {};
  for (const [category, value] of categoryScores) {
    byCategory[category] = { score: value.score, checked: value.checked, openIssues: openByCategory.get(category) ?? 0 };
  }

  const comparisonTexts = answerRows.filter((a) => a.category === "comparisons").map((a) => a.text);
  const values = {
    brandId: ctx.brand.id,
    scanId,
    takenAt: now,
    accuracyScore: overall,
    statementsChecked: scored.filter((s) => s.verdict !== "unsupported").length,
    openCritical: openRows.filter((r) => r.severity === "critical").length,
    openHigh: openRows.filter((r) => r.severity === "high").length,
    openTotal: openRows.length,
    byPlatform,
    byCategory,
    sentiment: answerSentiment(statementRows),
    shareOfVoice: comparisonTexts.length ? shareOfVoice(ctx, comparisonTexts).brand : null,
  };

  const [existing] = await db.select({ id: scoreSnapshots.id }).from(scoreSnapshots).where(eq(scoreSnapshots.scanId, scanId)).limit(1);
  if (existing) await db.update(scoreSnapshots).set(values).where(eq(scoreSnapshots.id, existing.id));
  else await db.insert(scoreSnapshots).values(values);
  return { accuracyScore: overall };
}

/**
 * Competitor snapshots from a competitor scan. Competitors have no confirmed
 * Fact Sheet, so accuracy stays empty here; share of voice and sentiment come
 * from how the answers talk about each of them.
 */
export async function upsertCompetitorSnapshots(input: { scanId: string; ctx: BrandContext; now: Date }): Promise<number> {
  const { scanId, ctx, now } = input;
  if (ctx.competitors.length === 0) return 0;
  const db = await getDb();
  const { answerRows } = await loadScan(scanId);
  const comparison = answerRows.filter((a) => a.category === "comparisons").map((a) => a.text);
  const texts = comparison.length ? comparison : answerRows.map((a) => a.text);
  const voice = shareOfVoice(ctx, texts);

  for (const competitor of ctx.competitors) {
    const values = {
      competitorId: competitor.id,
      brandId: ctx.brand.id,
      scanId,
      takenAt: now,
      accuracyScore: null,
      sentiment: sentenceSentiment(texts, competitor.name),
      shareOfVoice: voice.competitors.get(competitor.id) ?? null,
    };
    const [existing] = await db
      .select({ id: competitorSnapshots.id })
      .from(competitorSnapshots)
      .where(and(eq(competitorSnapshots.scanId, scanId), eq(competitorSnapshots.competitorId, competitor.id)))
      .limit(1);
    if (existing) await db.update(competitorSnapshots).set(values).where(eq(competitorSnapshots.id, existing.id));
    else await db.insert(competitorSnapshots).values(values);
  }
  return ctx.competitors.length;
}
