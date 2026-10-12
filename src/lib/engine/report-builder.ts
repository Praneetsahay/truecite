import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, lt, lte } from "drizzle-orm";
import {
  answers,
  brands,
  competitorSnapshots,
  competitors,
  getDb,
  issueEvents,
  issues,
  questions,
  scans,
  scoreSnapshots,
  sources,
  statements,
  type Issue,
  type ScoreSnapshot,
} from "@/lib/db";
import {
  ERROR_VERDICTS,
  PLATFORM_IDS,
  PLATFORMS,
  type IssueStatus,
  type PlatformId,
  type ReportType,
  type ScanType,
} from "@/lib/domain/constants";
import { DISPLAY_TIME_ZONE, displayUrl, listJoin } from "@/lib/domain/format";
import { PLAYBOOK } from "@/lib/domain/playbook";
import { METHOD_NOTES, type ReportData, type ReportFinding } from "@/lib/domain/report";
import { displayScore, scoreDelta } from "@/lib/domain/score";
import { compareSeverity } from "@/lib/domain/severity";
import { EngineError } from "./errors";

/*
  Builds the frozen content of a report from the database: scores from score
  snapshots, risks and fixes from issues and their evidence trail, excerpts from
  stored answers, competitors from competitor snapshots and the method from the
  period's scans. Everything is computed as of the end of the period, so a report
  built later for an earlier month says what was true then.
*/

const TOP_RISKS = 5;
const FULL_SCAN_TYPES: ScanType[] = ["scheduled", "manual", "audit"];

/* Dates, in the display time zone so labels match what people see in the app. */

const dayKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const monthName = new Intl.DateTimeFormat("en-GB", { timeZone: DISPLAY_TIME_ZONE, month: "long", year: "numeric" });
/** British English writes September as "Sept"; TrueCite uses three letters for every month. */
const threeLetters = (format: Intl.DateTimeFormat) => ({
  format: (date: Date) => format.format(date).replace(/\bSept\b/g, "Sep"),
});
const shortDay = threeLetters(new Intl.DateTimeFormat("en-GB", { timeZone: DISPLAY_TIME_ZONE, day: "numeric", month: "short" }));
const shortDayYear = threeLetters(
  new Intl.DateTimeFormat("en-GB", {
    timeZone: DISPLAY_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  }),
);

/** YYYY-MM-DD in the display time zone. */
export function isoDay(date: Date): string {
  return dayKey.format(date);
}

/** "September 2026" */
export function monthLabel(date: Date): string {
  return monthName.format(date);
}

/** "1–14 Jul 2026", "28 Jun – 14 Jul 2026" */
function dayRange(from: Date, to: Date): string {
  if (isoDay(from) === isoDay(to)) return shortDayYear.format(to);
  const sameYear = isoDay(from).slice(0, 4) === isoDay(to).slice(0, 4);
  const sameMonth = isoDay(from).slice(0, 7) === isoDay(to).slice(0, 7);
  if (sameMonth) return `${isoDay(from).slice(8, 10).replace(/^0/, "")}–${shortDayYear.format(to)}`;
  if (sameYear) return `${shortDay.format(from)} – ${shortDayYear.format(to)}`;
  return `${shortDayYear.format(from)} – ${shortDayYear.format(to)}`;
}

/** The middle of a period: month boundaries given in UTC still name the right month in any time zone. */
export function midpoint(from: Date, to: Date): Date {
  return new Date((from.getTime() + to.getTime()) / 2);
}

export function periodLabel(type: ReportType, from: Date, to: Date): string {
  if (type === "monthly") return monthLabel(midpoint(from, to));
  if (type === "audit") return `Audit, ${dayRange(from, to)}`;
  return monthLabel(to);
}

/* Plain words. */

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function count(n: number): string {
  return n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n);
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

const PROPER_WORDS = new Set(["LinkedIn", "Wikipedia", "Google", "TrueCite", "Crunchbase"]);

