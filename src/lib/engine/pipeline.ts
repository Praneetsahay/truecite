import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull, max, sql } from "drizzle-orm";
import {
  answers,
  citations,
  getDb,
  issueEvents,
  issues,
  questions,
  scans,
  statements,
  usageCosts,
  type Issue,
} from "@/lib/db";
import { PLATFORM_IDS, SYSTEM_ACTOR, type ErrorVerdict, type PlatformId, type QuestionCategory } from "@/lib/domain/constants";
import { applyConsistencyRule, claimKeyFor, type ClaimObservation } from "@/lib/domain/consistency";
import { requestCost } from "@/lib/domain/costs";
import type { ErrorType } from "@/lib/domain/playbook";
import { severityFor } from "@/lib/domain/severity";
import { afterRecheck } from "@/lib/domain/workflow";
import { sendInstantAlerts } from "./alerts";
import { checkAnswer, type CheckedStatement } from "./checker";
import { issueFactFor, loadBrandContext, type BrandContext } from "./context";
import { EngineError } from "./errors";
import { canonicalClaim, claimKeyOf, cleanNote, errorTypeFor, isErrorVerdict, issueTitleFor, RESOLVED_NOTE, seenNote } from "./issues";
import { getSettings, priceFor, type Settings } from "./settings";
import type { SimulatedStatement } from "./simulator";
import { upsertCompetitorSnapshots, upsertScoreSnapshot } from "./snapshots";
import { findSpan, mapLimit, today } from "./text";
import { traceSources, type Carrier, type PageCheck } from "./tracing";

/*
  The pipeline that runs when every answer of a scan is in:
  1. check each answer once (answers that already have statements are skipped, so a re-run is safe),
  2. apply the consistency rule across the scan for each claim,
  3. create or update issues for consistent errors; one-off claims are marked intermittent,
  4. re-check existing issues whose question was asked (afterRecheck),
  5. trace sources, send alerts for issues that go straight to the client,
  6. write the score snapshot.
*/

export type PipelineSummary = {
  answersChecked: number;
  checkFailures: number;
  statementsAdded: number;
  issuesCreated: number[];
  issuesUpdated: number[];
  resolved: number[];
  reopened: number[];
  sources: number;
  accuracyScore: number | null;
};

type AnswerRow = {
  id: string;
  questionId: string;
  platform: PlatformId;
  runNumber: number;
  text: string;
  rawResponse: unknown;
  settings: { webSearch: boolean; refusal?: boolean; [key: string]: unknown };
  simulated: boolean;
  questionText: string;
  questionCategory: QuestionCategory;
};

type StatementRow = {
  id: string;
  answerId: string;
  text: string;
  claimKey: string;
  factId: string | null;
  verdict: CheckedStatement["verdict"];
  confidence: number;
  issueId: string | null;
  platform: PlatformId;
  questionId: string;
  runNumber: number;
};

