import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import type { ClientContext } from "@/lib/auth/dal";
import {
  competitorSnapshots,
  competitors,
  getDb,
  issueEvents,
  issues,
  scans,
  scoreSnapshots,
  type Scan,
  type ScoreSnapshot,
} from "@/lib/db";
import {
  PLATFORM_IDS,
  PLATFORMS,
  QUESTION_CATEGORIES,
  QUESTION_CATEGORY_IDS,
  type IssueStatus,
  type PlatformId,
  type QuestionCategory,
  type ScanStatus,
  type ScanType,
  type Severity,
} from "@/lib/domain/constants";
import { scoreDelta } from "@/lib/domain/score";
import { compareSeverity } from "@/lib/domain/severity";

/*
  Everything the client dashboard shows, read in one place. Scores and
  breakdowns come from score snapshots (one per scan) and competitor snapshots;
  issue counts are live, so they match the Issues page. Only issues an admin
  approved and the client has not dismissed are counted.
*/

/** Scans that ask the whole Question Set. Re-checks, competitor and prospect scans are smaller. */
export const FULL_SCAN_TYPES = ["scheduled", "manual", "audit"] as const satisfies readonly ScanType[];

/** A scan in one of these states is still collecting or checking answers. */
export const ACTIVE_SCAN_STATUSES = ["queued", "running", "checking"] as const satisfies readonly ScanStatus[];

/** How many snapshots the trend shows. */
export const TREND_LENGTH = 12;

/** How many issues the "needs attention" table shows. */
export const ATTENTION_LIMIT = 6;

export type DashboardScan = Pick<
  Scan,
  | "id"
  | "type"
  | "status"
  | "platforms"
  | "runsPerQuestion"
  | "questionCount"
  | "jobsTotal"
  | "jobsDone"
  | "simulated"
  | "error"
  | "startedAt"
  | "finishedAt"
  | "createdAt"
>;

export type DashboardIssue = {
  number: number;
  title: string;
  severity: Severity;
  status: IssueStatus;
  platforms: PlatformId[];
  lastSeenAt: Date;
};

export type BreakdownRow<K extends string> = {
  key: K;
  label: string;
  score: number | null;
  checked: number;
  openIssues: number;
};

export type DashboardChange =
  | { kind: "new" | "reopened" | "resolved"; at: Date; issue: DashboardIssue }
  | { kind: "score"; at: Date; platform: PlatformId; from: number; to: number; delta: number };

export type CompetitorRow = {
  name: string;
  isClient: boolean;
  score: number | null;
  shareOfVoice: number | null;
};

export type DashboardData = {
  /** The full scan collecting or checking answers right now, if any. */
  activeScan: DashboardScan | null;
  /** The last full scan that finished. */
  lastScan: DashboardScan | null;
  /** The most recent full scan, when it stopped without finishing and nothing newer finished. */
  stoppedScan: DashboardScan | null;
  /** Oldest first, at most TREND_LENGTH. */
  trend: Pick<ScoreSnapshot, "takenAt" | "accuracyScore">[];
  current: ScoreSnapshot | null;
  previous: ScoreSnapshot | null;
  openBySeverity: Record<Severity, number>;
  openTotal: number;
  attention: DashboardIssue[];
  byPlatform: BreakdownRow<PlatformId>[];
  byCategory: BreakdownRow<QuestionCategory>[];
  /** Changes since the previous snapshot, newest first. */
  changes: DashboardChange[];
  /** The client first among equals, then competitors, most accurate first. Empty without competitors. */
  competitors: CompetitorRow[];
  /** When the newest competitor snapshot was taken. */
  competitorsCheckedAt: Date | null;
};

const scanFields = {
  id: scans.id,
  type: scans.type,
  status: scans.status,
  platforms: scans.platforms,
  runsPerQuestion: scans.runsPerQuestion,
  questionCount: scans.questionCount,
  jobsTotal: scans.jobsTotal,
  jobsDone: scans.jobsDone,
  simulated: scans.simulated,
  error: scans.error,
  startedAt: scans.startedAt,
  finishedAt: scans.finishedAt,
  createdAt: scans.createdAt,
};

/** Approved, not dismissed: the issues a client is allowed to see. */
function visibleIssues(brandId: string) {
  return and(eq(issues.brandId, brandId), eq(issues.reviewState, "approved"), isNull(issues.dismissedAt));
}

function byUrgency(a: DashboardIssue, b: DashboardIssue): number {
  return (
    compareSeverity(a.severity, b.severity) ||
    b.lastSeenAt.getTime() - a.lastSeenAt.getTime() ||
    a.number - b.number
  );
}

