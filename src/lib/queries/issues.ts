import "server-only";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { ClientContext } from "@/lib/auth/dal";
import {
  answers,
  citations,
  facts,
  getDb,
  issueEvents,
  issues,
  memberships,
  questions,
  sources,
  statements,
  users,
  type Answer,
  type Issue,
  type IssueEvent,
  type Source,
} from "@/lib/db";
import {
  ISSUE_STATUSES,
  PLATFORM_IDS,
  QUESTION_CATEGORY_IDS,
  SEVERITY_ORDER,
  SOURCE_LIKELIHOOD,
  VERDICTS,
  type IssueStatus,
  type PlatformId,
  type QuestionCategory,
  type Role,
  type Severity,
  type Verdict,
} from "@/lib/domain/constants";
import { compareSeverity } from "@/lib/domain/severity";

/*
  Reads for the Issues pages. A client only ever sees issues an admin approved;
  issues the team marked "Not an error" move to their own read-only list.
*/

/* ------------------------------------------------------------------ */
/* The list                                                            */
/* ------------------------------------------------------------------ */

export const STATUS_GROUPS = {
  open: { label: "Open", statuses: ["open", "reopened"] },
  in_progress: { label: "In progress", statuses: ["in_progress"] },
  fixed: { label: "Fixed, re-checking", statuses: ["fixed_rechecking"] },
  resolved: { label: "Resolved", statuses: ["resolved"] },
  all: { label: "All", statuses: ["open", "reopened", "in_progress", "fixed_rechecking", "resolved"] },
} as const satisfies Record<string, { label: string; statuses: readonly IssueStatus[] }>;

export type StatusGroup = keyof typeof STATUS_GROUPS;
export const STATUS_GROUP_IDS = Object.keys(STATUS_GROUPS) as StatusGroup[];

export type IssueFilters = {
  status: StatusGroup;
  severity: Severity | null;
  platform: PlatformId | null;
  category: QuestionCategory | null;
};

function pick<T extends string>(value: string | string[] | undefined, allowed: readonly T[]): T | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

/** Reads the list filters from the URL, ignoring anything that is not a known value. */
export function parseIssueFilters(params: Record<string, string | string[] | undefined>): IssueFilters {
  return {
    status: pick(params.status, STATUS_GROUP_IDS) ?? "all",
    severity: pick(params.severity, SEVERITY_ORDER),
    platform: pick(params.platform, PLATFORM_IDS),
    category: pick(params.category, QUESTION_CATEGORY_IDS),
  };
}

/** A list URL with the given filters; the defaults are left out so links stay short. */
export function issuesHref(filters: Partial<IssueFilters>): string {
  const query = new URLSearchParams();
  if (filters.status && filters.status !== "all") query.set("status", filters.status);
  if (filters.severity) query.set("severity", filters.severity);
  if (filters.platform) query.set("platform", filters.platform);
  if (filters.category) query.set("category", filters.category);
  const text = query.toString();
  return text ? `/app/issues?${text}` : "/app/issues";
}

export type IssueListRow = {
  number: number;
  title: string;
  severity: Severity;
  status: IssueStatus;
  platforms: PlatformId[];
  category: QuestionCategory | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  assigneeName: string | null;
};

export type IssueList = {
  rows: IssueListRow[];
  /** Per status group, with the severity, platform and category filters applied. */
  counts: Record<StatusGroup, number>;
  /** Every issue the client can see, before any filter. */
  visibleTotal: number;
  dismissedCount: number;
};

function orderPlatforms(platforms: readonly PlatformId[]): PlatformId[] {
  return PLATFORM_IDS.filter((id) => platforms.includes(id));
}

/** Most severe first, then most recently seen. In the full list, resolved issues come last. */
function byUrgency(a: IssueListRow, b: IssueListRow): number {
  const resolved = Number(a.status === "resolved") - Number(b.status === "resolved");
  return (
    resolved ||
    compareSeverity(a.severity, b.severity) ||
    b.lastSeenAt.getTime() - a.lastSeenAt.getTime() ||
    a.number - b.number
  );
}

