import "server-only";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { ClientContext } from "@/lib/auth/dal";
import {
  answers,
  facts,
  getDb,
  issues,
  questions,
  scans,
  sources,
  statements,
  type Fact,
  type Question,
  type Source,
} from "@/lib/db";
import {
  ERROR_VERDICTS,
  FACT_CATEGORY_IDS,
  PLANS,
  PLATFORM_IDS,
  QUESTION_CATEGORY_IDS,
  UNRESOLVED_STATUSES,
  type FactCategory,
  type IssueStatus,
  type PlanId,
  type PlatformId,
  type QuestionCategory,
  type Severity,
  type SourceType,
} from "@/lib/domain/constants";
import { DISPLAY_TIME_ZONE } from "@/lib/domain/format";
import { compareSeverity } from "@/lib/domain/severity";

/*
  Reads for the content pages: the Fact Sheet, the Question Set and Sources.
  Every query is scoped to the signed-in client's brand.
*/

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: DISPLAY_TIME_ZONE,
});

/** Today's calendar day (YYYY-MM-DD) in the display time zone. */
export function dayOf(now: Date): string {
  return dayFormat.format(now);
}

/* ------------------------------------------------------------------ */
/* Fact Sheet                                                          */
/* ------------------------------------------------------------------ */

/**
 * A fact stops being current on its valid-to day: "No longer true" sets that
 * day to today, and the fact moves to past facts straight away.
 */
export function isPastFact(fact: Pick<Fact, "validTo">, today: string): boolean {
  return Boolean(fact.validTo && fact.validTo <= today);
}

export type FactSheet = {
  drafts: Fact[];
  current: { category: FactCategory; facts: Fact[] }[];
  currentCount: number;
  past: Fact[];
  archived: Fact[];
  today: string;
};

const importanceRank = { critical: 0, high: 1, medium: 2, low: 3 } as const;

function byImportance(a: Fact, b: Fact) {
  return importanceRank[a.importance] - importanceRank[b.importance] || a.statement.localeCompare(b.statement);
}

export async function getFactSheet(ctx: ClientContext): Promise<FactSheet> {
  const db = await getDb();
  const rows = await db.select().from(facts).where(eq(facts.brandId, ctx.brand.id)).orderBy(asc(facts.createdAt));
  const today = dayOf(ctx.now);

  const drafts: Fact[] = [];
  const current: Fact[] = [];
  const past: Fact[] = [];
  const archived: Fact[] = [];
  for (const fact of rows) {
    if (fact.status === "draft") drafts.push(fact);
    else if (fact.status === "archived") archived.push(fact);
    else if (isPastFact(fact, today)) past.push(fact);
    else current.push(fact);
  }

  drafts.sort((a, b) => FACT_CATEGORY_IDS.indexOf(a.category) - FACT_CATEGORY_IDS.indexOf(b.category) || byImportance(a, b));
  past.sort((a, b) => (b.validTo ?? "").localeCompare(a.validTo ?? ""));
  archived.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  return {
    drafts,
    current: FACT_CATEGORY_IDS.map((category) => ({
      category,
      facts: current.filter((fact) => fact.category === category).sort(byImportance),
    })).filter((group) => group.facts.length > 0),
    currentCount: current.length,
    past,
    archived,
    today,
  };
}