/** "Redirect old pages" becomes "redirect old pages"; proper names keep their capital. */
function lowerFirst(text: string): string {
  const first = text.split(/\s/)[0] ?? "";
  if (PROPER_WORDS.has(first.replace(/[^A-Za-z]/g, "")) || !/^[A-Z][a-z]/.test(first)) return text;
  return text[0].toLowerCase() + text.slice(1);
}

function times(n: number): string {
  if (n === 1) return "once";
  if (n === 2) return "twice each";
  return `${count(n)} times each`;
}

/* Answer excerpts: about two sentences around the claim, with the claim's offsets recomputed. */

type Excerpt = { text: string; wrongStart: number; wrongEnd: number };

function sentenceRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  const boundary = /[.!?]+["”’)\]]*(?=\s)|\n/g;
  let from = 0;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(text))) {
    const end = match.index + match[0].length;
    if (end > from) ranges.push([from, end]);
    from = end;
  }
  if (from < text.length) ranges.push([from, text.length]);
  return ranges
    .map(([a, b]): [number, number] => {
      let start = a;
      let end = b;
      while (start < end && /\s/.test(text[start])) start++;
      while (end > start && /\s/.test(text[end - 1])) end--;
      return [start, end];
    })
    .filter(([a, b]) => b > a);
}

/** Removes markdown markers and citation numbers, keeping the claim's offsets in step. */
function cleanMarkdown(input: Excerpt): Excerpt {
  const removals: [number, number][] = [];
  const collect = (pattern: RegExp, pick?: (m: RegExpExecArray) => [number, number][]) => {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(input.text))) {
      if (m[0].length === 0) {
        pattern.lastIndex++;
        continue;
      }
      removals.push(...(pick ? pick(m) : [[m.index, m.index + m[0].length] as [number, number]]));
    }
  };
  collect(/\*\*|__/g);
  collect(/^#{1,6}[ \t]+/gm);
  collect(/^[ \t]*[-*•][ \t]+/gm);
  collect(/[ \t]*(\[\d+\]|【[^】]*】)/g);
  collect(/\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g, (m) => [
    [m.index, m.index + 1],
    [m.index + 1 + m[1].length, m.index + m[0].length],
  ]);
  if (removals.length === 0) return input;
  removals.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of removals) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  const map = (index: number) => {
    let removed = 0;
    for (const [a, b] of merged) {
      if (b <= index) removed += b - a;
      else if (a < index) removed += index - a;
    }
    return index - removed;
  };
  let text = "";
  let cursor = 0;
  for (const [a, b] of merged) {
    text += input.text.slice(cursor, a);
    cursor = b;
  }
  text += input.text.slice(cursor);
  const wrongStart = map(input.wrongStart);
  const wrongEnd = map(input.wrongEnd);
  if (wrongEnd <= wrongStart) return input;
  return { text, wrongStart, wrongEnd };
}