export async function listIssues(ctx: ClientContext, filters: IssueFilters): Promise<IssueList> {
  const db = await getDb();
  const [rows, [dismissed]] = await Promise.all([
    db
      .select({
        number: issues.number,
        title: issues.title,
        severity: issues.severity,
        status: issues.status,
        platforms: issues.platforms,
        category: issues.category,
        firstSeenAt: issues.firstSeenAt,
        lastSeenAt: issues.lastSeenAt,
        assigneeName: users.name,
      })
      .from(issues)
      .leftJoin(users, eq(users.id, issues.assigneeId))
      .where(and(eq(issues.brandId, ctx.brand.id), eq(issues.reviewState, "approved"), isNull(issues.dismissedAt))),
    db
      .select({ value: count() })
      .from(issues)
      .where(and(eq(issues.brandId, ctx.brand.id), eq(issues.reviewState, "approved"), isNotNull(issues.dismissedAt))),
  ]);

  const matching = rows
    .map((row) => ({ ...row, platforms: orderPlatforms(row.platforms) }))
    .filter(
      (row) =>
        (!filters.severity || row.severity === filters.severity) &&
        (!filters.platform || row.platforms.includes(filters.platform)) &&
        (!filters.category || row.category === filters.category),
    );

  const counts = Object.fromEntries(
    STATUS_GROUP_IDS.map((group) => [
      group,
      matching.filter((row) => (STATUS_GROUPS[group].statuses as readonly IssueStatus[]).includes(row.status)).length,
    ]),
  ) as Record<StatusGroup, number>;

  const statuses = STATUS_GROUPS[filters.status].statuses as readonly IssueStatus[];
  return {
    rows: matching.filter((row) => statuses.includes(row.status)).sort(byUrgency),
    counts,
    visibleTotal: rows.length,
    dismissedCount: dismissed?.value ?? 0,
  };
}

export type DismissedIssueRow = {
  number: number;
  title: string;
  severity: Severity;
  platforms: PlatformId[];
  dismissedAt: Date;
  dismissedByName: string;
  dismissNote: string | null;
};

/** Issues the team marked "Not an error", most recent first. */
export async function listDismissedIssues(ctx: ClientContext): Promise<DismissedIssueRow[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: issues.id,
      number: issues.number,
      title: issues.title,
      severity: issues.severity,
      platforms: issues.platforms,
      dismissedAt: issues.dismissedAt,
      dismissNote: issues.dismissNote,
      dismissedByName: users.name,
    })
    .from(issues)
    .leftJoin(users, eq(users.id, issues.dismissedBy))
    .where(and(eq(issues.brandId, ctx.brand.id), eq(issues.reviewState, "approved"), isNotNull(issues.dismissedAt)))
    .orderBy(desc(issues.dismissedAt));

  // The evidence trail keeps the name even when the person has since left the team.
  const missingNames = rows.filter((row) => !row.dismissedByName).map((row) => row.id);
  const trailNames = new Map<string, string>();
  if (missingNames.length > 0) {
    const events = await db
      .select({ issueId: issueEvents.issueId, actorName: issueEvents.actorName })
      .from(issueEvents)
      .where(and(inArray(issueEvents.issueId, missingNames), eq(issueEvents.kind, "not_an_error")))
      .orderBy(desc(issueEvents.createdAt));
    for (const event of events) if (!trailNames.has(event.issueId)) trailNames.set(event.issueId, event.actorName);
  }

  return rows.map((row) => ({
    number: row.number,
    title: row.title,
    severity: row.severity,
    platforms: orderPlatforms(row.platforms),
    dismissedAt: row.dismissedAt as Date,
    dismissedByName: row.dismissedByName ?? trailNames.get(row.id) ?? "A former team member",
    dismissNote: row.dismissNote,
  }));
}

/** For the notice after "Not an error": the issue that was just dismissed. */
export async function getDismissedIssueTitle(ctx: ClientContext, number: number): Promise<string | null> {
  const db = await getDb();
  const [row] = await db
    .select({ title: issues.title })
    .from(issues)
    .where(and(eq(issues.brandId, ctx.brand.id), eq(issues.number, number), isNotNull(issues.dismissedAt)))
    .limit(1);
  return row?.title ?? null;
}