/** One pipeline per brand at a time, so issue numbers never collide. */
const engineGlobal = globalThis as unknown as { __trueciteBrandLocks?: Map<string, Promise<unknown>> };
async function withBrandLock<T>(brandId: string, task: () => Promise<T>): Promise<T> {
  const locks = (engineGlobal.__trueciteBrandLocks ??= new Map());
  const previous = locks.get(brandId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  locks.set(brandId, run);
  try {
    return await run;
  } finally {
    if (locks.get(brandId) === run) locks.delete(brandId);
  }
}

function simulatedStatementsOf(answer: AnswerRow): SimulatedStatement[] | null {
  if (!answer.simulated) return null;
  const raw = answer.rawResponse as { simulatedStatements?: SimulatedStatement[] } | null;
  return Array.isArray(raw?.simulatedStatements) ? raw.simulatedStatements : [];
}

function mostCommon<T>(values: readonly T[]): T {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

async function checkAnswers(input: {
  scanId: string;
  ctx: BrandContext;
  settings: Settings;
  answerRows: AnswerRow[];
  now: Date;
}): Promise<{ checked: Set<string>; added: number; failures: string[]; titles: Map<string, { title: string | null; type: ErrorType | null }> }> {
  const { ctx, settings, now } = input;
  const db = await getDb();
  const ids = input.answerRows.map((a) => a.id);
  const already = ids.length
    ? await db.selectDistinct({ answerId: statements.answerId }).from(statements).where(inArray(statements.answerId, ids))
    : [];
  const checked = new Set(already.map((r) => r.answerId));
  const pending = input.answerRows.filter((a) => !checked.has(a.id) && !a.settings.refusal && a.text.trim().length > 0);
  // Refusals have nothing to check; they still count as asked.
  for (const answer of input.answerRows) if (answer.settings.refusal) checked.add(answer.id);

  const failures: string[] = [];
  const titles = new Map<string, { title: string | null; type: ErrorType | null }>();
  let added = 0;

  await mapLimit(pending, Math.max(1, settings.limits.maxConcurrentRequests), async (answer) => {
    const result = await checkAnswer({
      settings,
      ctx,
      question: { text: answer.questionText, category: answer.questionCategory },
      platform: answer.platform,
      answerText: answer.text,
      simulatedStatements: simulatedStatementsOf(answer),
      now,
    });

    if (result.usage) {
      const price = priceFor(settings.prices, result.usage.provider, result.usage.model);
      const cost = price ? requestCost({ tokensIn: result.usage.tokensIn, tokensOut: result.usage.tokensOut, searchCalls: 0 }, price) : 0;
      await db.insert(usageCosts).values({
        organizationId: ctx.organization.id,
        brandId: ctx.brand.id,
        scanId: input.scanId,
        provider: result.usage.provider,
        model: result.usage.model,
        purpose: "check",
        tokensIn: result.usage.tokensIn,
        tokensOut: result.usage.tokensOut,
        searchCalls: 0,
        costUsd: cost,
        day: today(now),
      });
      if (cost > 0) {
        await db.update(scans).set({ totalCostUsd: sql`${scans.totalCostUsd} + ${cost}` }).where(eq(scans.id, input.scanId));
      }
    }

    if (result.error) {
      failures.push(result.error);
      await db
        .update(answers)
        .set({ settings: { ...answer.settings, checkFailed: result.error } })
        .where(eq(answers.id, answer.id));
      return;
    }

    const rows = result.statements.map((s) => {
      const span = findSpan(answer.text, s.text);
      return {
        answerId: answer.id,
        brandId: ctx.brand.id,
        text: s.text,
        claimKey: claimKeyOf({ factId: s.factId, text: s.text, verdict: s.verdict, brandName: ctx.brand.name }),
        factId: s.factId,
        verdict: s.verdict,
        confidence: s.confidence,
        spanStart: span?.start ?? null,
        spanEnd: span?.end ?? null,
        sentiment: s.sentiment,
      };
    });
    for (const s of result.statements) {
      if (s.issueTitle || s.errorType) {
        const key = claimKeyOf({ factId: s.factId, text: s.text, verdict: s.verdict, brandName: ctx.brand.name });
        if (!titles.has(key)) titles.set(key, { title: s.issueTitle, type: s.errorType });
      }
    }
    const inserted = await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: statements.id }).from(statements).where(eq(statements.answerId, answer.id)).limit(1);
      if (existing || rows.length === 0) return 0;
      await tx.insert(statements).values(rows);
      if (answer.settings.checkFailed) {
        const { checkFailed: _cleared, ...rest } = answer.settings;
        void _cleared;
        await tx.update(answers).set({ settings: rest as AnswerRow["settings"] }).where(eq(answers.id, answer.id));
      }
      return rows.length;
    });
    added += inserted;
    checked.add(answer.id);
  });

  if (pending.length > 0 && failures.length === pending.length) {
    throw new EngineError(`Checking answers failed: ${failures[0]}`);
  }
  return { checked, added, failures, titles };
}