const CHANGE_ORDER: Record<DashboardChange["kind"], number> = { reopened: 0, new: 1, resolved: 2, score: 3 };

export async function getDashboard(ctx: ClientContext): Promise<DashboardData> {
  const db = await getDb();
  const brandId = ctx.brand.id;
  const fullScans = and(eq(scans.brandId, brandId), inArray(scans.type, [...FULL_SCAN_TYPES]));

  const [activeRows, lastRows, latestRows, snapshotRows, openRows, competitorList, competitorLatest] = await Promise.all([
    db
      .select(scanFields)
      .from(scans)
      .where(and(fullScans, inArray(scans.status, [...ACTIVE_SCAN_STATUSES])))
      .orderBy(desc(scans.createdAt))
      .limit(1),
    db
      .select(scanFields)
      .from(scans)
      .where(and(fullScans, eq(scans.status, "completed")))
      .orderBy(desc(scans.createdAt))
      .limit(1),
    db.select(scanFields).from(scans).where(fullScans).orderBy(desc(scans.createdAt)).limit(1),
    db
      .select()
      .from(scoreSnapshots)
      .where(eq(scoreSnapshots.brandId, brandId))
      .orderBy(desc(scoreSnapshots.takenAt))
      .limit(TREND_LENGTH),
    db
      .select({
        number: issues.number,
        title: issues.title,
        severity: issues.severity,
        status: issues.status,
        platforms: issues.platforms,
        category: issues.category,
        lastSeenAt: issues.lastSeenAt,
      })
      .from(issues)
      .where(and(visibleIssues(brandId), ne(issues.status, "resolved"))),
    db
      .select({ id: competitors.id, name: competitors.name })
      .from(competitors)
      .where(eq(competitors.brandId, brandId))
      .orderBy(asc(competitors.name)),
    db
      .selectDistinctOn([competitorSnapshots.competitorId], {
        competitorId: competitorSnapshots.competitorId,
        takenAt: competitorSnapshots.takenAt,
        accuracyScore: competitorSnapshots.accuracyScore,
        shareOfVoice: competitorSnapshots.shareOfVoice,
      })
      .from(competitorSnapshots)
      .where(eq(competitorSnapshots.brandId, brandId))
      .orderBy(competitorSnapshots.competitorId, desc(competitorSnapshots.takenAt)),
  ]);

  const activeScan = activeRows[0] ?? null;
  const lastScan = lastRows[0] ?? null;
  const latest = latestRows[0] ?? null;
  const stoppedScan =
    latest &&
    (latest.status === "failed" || latest.status === "cancelled") &&
    (!lastScan || latest.createdAt > lastScan.createdAt)
      ? latest
      : null;

  const current = snapshotRows[0] ?? null;
  const previous = snapshotRows[1] ?? null;
  const trend = [...snapshotRows].reverse().map((s) => ({ takenAt: s.takenAt, accuracyScore: s.accuracyScore }));

  /* Open issues, counted live. */
  const openBySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const openByPlatform = new Map<PlatformId, number>();
  const openByCategory = new Map<QuestionCategory, number>();
  const open: DashboardIssue[] = [];
  for (const row of openRows) {
    openBySeverity[row.severity] += 1;
    for (const platform of new Set(row.platforms)) openByPlatform.set(platform, (openByPlatform.get(platform) ?? 0) + 1);
    if (row.category) openByCategory.set(row.category, (openByCategory.get(row.category) ?? 0) + 1);
    open.push({
      number: row.number,
      title: row.title,
      severity: row.severity,
      status: row.status,
      platforms: PLATFORM_IDS.filter((id) => row.platforms.includes(id)),
      lastSeenAt: row.lastSeenAt,
    });
  }
  open.sort(byUrgency);

  /* Breakdowns from the latest snapshot, in the usual order of platforms and categories. */
  const platformKeys = PLATFORM_IDS.filter(
    (id) => ctx.brand.platforms.includes(id) || current?.byPlatform[id] !== undefined || openByPlatform.has(id),
  );
  const byPlatform: BreakdownRow<PlatformId>[] = platformKeys.map((id) => ({
    key: id,
    label: PLATFORMS[id].name,
    score: current?.byPlatform[id]?.score ?? null,
    checked: current?.byPlatform[id]?.checked ?? 0,
    openIssues: openByPlatform.get(id) ?? 0,
  }));

  const categoryKeys = QUESTION_CATEGORY_IDS.filter(
    (id) => current?.byCategory[id] !== undefined || openByCategory.has(id),
  );
  const byCategory: BreakdownRow<QuestionCategory>[] = categoryKeys.map((id) => ({
    key: id,
    label: QUESTION_CATEGORIES[id].label,
    score: current?.byCategory[id]?.score ?? null,
    checked: current?.byCategory[id]?.checked ?? 0,
    openIssues: openByCategory.get(id) ?? 0,
  }));

  /* What changed since the previous snapshot: issue events, then score movement per platform. */
  const changes: DashboardChange[] = [];
  if (current && previous) {
    const events = await db
      .select({
        kind: issueEvents.kind,
        createdAt: issueEvents.createdAt,
        number: issues.number,
        title: issues.title,
        severity: issues.severity,
        status: issues.status,
        platforms: issues.platforms,
        lastSeenAt: issues.lastSeenAt,
      })
      .from(issueEvents)
      .innerJoin(issues, eq(issues.id, issueEvents.issueId))
      .where(
        and(
          visibleIssues(brandId),
          gt(issueEvents.createdAt, previous.takenAt),
          inArray(issueEvents.kind, ["detected", "approved", "reopened", "resolved"]),
        ),
      )
      .orderBy(desc(issueEvents.createdAt));

    // One entry per issue and kind. A new issue is dated by when it reached the client: its approval.
    const seen = new Map<string, DashboardChange>();
    for (const event of events) {
      const kind = event.kind === "detected" || event.kind === "approved" ? "new" : event.kind;
      if (kind !== "new" && kind !== "reopened" && kind !== "resolved") continue;
      const key = `${event.number}:${kind}`;
      const existing = seen.get(key);
      if (existing && !(kind === "new" && event.kind === "approved")) continue;
      seen.set(key, {
        kind,
        at: event.createdAt,
        issue: {
          number: event.number,
          title: event.title,
          severity: event.severity,
          status: event.status,
          platforms: PLATFORM_IDS.filter((id) => event.platforms.includes(id)),
          lastSeenAt: event.lastSeenAt,
        },
      });
    }
    changes.push(...seen.values());

    for (const id of PLATFORM_IDS) {
      const now = current.byPlatform[id]?.score;
      const before = previous.byPlatform[id]?.score;
      const delta = scoreDelta(now, before);
      if (delta === null || delta === 0 || now === null || now === undefined || before === null || before === undefined) continue;
      changes.push({ kind: "score", at: current.takenAt, platform: id, from: before, to: now, delta });
    }

    // A dated log: newest first; on the same moment, reopened before new before resolved before scores.
    changes.sort((a, b) => {
      const byDate = b.at.getTime() - a.at.getTime();
      if (byDate !== 0) return byDate;
      const order = CHANGE_ORDER[a.kind] - CHANGE_ORDER[b.kind];
      if (order !== 0) return order;
      if (a.kind !== "score" && b.kind !== "score") return compareSeverity(a.issue.severity, b.issue.severity);
      return 0;
    });
  }

  /* The client next to its competitors, most accurate first. Competitor scores are estimates. */
  const latestByCompetitor = new Map(competitorLatest.map((row) => [row.competitorId, row]));
  const competitorRows: CompetitorRow[] = competitorList.length
    ? [
        {
          name: ctx.brand.name,
          isClient: true,
          score: current?.accuracyScore ?? null,
          shareOfVoice: current?.shareOfVoice ?? null,
        },
        ...competitorList.map((competitor) => ({
          name: competitor.name,
          isClient: false,
          score: latestByCompetitor.get(competitor.id)?.accuracyScore ?? null,
          shareOfVoice: latestByCompetitor.get(competitor.id)?.shareOfVoice ?? null,
        })),
      ].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    : [];
  const competitorsCheckedAt = competitorLatest.reduce<Date | null>(
    (latestAt, row) => (!latestAt || row.takenAt > latestAt ? row.takenAt : latestAt),
    null,
  );

  return {
    activeScan,
    lastScan,
    stoppedScan,
    trend,
    current,
    previous,
    openBySeverity,
    openTotal: open.length,
    attention: open.slice(0, ATTENTION_LIMIT),
    byPlatform,
    byCategory,
    changes,
    competitors: competitorRows,
    competitorsCheckedAt,
  };
}

/** True when a full scan for the brand is still collecting or checking answers. */
export async function hasActiveScan(brandId: string): Promise<boolean> {
  const db = await getDb();
  const [row] = await db
    .select({ id: scans.id })
    .from(scans)
    .where(
      and(
        eq(scans.brandId, brandId),
        inArray(scans.type, [...FULL_SCAN_TYPES]),
        inArray(scans.status, [...ACTIVE_SCAN_STATUSES]),
      ),
    )
    .limit(1);
  return Boolean(row);
}