/* ------------------------------------------------------------------ */
/* One issue                                                           */
/* ------------------------------------------------------------------ */

/** The issue with this number, if the client may see it: approved by review, possibly dismissed. */
export async function findVisibleIssue(ctx: ClientContext, number: number): Promise<Issue | null> {
  if (!Number.isInteger(number) || number < 1) return null;
  const db = await getDb();
  const [issue] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.brandId, ctx.brand.id), eq(issues.number, number), eq(issues.reviewState, "approved")))
    .limit(1);
  return issue ?? null;
}

export type PlatformSighting = {
  platform: PlatformId;
  /** Runs in the latest scan that saw the error on this platform, or null when no answer is stored. */
  runsSeen: number | null;
  runsTotal: number | null;
  seenAt: Date | null;
  /** The latest answer on this platform that carries the issue's statement. */
  answerId: string | null;
  /** When no stored answer carries the error: the date of the latest answer to the question on this platform. */
  cleanAt: Date | null;
};

export type ProofMark = {
  start: number;
  end: number;
  kind: "wrong" | "other-wrong" | "review";
  label: string;
  href?: string;
};

export type ProofSource = {
  n: number;
  url: string;
  title: string | null;
  /** Null for a page the answer cited that TrueCite has not traced yet. */
  source: Source | null;
  cited: boolean;
};

export type IssueAnswer = Pick<Answer, "id" | "text" | "model" | "runNumber" | "createdAt" | "settings" | "simulated">;

export type IssueMember = { id: string; name: string; role: Role };

export type IssueDetail = {
  issue: Issue;
  question: { text: string } | null;
  fact: { statement: string; validFrom: string | null; validTo: string | null } | null;
  assigneeName: string | null;
  dismissedByName: string | null;
  sightings: PlatformSighting[];
  current: PlatformSighting | null;
  answer: IssueAnswer | null;
  marks: ProofMark[];
  /** Footnote numbers for the answer, matching `sources`. */
  footnotes: number[];
  sources: ProofSource[];
  events: IssueEvent[];
  members: IssueMember[];
};

const ERROR_VERDICT_SET = new Set<Verdict>(["incorrect", "outdated", "confused"]);

const LIKELIHOOD_ORDER = Object.keys(SOURCE_LIKELIHOOD);