async function findExistingIssue(input: {
  brandId: string;
  claimKey: string;
  rawKeys: string[];
  issueFactId: string | null;
  verdict: ErrorVerdict;
  questionIds: string[];
}): Promise<Issue | null> {
  const db = await getDb();
  const keys = [...new Set([input.claimKey, ...input.rawKeys])];
  const [linked] = await db
    .select({ issueId: statements.issueId })
    .from(statements)
    .where(and(eq(statements.brandId, input.brandId), inArray(statements.claimKey, keys), isNotNull(statements.issueId)))
    .orderBy(desc(statements.createdAt))
    .limit(1);
  if (linked?.issueId) {
    const [issue] = await db.select().from(issues).where(eq(issues.id, linked.issueId)).limit(1);
    if (issue) return issue;
  }
  if (!input.issueFactId) return null;

  const sameFact = await db
    .select()
    .from(issues)
    .where(and(eq(issues.brandId, input.brandId), eq(issues.factId, input.issueFactId)))
    .orderBy(desc(issues.createdAt));
  const sameQuestion = sameFact.find((i) => i.verdict === input.verdict && i.questionId && input.questionIds.includes(i.questionId));
  if (sameQuestion) return sameQuestion;
  const sameVerdict = sameFact.find((i) => i.verdict === input.verdict);
  if (sameVerdict) return sameVerdict;
  // A wrong value and an old value for the same fact are the same problem for the client.
  const wrongValue = ["incorrect", "outdated"];
  if (wrongValue.includes(input.verdict)) return sameFact.find((i) => wrongValue.includes(i.verdict)) ?? null;
  return null;
}

/** Runs the whole pipeline for a scan. Safe to run again on the same scan. */
export async function runPipeline(scanId: string): Promise<PipelineSummary> {
  const db = await getDb();
  const [scan] = await db.select().from(scans).where(eq(scans.id, scanId)).limit(1);
  if (!scan) throw new Error(`Scan ${scanId} was not found.`);
  return withBrandLock(scan.brandId, () => runLocked(scan));
}