export async function getFact(ctx: ClientContext, id: string): Promise<Fact | undefined> {
  if (!isUuid(id)) return undefined;
  const db = await getDb();
  const [fact] = await db
    .select()
    .from(facts)
    .where(and(eq(facts.id, id), eq(facts.brandId, ctx.brand.id)))
    .limit(1);
  return fact;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/* ------------------------------------------------------------------ */
/* Question Set                                                        */
/* ------------------------------------------------------------------ */

/** The plan's question limit. Custom plans are capped where the engine caps them. */
export function questionLimit(plan: PlanId): { limit: number; custom: boolean } {
  const value = PLANS[plan].questions;
  return value === "custom" ? { limit: 200, custom: true } : { limit: value, custom: false };
}

type ResultIssue = { number: number; severity: Severity; status: IssueStatus };

/** What the latest scan found for one question, across the platforms it asked. */
export type QuestionResult =
  | { kind: "unchecked" }
  | {
      kind: "correct" | "wrong" | "mixed";
      checkedAt: Date;
      platforms: PlatformId[];
      wrongOn: PlatformId[];
      mixedOn: PlatformId[];
      /** Approved issues this question's wrong answers belong to, most severe first. */
      issues: ResultIssue[];
    };

export type QuestionRow = Question & { result: QuestionResult };

export type QuestionSet = {
  rows: QuestionRow[];
  activeCount: number;
  inactiveCount: number;
  limit: number;
  customLimit: boolean;
  counts: Record<QuestionCategory, { active: number; total: number }>;
};

const errorVerdicts = new Set<string>(ERROR_VERDICTS);

export async function getQuestionSet(ctx: ClientContext): Promise<QuestionSet> {
  const db = await getDb();
  const brandId = ctx.brand.id;

  const [questionRows, scanRows, pairs, issueRows] = await Promise.all([
    db.select().from(questions).where(eq(questions.brandId, brandId)).orderBy(asc(questions.createdAt)),
    db
      .select({ id: scans.id, type: scans.type, finishedAt: scans.finishedAt, createdAt: scans.createdAt })
      .from(scans)
      .where(and(eq(scans.brandId, brandId), eq(scans.status, "completed"))),
    // Which questions each scan asked: one row per question and scan.
    db
      .selectDistinct({ questionId: answers.questionId, scanId: answers.scanId })
      .from(answers)
      .where(eq(answers.brandId, brandId)),
    db
      .select({ id: issues.id, number: issues.number, severity: issues.severity, status: issues.status })
      .from(issues)
      .where(and(eq(issues.brandId, brandId), eq(issues.reviewState, "approved"), isNull(issues.dismissedAt))),
  ]);

  // Only completed scans of the client's own questions count as a result.
  const scanTime = new Map<string, number>();
  for (const scan of scanRows) {
    if (scan.type === "prospect" || scan.type === "competitor") continue;
    scanTime.set(scan.id, (scan.finishedAt ?? scan.createdAt).getTime());
  }

  const latestScan = new Map<string, string>();
  for (const pair of pairs) {
    const time = scanTime.get(pair.scanId);
    if (time === undefined) continue;
    const known = latestScan.get(pair.questionId);
    if (!known || (scanTime.get(known) ?? 0) < time) latestScan.set(pair.questionId, pair.scanId);
  }

  const scanIds = [...new Set(latestScan.values())];
  const answerRows =
    scanIds.length === 0
      ? []
      : await db
          .select({
            questionId: answers.questionId,
            scanId: answers.scanId,
            platform: answers.platform,
            verdict: statements.verdict,
            intermittent: statements.intermittent,
            issueId: statements.issueId,
          })
          .from(answers)
          .leftJoin(statements, eq(statements.answerId, answers.id))
          .where(and(eq(answers.brandId, brandId), inArray(answers.scanId, scanIds)));

  const approvedIssues = new Map(issueRows.map((row) => [row.id, row]));

  type Tally = { platforms: Set<PlatformId>; wrong: Set<PlatformId>; mixed: Set<PlatformId>; issues: Map<string, ResultIssue> };
  const tallies = new Map<string, Tally>();
  for (const row of answerRows) {
    if (latestScan.get(row.questionId) !== row.scanId) continue;
    let tally = tallies.get(row.questionId);
    if (!tally) {
      tally = { platforms: new Set(), wrong: new Set(), mixed: new Set(), issues: new Map() };
      tallies.set(row.questionId, tally);
    }
    tally.platforms.add(row.platform);
    if (!row.verdict) continue;
    const issue = row.issueId ? approvedIssues.get(row.issueId) : undefined;
    if (issue && errorVerdicts.has(row.verdict)) {
      tally.wrong.add(row.platform);
      tally.issues.set(issue.id, { number: issue.number, severity: issue.severity, status: issue.status });
    } else if (row.verdict === "unsupported" || errorVerdicts.has(row.verdict)) {
      // Seen only once, still waiting for review, or not covered by the Fact Sheet.
      tally.mixed.add(row.platform);
    }
  }

  const order = (list: Iterable<PlatformId>) => PLATFORM_IDS.filter((id) => new Set(list).has(id));

  const rows: QuestionRow[] = questionRows.map((question) => {
    const tally = tallies.get(question.id);
    const scanId = latestScan.get(question.id);
    if (!tally || !scanId || tally.platforms.size === 0) return { ...question, result: { kind: "unchecked" } };
    const wrongOn = order(tally.wrong);
    const mixedOn = order([...tally.mixed].filter((id) => !tally.wrong.has(id)));
    return {
      ...question,
      result: {
        kind: wrongOn.length > 0 ? "wrong" : mixedOn.length > 0 ? "mixed" : "correct",
        checkedAt: new Date(scanTime.get(scanId) ?? 0),
        platforms: order(tally.platforms),
        wrongOn,
        mixedOn,
        issues: [...tally.issues.values()].sort((a, b) => compareSeverity(a.severity, b.severity) || a.number - b.number),
      },
    };
  });

  const counts = Object.fromEntries(QUESTION_CATEGORY_IDS.map((id) => [id, { active: 0, total: 0 }])) as QuestionSet["counts"];
  let activeCount = 0;
  for (const question of questionRows) {
    counts[question.category].total += 1;
    if (question.active) {
      counts[question.category].active += 1;
      activeCount += 1;
    }
  }

  const { limit, custom } = questionLimit(ctx.organization.plan);
  return {
    rows,
    activeCount,
    inactiveCount: questionRows.length - activeCount,
    limit,
    customLimit: custom,
    counts,
  };
}

export async function getQuestion(ctx: ClientContext, id: string): Promise<Question | undefined> {
  if (!isUuid(id)) return undefined;
  const db = await getDb();
  const [question] = await db
    .select()
    .from(questions)
    .where(and(eq(questions.id, id), eq(questions.brandId, ctx.brand.id)))
    .limit(1);
  return question;
}

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

export type SourceIssue = { number: number; title: string; severity: Severity; status: IssueStatus; open: boolean };

export type SourcePage = {
  url: string;
  title: string | null;
  publishedLabel: string | null;
  note: string | null;
  containsStatement: boolean;
  likely: boolean;
  citedBy: PlatformId[];
  checkedAt: Date | null;
  issues: SourceIssue[];
};

export type SourceGroup = {
  domain: string;
  sourceType: SourceType;
  pages: SourcePage[];
  pagesWithStatement: number;
  issues: SourceIssue[];
  openIssues: number;
};

const openStatuses = new Set<IssueStatus>(UNRESOLVED_STATUSES);

export async function getSourceGroups(ctx: ClientContext): Promise<SourceGroup[]> {
  const db = await getDb();
  const rows = await db
    .select({
      source: sources,
      issue: { number: issues.number, title: issues.title, severity: issues.severity, status: issues.status },
    })
    .from(sources)
    .innerJoin(issues, eq(issues.id, sources.issueId))
    .where(and(eq(issues.brandId, ctx.brand.id), eq(issues.reviewState, "approved"), isNull(issues.dismissedAt)))
    .orderBy(desc(sources.checkedAt));

  const groups = new Map<string, { types: Map<SourceType, number>; pages: Map<string, SourcePage>; rows: Source[] }>();

  for (const { source, issue } of rows) {
    const domain = source.domain.replace(/^www\./, "").toLowerCase();
    let group = groups.get(domain);
    if (!group) {
      group = { types: new Map(), pages: new Map(), rows: [] };
      groups.set(domain, group);
    }
    group.rows.push(source);
    group.types.set(source.sourceType, (group.types.get(source.sourceType) ?? 0) + 1);

    const linked: SourceIssue = { ...issue, open: openStatuses.has(issue.status) };
    const page = group.pages.get(source.url);
    if (!page) {
      group.pages.set(source.url, {
        url: source.url,
        title: source.title,
        publishedLabel: source.publishedLabel,
        note: source.note,
        containsStatement: source.containsStatement,
        likely: source.likelihood === "likely",
        citedBy: [...source.citedBy],
        checkedAt: source.checkedAt,
        issues: [linked],
      });
      continue;
    }
    page.title ??= source.title;
    page.publishedLabel ??= source.publishedLabel;
    page.note ??= source.note;
    page.containsStatement ||= source.containsStatement;
    page.likely ||= source.likelihood === "likely";
    page.citedBy = PLATFORM_IDS.filter((id) => page.citedBy.includes(id) || source.citedBy.includes(id));
    if (source.checkedAt && (!page.checkedAt || source.checkedAt > page.checkedAt)) page.checkedAt = source.checkedAt;
    if (!page.issues.some((known) => known.number === issue.number)) page.issues.push(linked);
  }

  const result: SourceGroup[] = [];
  for (const [domain, group] of groups) {
    const pages = [...group.pages.values()];
    for (const page of pages) page.issues.sort((a, b) => a.number - b.number);
    pages.sort(
      (a, b) =>
        Number(b.containsStatement) - Number(a.containsStatement) ||
        b.issues.filter((i) => i.open).length - a.issues.filter((i) => i.open).length ||
        a.url.localeCompare(b.url),
    );
    const issueMap = new Map<number, SourceIssue>();
    for (const page of pages) for (const issue of page.issues) issueMap.set(issue.number, issue);
    const linkedIssues = [...issueMap.values()].sort((a, b) => a.number - b.number);
    // The most common type among the domain's pages names the website.
    const sourceType = [...group.types.entries()].sort((a, b) => b[1] - a[1])[0][0];
    result.push({
      domain,
      sourceType,
      pages,
      pagesWithStatement: pages.filter((page) => page.containsStatement).length,
      issues: linkedIssues,
      openIssues: linkedIssues.filter((issue) => issue.open).length,
    });
  }

  return result.sort(
    (a, b) =>
      b.openIssues - a.openIssues ||
      b.pagesWithStatement - a.pagesWithStatement ||
      b.issues.length - a.issues.length ||
      a.domain.localeCompare(b.domain),
  );
}