/** Comparable form of a URL: no scheme, no www, no trailing slash, no fragment. */
function urlKey(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.hostname.replace(/^www\./, "").toLowerCase()}${path}${parsed.search}`;
  } catch {
    return url.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  }
}

/** Where a statement sits in the answer: the stored offsets, or the first place the text appears. */
function spanOf(text: string, statement: { text: string; spanStart: number | null; spanEnd: number | null }) {
  const { spanStart, spanEnd } = statement;
  if (spanStart !== null && spanEnd !== null && spanStart >= 0 && spanEnd > spanStart && spanEnd <= text.length) {
    return { start: spanStart, end: spanEnd };
  }
  const index = statement.text ? text.indexOf(statement.text) : -1;
  return index >= 0 ? { start: index, end: index + statement.text.length } : null;
}

export async function getIssueDetail(
  ctx: ClientContext,
  issue: Issue,
  requestedPlatform: string | null,
): Promise<IssueDetail> {
  const db = await getDb();
  const personIds = [issue.assigneeId, issue.dismissedBy].filter((id): id is string => Boolean(id));

  const [questionRows, factRows, sourceRows, events, memberRows, occurrences, people] = await Promise.all([
    issue.questionId
      ? db.select({ text: questions.text }).from(questions).where(and(eq(questions.id, issue.questionId), eq(questions.brandId, ctx.brand.id))).limit(1)
      : Promise.resolve([]),
    issue.factId
      ? db
          .select({ statement: facts.statement, validFrom: facts.validFrom, validTo: facts.validTo })
          .from(facts)
          .where(and(eq(facts.id, issue.factId), eq(facts.brandId, ctx.brand.id)))
          .limit(1)
      : Promise.resolve([]),
    db.select().from(sources).where(eq(sources.issueId, issue.id)),
    db.select().from(issueEvents).where(eq(issueEvents.issueId, issue.id)).orderBy(asc(issueEvents.createdAt), asc(issueEvents.id)),
    db
      .select({ id: users.id, name: users.name, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, ctx.organization.id))
      .orderBy(asc(users.name)),
    db
      .select({
        answerId: answers.id,
        platform: answers.platform,
        scanId: answers.scanId,
        questionId: answers.questionId,
        createdAt: answers.createdAt,
      })
      .from(statements)
      .innerJoin(answers, eq(answers.id, statements.answerId))
      .where(and(eq(statements.issueId, issue.id), eq(answers.brandId, ctx.brand.id)))
      .orderBy(desc(answers.createdAt)),
    personIds.length
      ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, personIds))
      : Promise.resolve([]),
  ]);

  const nameOf = (id: string | null) => (id ? (people.find((person) => person.id === id)?.name ?? null) : null);

  /* Where the error was seen: one entry per platform, from the latest scan that saw it there. */
  const platformIds = orderPlatforms([...new Set([...issue.platforms, ...occurrences.map((o) => o.platform)])]);
  const sightings: PlatformSighting[] = await Promise.all(
    platformIds.map(async (platform) => {
      // Prefer answers to the issue's own question; the same error can turn up in answers to related questions.
      const latest =
        occurrences.find((o) => o.platform === platform && o.questionId === issue.questionId) ??
        occurrences.find((o) => o.platform === platform);
      if (!latest) {
        // No stored answer carries the error here: say whether the latest answer to the question was clean.
        const [clean] = issue.questionId
          ? await db
              .select({ createdAt: answers.createdAt })
              .from(answers)
              .where(and(eq(answers.brandId, ctx.brand.id), eq(answers.platform, platform), eq(answers.questionId, issue.questionId)))
              .orderBy(desc(answers.createdAt))
              .limit(1)
          : [];
        return { platform, runsSeen: null, runsTotal: null, seenAt: null, answerId: null, cleanAt: clean?.createdAt ?? null };
      }
      const sameScan = occurrences.filter(
        (o) => o.platform === platform && o.scanId === latest.scanId && o.questionId === latest.questionId,
      );
      const [{ value: runsTotal }] = await db
        .select({ value: count() })
        .from(answers)
        .where(and(eq(answers.scanId, latest.scanId), eq(answers.platform, platform), eq(answers.questionId, latest.questionId)));
      const runsSeen = new Set(sameScan.map((o) => o.answerId)).size;
      return {
        platform,
        runsSeen,
        runsTotal: Math.max(runsTotal, runsSeen),
        seenAt: latest.createdAt,
        answerId: latest.answerId,
        cleanAt: null,
      };
    }),
  );

  const withAnswers = sightings.filter((s) => s.answerId);
  // An error from AI memory is clearest in an answer that cites nothing, so that one is shown first.
  const citedAnswerIds = new Set<string>();
  if (issue.origin === "memory" && withAnswers.length > 1) {
    const cited = await db
      .selectDistinct({ answerId: citations.answerId })
      .from(citations)
      .where(inArray(citations.answerId, withAnswers.map((s) => s.answerId as string)));
    for (const row of cited) citedAnswerIds.add(row.answerId);
  }
  const current =
    sightings.find((s) => s.platform === requestedPlatform && s.answerId) ??
    sightings.find((s) => s.platform === requestedPlatform) ??
    withAnswers.find((s) => !citedAnswerIds.has(s.answerId as string)) ??
    withAnswers[0] ??
    sightings[0] ??
    null;

  /* The answer itself, with every statement the checker found in it and the pages it cited. */
  let answer: IssueAnswer | null = null;
  const marks: ProofMark[] = [];
  let citationRows: { url: string; title: string | null; position: number }[] = [];
  if (current?.answerId) {
    const [answerRows, answerStatements, answerCitations] = await Promise.all([
      db
        .select({
          id: answers.id,
          text: answers.text,
          model: answers.model,
          runNumber: answers.runNumber,
          createdAt: answers.createdAt,
          settings: answers.settings,
          simulated: answers.simulated,
        })
        .from(answers)
        .where(and(eq(answers.id, current.answerId), eq(answers.brandId, ctx.brand.id)))
        .limit(1),
      db.select().from(statements).where(eq(statements.answerId, current.answerId)),
      db
        .select({ url: citations.url, title: citations.title, position: citations.position })
        .from(citations)
        .where(eq(citations.answerId, current.answerId))
        .orderBy(asc(citations.position)),
    ]);
    answer = answerRows[0] ?? null;
    citationRows = answerCitations;

    if (answer) {
      const otherIssueIds = [
        ...new Set(answerStatements.map((s) => s.issueId).filter((id): id is string => Boolean(id) && id !== issue.id)),
      ];
      const otherIssues = otherIssueIds.length
        ? await db
            .select({ id: issues.id, number: issues.number, reviewState: issues.reviewState, dismissedAt: issues.dismissedAt })
            .from(issues)
            .where(and(inArray(issues.id, otherIssueIds), eq(issues.brandId, ctx.brand.id)))
        : [];
      const otherById = new Map(otherIssues.map((other) => [other.id, other]));

      for (const statement of answerStatements) {
        const span = spanOf(answer.text, statement);
        if (!span) continue;
        if (statement.issueId === issue.id) {
          marks.push({ ...span, kind: "wrong", label: VERDICTS[issue.verdict].label });
          continue;
        }
        const other = statement.issueId ? otherById.get(statement.issueId) : undefined;
        if (other && ERROR_VERDICT_SET.has(statement.verdict)) {
          // Only issues the client can see are linked; unreviewed findings stay unmarked.
          if (other.reviewState === "approved" && !other.dismissedAt) {
            marks.push({ ...span, kind: "other-wrong", label: VERDICTS[statement.verdict].label, href: `/app/issues/${other.number}` });
          }
          continue;
        }
        if (statement.verdict === "unsupported") {
          marks.push({ ...span, kind: "review", label: "Unsupported, not on the Fact Sheet" });
        } else if (statement.intermittent && statement.verdict !== "correct") {
          marks.push({ ...span, kind: "review", label: `${VERDICTS[statement.verdict].label}, seen in only one run` });
        }
      }
      marks.sort((a, b) => a.start - b.start);
    }
  }

  /* Sources: the pages this answer cited first, in citation order, then the other traced pages. */
  const proofSources: ProofSource[] = [];
  const usedSources = new Set<string>();
  const sourceByKey = new Map(sourceRows.map((source) => [urlKey(source.url), source]));
  const footnotes: number[] = [];
  for (const citation of citationRows) {
    const key = urlKey(citation.url);
    const existing = proofSources.find((item) => urlKey(item.url) === key);
    if (existing) continue;
    const source = sourceByKey.get(key) ?? null;
    if (source) usedSources.add(source.id);
    const n = proofSources.length + 1;
    proofSources.push({ n, url: source?.url ?? citation.url, title: source?.title ?? citation.title, source, cited: true });
    footnotes.push(n);
  }
  const rest = sourceRows
    .filter((source) => !usedSources.has(source.id))
    .sort(
      (a, b) =>
        LIKELIHOOD_ORDER.indexOf(a.likelihood) - LIKELIHOOD_ORDER.indexOf(b.likelihood) ||
        Number(b.containsStatement) - Number(a.containsStatement) ||
        a.domain.localeCompare(b.domain),
    );
  for (const source of rest) {
    proofSources.push({ n: proofSources.length + 1, url: source.url, title: source.title, source, cited: false });
  }

  return {
    issue,
    question: questionRows[0] ?? null,
    fact: factRows[0] ?? null,
    assigneeName: nameOf(issue.assigneeId),
    dismissedByName:
      nameOf(issue.dismissedBy) ??
      (issue.dismissedAt ? ([...events].reverse().find((event) => event.kind === "not_an_error")?.actorName ?? null) : null),
    sightings,
    current,
    answer,
    marks,
    footnotes,
    sources: proofSources,
    events,
    members: memberRows,
  };
}

/** People who can be assigned an issue: owners and members of the organization. */
export function assignableMembers(members: IssueMember[], currentAssigneeId: string | null): IssueMember[] {
  return members.filter((member) => member.role !== "viewer" || member.id === currentAssigneeId);
}

export function statusLabel(status: IssueStatus): string {
  return ISSUE_STATUSES[status].label;
}