/** About two sentences around the claim at [start, end), trimmed with ellipses, offsets recomputed. */
export function excerptAround(text: string, start: number, end: number, maxChars = 420): Excerpt | null {
  if (start < 0 || end <= start || end > text.length) return null;
  const ranges = sentenceRanges(text);
  if (ranges.length === 0) return null;
  let first = ranges.findIndex(([, b]) => b > start);
  if (first === -1) first = ranges.length - 1;
  let last = first;
  while (last + 1 < ranges.length && ranges[last + 1][0] < end) last++;

  let from = Math.min(ranges[first][0], start);
  let to = Math.max(ranges[last][1], end);
  if (last === first) {
    const next = ranges[last + 1];
    const previous = ranges[first - 1];
    if (next && next[1] - from <= maxChars) to = next[1];
    else if (previous && to - previous[0] <= maxChars) from = previous[0];
  }
  // One very long sentence: keep a window around the claim, cut at word boundaries.
  if (to - from > maxChars + 160) {
    const pad = Math.max(80, Math.floor((maxChars - (end - start)) / 2));
    let a = Math.max(from, start - pad);
    let b = Math.min(to, end + pad);
    if (a > from) {
      const space = text.indexOf(" ", a);
      if (space !== -1 && space < start) a = space + 1;
    }
    if (b < to) {
      const space = text.lastIndexOf(" ", b);
      if (space > end) b = space;
    }
    from = a;
    to = b;
  }
  // Clean the slice first, so list markers and headings at its start go too.
  const cleaned = cleanMarkdown({ text: text.slice(from, to), wrongStart: start - from, wrongEnd: end - from });
  const lead = cleaned.text.length - cleaned.text.trimStart().length;
  const body = cleaned.text.trim();
  const wrongStart = Math.max(0, cleaned.wrongStart - lead);
  const wrongEnd = Math.min(body.length, cleaned.wrongEnd - lead);
  if (wrongEnd <= wrongStart) return null;
  const prefix = from > 0 ? "… " : "";
  const suffix = to < text.length ? " …" : "";
  return { text: `${prefix}${body}${suffix}`, wrongStart: prefix.length + wrongStart, wrongEnd: prefix.length + wrongEnd };
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/* The report. */

type ReportIssue = Pick<
  Issue,
  | "id"
  | "number"
  | "title"
  | "type"
  | "severity"
  | "status"
  | "platforms"
  | "wrongStatement"
  | "correctStatement"
  | "questionId"
  | "origin"
  | "assigneeId"
  | "fixProgress"
  | "firstSeenAt"
  | "lastSeenAt"
  | "resolvedAt"
  | "dismissedAt"
  | "updatedAt"
> & { statusAt: IssueStatus };

function byRisk(a: ReportIssue, b: ReportIssue): number {
  return compareSeverity(a.severity, b.severity) || b.lastSeenAt.getTime() - a.lastSeenAt.getTime() || a.number - b.number;
}

export async function buildReport(input: { brandId: string; type: ReportType; from: Date; to: Date }): Promise<ReportData> {
  const { brandId, type, from, to } = input;
  if (!(from instanceof Date) || !(to instanceof Date) || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    throw new EngineError("The report period is not valid. Choose a start date before the end date.");
  }
  const prospect = type === "prospect";
  const db = await getDb();

  const [brand] = await db
    .select({ id: brands.id, name: brands.name, website: brands.website, platforms: brands.platforms, runsPerQuestion: brands.runsPerQuestion })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  if (!brand) throw new EngineError("This company could not be found. Reload the page and try again.");

  /* Issues the client can see, with their status at the end of the period. */
  const issueRows = await db
    .select({
      id: issues.id,
      number: issues.number,
      title: issues.title,
      type: issues.type,
      severity: issues.severity,
      status: issues.status,
      platforms: issues.platforms,
      wrongStatement: issues.wrongStatement,
      correctStatement: issues.correctStatement,
      questionId: issues.questionId,
      origin: issues.origin,
      assigneeId: issues.assigneeId,
      fixProgress: issues.fixProgress,
      firstSeenAt: issues.firstSeenAt,
      lastSeenAt: issues.lastSeenAt,
      resolvedAt: issues.resolvedAt,
      dismissedAt: issues.dismissedAt,
      updatedAt: issues.updatedAt,
    })
    .from(issues)
    .where(and(eq(issues.brandId, brandId), eq(issues.reviewState, "approved")));

  const visible = issueRows.filter((issue) =>
    prospect ? issue.dismissedAt === null : issue.firstSeenAt <= to && (issue.dismissedAt === null || issue.dismissedAt > to),
  );

  const statusEvents =
    !prospect && visible.length > 0
      ? await db
          .select({ issueId: issueEvents.issueId, kind: issueEvents.kind, toStatus: issueEvents.toStatus, createdAt: issueEvents.createdAt })
          .from(issueEvents)
          .where(and(inArray(issueEvents.issueId, visible.map((i) => i.id)), lte(issueEvents.createdAt, to)))
          .orderBy(asc(issueEvents.createdAt))
      : [];
  const lastStatus = new Map<string, IssueStatus>();
  const resolvedInPeriod = new Map<string, Date>();
  for (const event of statusEvents) {
    if (event.toStatus) lastStatus.set(event.issueId, event.toStatus);
    if ((event.kind === "resolved" || event.toStatus === "resolved") && event.createdAt >= from) {
      resolvedInPeriod.set(event.issueId, event.createdAt);
    }
  }

  const reportIssues: ReportIssue[] = visible.map((issue) => {
    let statusAt: IssueStatus;
    if (prospect || issue.updatedAt <= to) statusAt = issue.status;
    else if (lastStatus.has(issue.id)) statusAt = lastStatus.get(issue.id)!;
    else if (issue.resolvedAt && issue.resolvedAt <= to) statusAt = "resolved";
    else statusAt = "open";
    return { ...issue, statusAt };
  });
  const open = reportIssues.filter((issue) => issue.statusAt !== "resolved").sort(byRisk);
  const openRisks = {
    critical: open.filter((i) => i.severity === "critical").length,
    high: open.filter((i) => i.severity === "high").length,
  };

  /* Scores. */
  const [inPeriod, [before], [latestUpToEnd]] = await Promise.all([
    db
      .select()
      .from(scoreSnapshots)
      .where(and(eq(scoreSnapshots.brandId, brandId), gte(scoreSnapshots.takenAt, from), lte(scoreSnapshots.takenAt, to)))
      .orderBy(asc(scoreSnapshots.takenAt)),
    db
      .select()
      .from(scoreSnapshots)
      .where(and(eq(scoreSnapshots.brandId, brandId), lt(scoreSnapshots.takenAt, from)))
      .orderBy(desc(scoreSnapshots.takenAt))
      .limit(1),
    db
      .select()
      .from(scoreSnapshots)
      .where(and(eq(scoreSnapshots.brandId, brandId), lte(scoreSnapshots.takenAt, to)))
      .orderBy(desc(scoreSnapshots.takenAt))
      .limit(1),
  ]);
  const currentSnapshot: ScoreSnapshot | null = prospect ? (latestUpToEnd ?? null) : (inPeriod[inPeriod.length - 1] ?? null);
  const previousSnapshot: ScoreSnapshot | null = prospect ? null : (before ?? null);
  const trend = prospect
    ? []
    : [...(previousSnapshot ? [previousSnapshot] : []), ...inPeriod]
        .filter((s) => s.accuracyScore !== null)
        .map((s) => ({ date: isoDay(s.takenAt), score: s.accuracyScore as number }));

  /* Method: the period's scans. */
  const scanTypes: ScanType[] = prospect ? ["prospect"] : FULL_SCAN_TYPES;
  const scanRows = await db
    .select({
      platforms: scans.platforms,
      runsPerQuestion: scans.runsPerQuestion,
      questionCount: scans.questionCount,
      simulated: scans.simulated,
      startedAt: scans.startedAt,
      finishedAt: scans.finishedAt,
      createdAt: scans.createdAt,
    })
    .from(scans)
    .where(
      and(
        eq(scans.brandId, brandId),
        inArray(scans.type, scanTypes),
        eq(scans.status, "completed"),
        prospect ? lte(scans.createdAt, to) : and(gte(scans.createdAt, from), lte(scans.createdAt, to)),
      ),
    )
    .orderBy(asc(scans.createdAt));
  const scanPlatforms = new Set<PlatformId>(scanRows.flatMap((s) => s.platforms));
  const methodPlatforms = PLATFORM_IDS.filter((id) => (scanRows.length > 0 ? scanPlatforms.has(id) : brand.platforms.includes(id)));
  const methodFrom = scanRows.length > 0 ? (scanRows[0].startedAt ?? scanRows[0].createdAt) : from;
  const lastScan = scanRows[scanRows.length - 1];
  const methodTo = lastScan ? (lastScan.finishedAt ?? lastScan.createdAt) : to;
  const method: ReportData["method"] = {
    from: isoDay(methodFrom),
    to: isoDay(methodTo),
    platforms: methodPlatforms,
    questions: scanRows.reduce((max, s) => Math.max(max, s.questionCount), 0),
    runsPerQuestion: scanRows.reduce((max, s) => Math.max(max, s.runsPerQuestion), 0) || brand.runsPerQuestion,
    scans: scanRows.length,
    notes: [
      ...METHOD_NOTES,
      ...(scanRows.some((s) => s.simulated)
        ? ["Some answers in this period came from TrueCite's built-in simulator, because no API key was configured for every platform."]
        : []),
    ],
  };

  /* Per platform: the latest snapshot's score and the open issues seen there. */
  const platformKeys = PLATFORM_IDS.filter(
    (id) =>
      (prospect ? methodPlatforms.includes(id) : brand.platforms.includes(id)) ||
      currentSnapshot?.byPlatform[id] !== undefined ||
      open.some((issue) => issue.platforms.includes(id)),
  );
  const byPlatform: ReportData["byPlatform"] = platformKeys.map((platform) => ({
    platform,
    score: currentSnapshot?.byPlatform[platform]?.score ?? null,
    openIssues: open.filter((issue) => issue.platforms.includes(platform)).length,
  }));

  /* Top risks with their evidence. */
  const top = open.slice(0, TOP_RISKS);
  const topRisks = await buildFindings(top, to, prospect);

  /* Fixed in the period. */
  const fixed: ReportData["fixed"] = prospect
    ? []
    : reportIssues
        .map((issue) => {
          const at =
            resolvedInPeriod.get(issue.id) ??
            (issue.resolvedAt && issue.resolvedAt >= from && issue.resolvedAt <= to ? issue.resolvedAt : null);
          return at ? { issue, at } : null;
        })
        .filter((row): row is { issue: ReportIssue; at: Date } => row !== null)
        .sort((a, b) => a.at.getTime() - b.at.getTime())
        .map(({ issue, at }) => ({ title: issue.title, resolvedOn: isoDay(at), platforms: issue.platforms }));

  /* Competitors, as estimates, next to the client. */
  let competitorRows: ReportData["competitors"] = [];
  if (!prospect) {
    const [list, latest] = await Promise.all([
      db.select({ id: competitors.id, name: competitors.name }).from(competitors).where(eq(competitors.brandId, brandId)),
      db
        .selectDistinctOn([competitorSnapshots.competitorId], {
          competitorId: competitorSnapshots.competitorId,
          accuracyScore: competitorSnapshots.accuracyScore,
          shareOfVoice: competitorSnapshots.shareOfVoice,
          sentiment: competitorSnapshots.sentiment,
        })
        .from(competitorSnapshots)
        .where(
          and(
            eq(competitorSnapshots.brandId, brandId),
            gte(competitorSnapshots.takenAt, from),
            lte(competitorSnapshots.takenAt, to),
          ),
        )
        .orderBy(competitorSnapshots.competitorId, desc(competitorSnapshots.takenAt)),
    ]);
    const byCompetitor = new Map(latest.map((row) => [row.competitorId, row]));
    const measured = list.filter((c) => byCompetitor.has(c.id));
    if (measured.length > 0) {
      competitorRows = [
        {
          name: brand.name,
          isClient: true,
          score: currentSnapshot?.accuracyScore ?? null,
          estimate: false,
          shareOfVoice: currentSnapshot?.shareOfVoice ?? null,
          sentiment: currentSnapshot?.sentiment ?? null,
        },
        ...measured.map((c) => {
          const row = byCompetitor.get(c.id)!;
          return {
            name: c.name,
            score: row.accuracyScore,
            estimate: true,
            shareOfVoice: row.shareOfVoice,
            sentiment: row.sentiment ?? null,
          };
        }),
      ].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    }
  }

  // An audit is labelled with the days its scans ran; other reports with their period.
  const label = type === "audit" && scanRows.length > 0 ? periodLabel(type, methodFrom, methodTo) : periodLabel(type, from, to);
  const data: ReportData = {
    type,
    brandName: brand.name,
    website: displayUrl(brand.website.includes("://") ? brand.website : `https://${brand.website}`),
    periodLabel: label,
    generatedAt: new Date().toISOString(),
    summary: "",
    score: {
      current: currentSnapshot?.accuracyScore ?? null,
      previous: previousSnapshot?.accuracyScore ?? null,
      trend,
    },
    openRisks,
    byPlatform,
    topRisks,
    fixed,
    nextSteps: [],
    competitors: competitorRows,
    method,
  };
  data.summary = summarize(data, { open, rechecking: open.filter((i) => i.statusAt === "fixed_rechecking").length, period: label, to });
  data.nextSteps = nextSteps(data, open, prospect);
  return data;
}

async function buildFindings(top: ReportIssue[], to: Date, prospect: boolean): Promise<ReportFinding[]> {
  if (top.length === 0) return [];
  const db = await getDb();
  const ids = top.map((issue) => issue.id);
  const questionIds = top.map((issue) => issue.questionId).filter((id): id is string => id !== null);

  const [questionRows, sourceRows, statementRows] = await Promise.all([
    questionIds.length
      ? db.select({ id: questions.id, text: questions.text }).from(questions).where(inArray(questions.id, questionIds))
      : Promise.resolve([] as { id: string; text: string }[]),
    db
      .select({ issueId: sources.issueId, url: sources.url })
      .from(sources)
      .where(and(inArray(sources.issueId, ids), eq(sources.likelihood, "likely"))),
    db
      .select({
        issueId: statements.issueId,
        answerId: statements.answerId,
        spanStart: statements.spanStart,
        spanEnd: statements.spanEnd,
        claim: statements.text,
        platform: answers.platform,
        questionId: answers.questionId,
      })
      .from(statements)
      .innerJoin(answers, eq(answers.id, statements.answerId))
      .where(
        and(
          inArray(statements.issueId, ids),
          inArray(statements.verdict, [...ERROR_VERDICTS]),
          prospect ? undefined : lte(answers.createdAt, to),
        ),
      )
      .orderBy(desc(answers.createdAt)),
  ]);
  const questionText = new Map(questionRows.map((q) => [q.id, q.text]));

  // The latest answer that carries each issue's statement, preferring one with the claim located.
  const chosen = new Map<string, (typeof statementRows)[number]>();
  for (const row of statementRows) {
    if (!row.issueId) continue;
    const current = chosen.get(row.issueId);
    const located = row.spanStart !== null && row.spanEnd !== null;
    if (!current || (located && (current.spanStart === null || current.spanEnd === null))) chosen.set(row.issueId, row);
  }
  const answerIds = [...new Set([...chosen.values()].map((row) => row.answerId))];
  const answerRows = answerIds.length
    ? await db.select({ id: answers.id, text: answers.text, questionId: answers.questionId }).from(answers).where(inArray(answers.id, answerIds))
    : [];
  const answerById = new Map(answerRows.map((a) => [a.id, a]));

  const findings: ReportFinding[] = [];
  for (const issue of top) {
    let answer: ReportFinding["answer"] = null;
    let answerQuestionId: string | null = null;
    const row = chosen.get(issue.id);
    const stored = row ? answerById.get(row.answerId) : undefined;
    if (row && stored) {
      answerQuestionId = stored.questionId;
      let start = row.spanStart ?? -1;
      let end = row.spanEnd ?? -1;
      if (start < 0 || end <= start || end > stored.text.length) {
        const at = stored.text.toLowerCase().indexOf((row.claim || issue.wrongStatement).toLowerCase());
        start = at;
        end = at === -1 ? -1 : at + (row.claim || issue.wrongStatement).length;
      }
      const excerpt = excerptAround(stored.text, start, end);
      if (excerpt) answer = { ...excerpt, platform: row.platform };
    }
    if (!answer && issue.questionId && issue.wrongStatement.trim().length >= 3) {
      // No linked statement: look for the wording in the latest answers to the issue's question.
      const [match] = await db
        .select({ text: answers.text, platform: answers.platform })
        .from(answers)
        .where(
          and(
            eq(answers.questionId, issue.questionId),
            ilike(answers.text, `%${escapeLike(issue.wrongStatement)}%`),
            prospect ? undefined : lte(answers.createdAt, to),
            issue.platforms.length ? inArray(answers.platform, issue.platforms) : undefined,
          ),
        )
        .orderBy(desc(answers.createdAt))
        .limit(1);
      if (match) {
        const at = match.text.toLowerCase().indexOf(issue.wrongStatement.toLowerCase());
        const excerpt = excerptAround(match.text, at, at + issue.wrongStatement.length);
        if (excerpt) answer = { ...excerpt, platform: match.platform };
      }
    }

    const likelySources = [...new Set(sourceRows.filter((s) => s.issueId === issue.id).map((s) => displayUrl(s.url)))];
    const question = questionText.get(issue.questionId ?? "") ?? (answerQuestionId ? await questionById(answerQuestionId) : null);
    findings.push({
      issueNumber: issue.number,
      title: issue.title,
      severity: issue.severity,
      status: issue.statusAt,
      platforms: issue.platforms,
      question: question ?? "",
      answer,
      wrong: issue.wrongStatement,
      correct: issue.correctStatement,
      likelySources,
      fix: [...(PLAYBOOK[issue.type] ?? PLAYBOOK.other).steps],
    });
  }
  return findings;
}

async function questionById(id: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db.select({ text: questions.text }).from(questions).where(eq(questions.id, id)).limit(1);
  return row?.text ?? null;
}

function riskPhrase(critical: number, high: number): string {
  if (critical > 0 && high > 0) return `${count(critical)} critical and ${count(high)} high-severity ${high + critical === 1 ? "issue" : "issues"}`;
  if (critical > 0) return `${count(critical)} critical ${critical === 1 ? "issue" : "issues"}`;
  return `${count(high)} high-severity ${high === 1 ? "issue" : "issues"}`;
}

function summarize(
  data: ReportData,
  context: { open: ReportIssue[]; rechecking: number; period: string; to: Date },
): string {
  const name = data.brandName;
  const { critical, high } = data.openRisks;
  const lead = context.open[0];
  const platforms = listJoin(data.method.platforms.map((id) => PLATFORMS[id].name));

  if (data.type === "prospect") {
    const found = context.open.length;
    const criticalNote = critical > 0 ? `, ${count(critical)} of them critical` : "";
    const asked =
      data.method.questions > 0
        ? `In ${monthLabel(context.to)} we asked ${platforms} ${data.method.questions} questions a customer might ask about ${name}, ${times(data.method.runsPerQuestion)}`
        : `In ${monthLabel(context.to)} we asked ${platforms} the questions a customer might ask about ${name}`;
    const result =
      found > 0
        ? `and found ${count(found)} wrong ${found === 1 ? "statement" : "statements"} about the company${criticalNote}.`
        : "and found no wrong statements about the company.";
    return [
      "TrueCite checks what AI assistants tell people about companies.",
      `${asked}, ${result}`,
      found > 0 ? "Each finding below shows what the assistant said, the correct fact and the steps that usually fix it." : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  const current = data.score.current;
  const previous = data.score.previous;
  const delta = scoreDelta(current, previous);
  const risk =
    critical + high > 0
      ? `${riskPhrase(critical, high)} ${critical + high === 1 ? "is" : "are"} open${lead ? `, led by “${lead.title}”` : ""}`
      : context.open.length > 0
        ? `no critical or high-severity issues are open, and ${count(context.open.length)} lower-severity ${context.open.length === 1 ? "issue needs" : "issues need"} work`
        : "no issues are open";

  if (data.type === "audit") {
    const asked =
      data.method.questions > 0
        ? `This audit asked ${platforms} ${data.method.questions} questions about ${name}, ${times(data.method.runsPerQuestion)}.`
        : `This audit checked what ${platforms} say about ${name}.`;
    const score =
      current !== null
        ? `${possessive(name)} Accuracy Score is ${displayScore(current)} out of 100, and ${risk}.`
        : `${capitalize(risk)}.`;
    return `${asked} ${score} The findings below are ordered by risk, each with the correct fact and the steps that fix it.`;
  }

  let scoreSentence: string;
  if (current === null) scoreSentence = `No answers about ${name} were checked in ${context.period}.`;
  else if (delta === null) scoreSentence = `${possessive(name)} Accuracy Score was ${displayScore(current)} out of 100 in ${context.period}.`;
  else if (delta > 0)
    scoreSentence = `${possessive(name)} Accuracy Score rose from ${displayScore(previous)} to ${displayScore(current)} in ${context.period}.`;
  else if (delta < 0)
    scoreSentence = `${possessive(name)} Accuracy Score fell from ${displayScore(previous)} to ${displayScore(current)} in ${context.period}.`;
  else scoreSentence = `${possessive(name)} Accuracy Score held at ${displayScore(current)} in ${context.period}.`;

  const fixed = data.fixed.length;
  const fixedSentence =
    fixed === 1
      ? `Your team resolved “${data.fixed[0].title}” this month.`
      : fixed > 1
        ? `Your team resolved ${count(fixed)} issues this month, including “${data.fixed[fixed - 1].title}”.`
        : context.rechecking > 0
        ? `No issues were resolved this month; ${count(context.rechecking)} ${context.rechecking === 1 ? "fix is" : "fixes are"} being re-checked.`
        : "No issues were resolved this month.";
  return `${scoreSentence} ${capitalize(risk)}. ${fixedSentence}`;
}

function nextSteps(data: ReportData, open: ReportIssue[], prospect: boolean): string[] {
  const steps: string[] = [];
  const add = (step: string) => {
    if (!steps.includes(step)) steps.push(step);
  };

  // The next step nobody has ticked off, for the riskiest issues still being worked on.
  const working = open.filter((issue) => issue.statusAt !== "fixed_rechecking");
  for (const issue of working.slice(0, 2)) {
    const playbook = PLAYBOOK[issue.type] ?? PLAYBOOK.other;
    const index = playbook.steps.findIndex((_, i) => !issue.fixProgress.includes(i));
    if (index === -1) continue;
    add(`${issue.title}: ${lowerFirst(playbook.steps[index])}`);
  }

  if (prospect) {
    if (open.some((issue) => issue.origin === "memory")) {
      add("Strengthen the official pages and trusted third-party profiles AI assistants learn from, because errors from AI memory take longer to change than errors from live web pages.");
    }
    add("Check directories, review sites and Wikipedia for the same wrong details, since AI assistants often repeat them.");
    add("A full audit asks ChatGPT, Gemini, Perplexity and Claude about a hundred questions, then tracks each fix until the answers change.");
    return steps.slice(0, 4);
  }

  const unowned = open.filter((issue) => (issue.statusAt === "open" || issue.statusAt === "reopened") && issue.assigneeId === null);
  if (unowned.length > 0) {
    add(
      unowned.length === 1
        ? `Assign an owner to “${unowned[0].title}”, which nobody has acted on yet.`
        : `Assign an owner to the ${count(unowned.length)} open issues nobody has acted on yet, starting with “${unowned[0].title}”.`,
    );
  }
  const rechecking = open.filter((issue) => issue.statusAt === "fixed_rechecking");
  if (rechecking.length === 1) {
    add(`Keep the fix for “${rechecking[0].title}” in place while TrueCite re-checks it; it moves to Resolved after two clean scans in a row.`);
  } else if (rechecking.length > 1) {
    add(
      `Keep the fixes for ${count(rechecking.length)} issues in place while TrueCite re-checks them; each moves to Resolved after two clean scans in a row.`,
    );
  }
  const memory = open.find((issue) => issue.origin === "memory");
  if (memory) {
    add(`“${memory.title}” comes from AI memory: strengthen official pages and trusted third-party profiles, and expect it to take longer to change.`);
  }
  add("Review the Fact Sheet so new prices, products and leadership changes are approved before the next scan.");
  if (steps.length < 3) add("Read the full answers behind each open issue on the Issues page, and mark anything that is not an error.");
  return steps.slice(0, 4);
}

/** "2026-09", the period key of a monthly report. */
export function monthKey(date: Date): string {
  return isoDay(date).slice(0, 7);
}