async function runLocked(scan: typeof scans.$inferSelect): Promise<PipelineSummary> {
  const db = await getDb();
  const now = new Date();
  const settings = await getSettings();
  const ctx = await loadBrandContext(scan.brandId, now);
  // A scan that completed before and was resumed (retrying failed jobs) does not re-apply re-check results.
  const rerun = scan.finishedAt !== null;

  const answerRows = (await db
    .select({
      id: answers.id,
      questionId: answers.questionId,
      platform: answers.platform,
      runNumber: answers.runNumber,
      text: answers.text,
      rawResponse: answers.rawResponse,
      settings: answers.settings,
      simulated: answers.simulated,
      questionText: questions.text,
      questionCategory: questions.category,
    })
    .from(answers)
    .innerJoin(questions, eq(questions.id, answers.questionId))
    .where(eq(answers.scanId, scan.id))) as AnswerRow[];

  /* 1. Check answers. */
  const check = await checkAnswers({ scanId: scan.id, ctx, settings, answerRows, now });

  /* 2. Consistency across the scan. */
  const statementRows: StatementRow[] = await db
    .select({
      id: statements.id,
      answerId: statements.answerId,
      text: statements.text,
      claimKey: statements.claimKey,
      factId: statements.factId,
      verdict: statements.verdict,
      confidence: statements.confidence,
      issueId: statements.issueId,
      platform: answers.platform,
      questionId: answers.questionId,
      runNumber: answers.runNumber,
    })
    .from(statements)
    .innerJoin(answers, eq(answers.id, statements.answerId))
    .where(eq(answers.scanId, scan.id));

  const citationRows = answerRows.length
    ? await db
        .select({ answerId: citations.answerId, url: citations.url, title: citations.title, position: citations.position })
        .from(citations)
        .where(inArray(citations.answerId, answerRows.map((a) => a.id)))
    : [];
  const citationsByAnswer = new Map<string, { url: string; title: string | null; position: number }[]>();
  for (const row of citationRows) {
    const list = citationsByAnswer.get(row.answerId) ?? [];
    list.push(row);
    citationsByAnswer.set(row.answerId, list);
  }
  for (const list of citationsByAnswer.values()) list.sort((a, b) => a.position - b.position);

  const questionOrder = [...new Set(answerRows.map((a) => a.questionId))].sort();
  const questionIndex = new Map(questionOrder.map((id, i) => [id, i]));
  const answersPerQuestionPlatform = new Map<string, number>();
  for (const answer of answerRows) {
    const key = `${answer.questionId}|${answer.platform}`;
    answersPerQuestionPlatform.set(key, (answersPerQuestionPlatform.get(key) ?? 0) + 1);
  }
  const answerById = new Map(answerRows.map((a) => [a.id, a]));

  const errorStatements = statementRows.filter((s) => isErrorVerdict(s.verdict));
  const observations: ClaimObservation[] = errorStatements.map((s) => ({
    claimKey: s.claimKey,
    platform: s.platform,
    // Distinct answers count as distinct runs, also when one claim spans several questions.
    runNumber: (questionIndex.get(s.questionId) ?? 0) * 1000 + s.runNumber,
  }));
  const consistency = new Map(applyConsistencyRule(observations).map((c) => [c.claimKey, c]));
  const groups = new Map<string, StatementRow[]>();
  for (const s of errorStatements) {
    const list = groups.get(s.claimKey) ?? [];
    list.push(s);
    groups.set(s.claimKey, list);
  }

  /* 3. Issues. */
  const created: Issue[] = [];
  const touched = new Map<string, { issue: Issue; group: StatementRow[] }>();
  const seenIssueIds = new Set<string>();
  const seenNotes = new Map<string, string>();
  const sortedGroups = [...groups.entries()].sort((a, b) => {
    const ca = consistency.get(a[0])?.consistent ? 0 : 1;
    const cb = consistency.get(b[0])?.consistent ? 0 : 1;
    return ca - cb || a[0].localeCompare(b[0]);
  });

  for (const [claimKey, group] of sortedGroups) {
    const result = consistency.get(claimKey);
    if (!result) continue;
    const verdict = mostCommon(group.map((s) => s.verdict)) as ErrorVerdict;
    const textCounts = mostCommon(group.map((s) => s.text));
    const representative = group.filter((s) => s.text === textCounts).sort((a, b) => b.confidence - a.confidence)[0];
    const issueFact = issueFactFor(ctx, representative.factId);
    const questionIds = [...new Set(group.map((s) => s.questionId))];
    const rawKeys = [...new Set(group.map((s) => claimKeyFor(s.factId, s.text)))];
    const existing = await findExistingIssue({
      brandId: ctx.brand.id,
      claimKey,
      rawKeys,
      issueFactId: issueFact?.id ?? null,
      verdict,
      questionIds,
    });
    const statementIds = group.map((s) => s.id);

    if (!result.consistent) {
      // Seen once: logged and watched, not an issue yet.
      await db
        .update(statements)
        .set({ intermittent: true, ...(existing ? { issueId: existing.id } : {}) })
        .where(inArray(statements.id, statementIds));
      continue;
    }

    const totals: Partial<Record<PlatformId, number>> = {};
    for (const platform of scan.platforms) {
      totals[platform] = questionIds.reduce((sum, q) => sum + (answersPerQuestionPlatform.get(`${q}|${platform}`) ?? 0), 0);
    }
    const runsTotal = Object.values(totals).reduce((sum, n) => sum + (n ?? 0), 0);
    const carriers = [...new Set(group.map((s) => s.answerId))];
    const cited = carriers.some((id) => (citationsByAnswer.get(id)?.length ?? 0) > 0);
    const note = seenNote(result.runsByPlatform, totals);
    const platforms = PLATFORM_IDS.filter((p) => result.platforms.includes(p));
    const confidence = Math.round((group.reduce((sum, s) => sum + s.confidence, 0) / group.length) * 100) / 100;

    if (existing) {
      if (!existing.dismissedAt) {
        const [updated] = await db
          .update(issues)
          .set({
            lastSeenAt: now,
            platforms: PLATFORM_IDS.filter((p) => platforms.includes(p) || existing.platforms.includes(p)),
            runsSeen: result.runsSeen,
            runsTotal,
            origin: cited ? "web" : "memory",
            updatedAt: now,
          })
          .where(eq(issues.id, existing.id))
          .returning();
        touched.set(existing.id, { issue: updated ?? existing, group: [...(touched.get(existing.id)?.group ?? []), ...group] });
        seenIssueIds.add(existing.id);
        seenNotes.set(existing.id, note);
      }
      await db.update(statements).set({ issueId: existing.id, intermittent: false }).where(inArray(statements.id, statementIds));
      continue;
    }

    // A new issue, numbered after the brand's highest number.
    const question = answerById.get(representative.answerId);
    const questionCounts = new Map<string, number>();
    for (const s of group) questionCounts.set(s.questionId, (questionCounts.get(s.questionId) ?? 0) + 1);
    const mainQuestionId = [...questionCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const mainCategory = answerRows.find((a) => a.questionId === mainQuestionId)?.questionCategory ?? question?.questionCategory ?? null;
    const suggestion = check.titles.get(claimKey);
    const type = suggestion?.type ?? errorTypeFor(issueFact?.category ?? null, verdict);
    const severity = severityFor({ importance: issueFact?.importance ?? null, verdict, errorType: type, category: mainCategory });
    const title =
      suggestion?.title ?? issueTitleFor({ fact: issueFact, verdict, wrongStatement: representative.text, brandName: ctx.brand.name });
    const pendingReview = settings.features.reviewQueue || confidence < 0.6;

    const issue = await db.transaction(async (tx) => {
      const [{ highest }] = await tx.select({ highest: max(issues.number) }).from(issues).where(eq(issues.brandId, ctx.brand.id));
      const [row] = await tx
        .insert(issues)
        .values({
          brandId: ctx.brand.id,
          number: (highest ?? 100) + 1,
          title,
          type,
          verdict,
          severity,
          status: "open",
          reviewState: pendingReview ? "pending" : "approved",
          wrongStatement: representative.text,
          correctStatement:
            issueFact?.statement ?? "The Fact Sheet has no entry for this. Confirm the facts with your team and add them to the Fact Sheet.",
          factId: issueFact?.id ?? null,
          questionId: mainQuestionId,
          category: mainCategory,
          platforms,
          origin: cited ? "web" : "memory",
          confidence,
          runsSeen: result.runsSeen,
          runsTotal,
          firstSeenAt: now,
          lastSeenAt: now,
          nextCheckAt: ctx.brand.nextScanAt,
        })
        .returning();
      await tx.insert(issueEvents).values({ issueId: row.id, kind: "detected", actorId: null, actorName: SYSTEM_ACTOR, note });
      await tx.update(statements).set({ issueId: row.id, intermittent: false }).where(inArray(statements.id, statementIds));
      return row;
    });
    created.push(issue);
    touched.set(issue.id, { issue, group });
  }

  /* 4. Re-check existing issues whose question was asked and answered. */
  const resolved: number[] = [];
  const reopened: number[] = [];
  if (!rerun) {
    const createdIds = new Set(created.map((i) => i.id));
    const answeredPlatforms = new Map<string, Set<PlatformId>>();
    for (const answer of answerRows) {
      if (!check.checked.has(answer.id)) continue;
      const set = answeredPlatforms.get(answer.questionId) ?? new Set<PlatformId>();
      set.add(answer.platform);
      answeredPlatforms.set(answer.questionId, set);
    }
    const askedQuestionIds = [...answeredPlatforms.keys()];
    const candidates = askedQuestionIds.length
      ? await db
          .select()
          .from(issues)
          .where(
            and(
              eq(issues.brandId, ctx.brand.id),
              eq(issues.reviewState, "approved"),
              isNull(issues.dismissedAt),
              inArray(issues.questionId, askedQuestionIds),
            ),
          )
      : [];

    for (const issue of candidates) {
      if (createdIds.has(issue.id) || !issue.questionId) continue;
      const platformsAsked = answeredPlatforms.get(issue.questionId) ?? new Set<PlatformId>();
      // A clean result only counts when the platforms the issue is about were asked.
      if (issue.platforms.length > 0 && !issue.platforms.some((p) => platformsAsked.has(p))) continue;
      const errorSeen = seenIssueIds.has(issue.id);
      const outcome = afterRecheck(issue.status, issue.cleanScanStreak, errorSeen);
      const statusChanged = outcome.status !== issue.status;
      await db
        .update(issues)
        .set({
          status: outcome.status,
          cleanScanStreak: outcome.cleanScanStreak,
          ...(outcome.event === "resolved" ? { resolvedAt: now } : {}),
          ...(outcome.event === "reopened" ? { resolvedAt: null } : {}),
          nextCheckAt: outcome.status === "resolved" ? null : ctx.brand.nextScanAt,
          updatedAt: now,
        })
        .where(eq(issues.id, issue.id));
      if (!outcome.event) continue;
      const seen = seenNotes.get(issue.id) ?? "";
      const note =
        outcome.event === "resolved"
          ? RESOLVED_NOTE
          : outcome.event === "reopened"
            ? `The wrong statement came back. ${seen}`.trim()
            : outcome.event === "seen"
              ? issue.status === "fixed_rechecking"
                ? `Still seen after the fix. ${seen}`.trim()
                : seen || "Seen again in this scan."
              : cleanNote(outcome.cleanScanStreak, issue.status === "fixed_rechecking");
      await db.insert(issueEvents).values({
        issueId: issue.id,
        kind: outcome.event,
        fromStatus: statusChanged ? issue.status : null,
        toStatus: statusChanged ? outcome.status : null,
        actorId: null,
        actorName: SYSTEM_ACTOR,
        note,
      });
      if (outcome.event === "resolved") resolved.push(issue.number);
      if (outcome.event === "reopened") reopened.push(issue.number);
    }
  }

  /* 5. Sources and alerts. */
  let sourceCount = 0;
  if (settings.features.sourceTracing) {
    const pages = new Map<string, Promise<PageCheck>>();
    for (const { issue, group } of touched.values()) {
      // "Missing" means the AI said nothing wrong, so there is no wrong statement to trace.
      const wrong = group.filter((s) => s.verdict !== "missing");
      if (wrong.length === 0) continue;
      const carriers: Carrier[] = [...new Set(wrong.map((s) => s.answerId))].flatMap((answerId) => {
        const answer = answerById.get(answerId);
        if (!answer) return [];
        return [{ platform: answer.platform, citations: (citationsByAnswer.get(answerId) ?? []).map((c) => ({ url: c.url, title: c.title })) }];
      });
      sourceCount += await traceSources({ issueId: issue.id, claim: wrong[0].text, ctx, carriers, pages, now });
    }
  }
  for (const issue of created) {
    if (issue.reviewState === "approved") await sendInstantAlerts(issue.id);
  }

  /* 6. Scores. */
  let score: number | null = null;
  if (scan.type === "competitor") {
    await upsertCompetitorSnapshots({ scanId: scan.id, ctx, now });
  } else if (scan.type !== "recheck" && scan.type !== "prospect") {
    score = (await upsertScoreSnapshot({ scanId: scan.id, ctx, now })).accuracyScore;
  }

  return {
    answersChecked: check.checked.size,
    checkFailures: check.failures.length,
    statementsAdded: check.added,
    issuesCreated: created.map((i) => i.number),
    issuesUpdated: [...touched.values()].filter(({ issue }) => !created.some((c) => c.id === issue.id)).map(({ issue }) => issue.number),
    resolved,
    reopened,
    sources: sourceCount,
    accuracyScore: score,
  };
}
