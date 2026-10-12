import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, notInArray, or, sql } from "drizzle-orm";
import {
  answers,
  auditLog,
  brands,
  citations,
  competitors,
  facts,
  getDb,
  invoices,
  issueEvents,
  issues,
  memberships,
  organizations,
  questions,
  scanJobs,
  scans,
  scoreSnapshots,
  sources,
  statements,
  subscriptions,
  usageCosts,
  users,
  type Brand,
  type Invoice,
  type Organization,
  type Subscription,
} from "@/lib/db";
import {
  MARGIN_LIMIT,
  ONBOARDING_STEPS,
  SCAN_FREQUENCIES,
  type Currency,
  type ErrorVerdict,
  type JobStatus,
  type PlatformId,
  type ReviewState,
  type ScanStatus,
  type ScanType,
  type Severity,
  type Verdict,
} from "@/lib/domain/constants";
import { marginCheck, toUsd } from "@/lib/domain/costs";
import { formatDate, formatPercent, plural } from "@/lib/domain/format";

/*
  Reads for the internal admin panel: clients and their health, the issue
  review queue, and scans with their jobs. Admin pages call requireAdmin()
  before any of these; nothing here is scoped to one client on purpose.
*/

/* Shared rules */

/** Scans that ask the whole Question Set. Re-checks, competitor and prospect scans are smaller. */
export const FULL_SCAN_TYPES = ["scheduled", "manual", "audit"] as const satisfies readonly ScanType[];

/** A scan in one of these states is still collecting or checking answers. */
export const ACTIVE_SCAN_STATUSES = ["queued", "running", "checking"] as const satisfies readonly ScanStatus[];

/** Checker verdicts below this confidence are flagged for a closer look. */
export const LOW_CONFIDENCE_BELOW = 0.8;

/** Statements that contradict the Fact Sheet. */
const WRONG_VERDICTS = ["incorrect", "outdated", "confused", "missing"] as const satisfies readonly ErrorVerdict[];

const DAY_MS = 86_400_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** YYYY-MM-DD for a date `days` before `now`, matching usage_costs.day. */
function dayKey(now: Date, daysBack: number): string {
  return new Date(now.getTime() - daysBack * DAY_MS).toISOString().slice(0, 10);
}

/** "under a minute", "12 min", "1 h 5 min" */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "–";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function scanDuration(scan: { startedAt: Date | null; finishedAt: Date | null }, now: Date): number | null {
  if (!scan.startedAt) return null;
  return (scan.finishedAt ?? now).getTime() - scan.startedAt.getTime();
}

/* Revenue and the margin rule */

/** What a subscription brings in per month, in its own currency. Trials and cancelled plans bring in nothing. */
export function monthlyRevenue(subscription: Pick<Subscription, "status" | "amount" | "interval"> | null): number {
  if (!subscription) return 0;
  if (subscription.status === "trialing" || subscription.status === "cancelled") return 0;
  return subscription.interval === "year" ? subscription.amount / 12 : subscription.amount;
}

export type Margin = {
  /** API cost as a share of revenue; null when the client pays nothing yet. */
  share: number | null;
  overLimit: boolean;
};

function marginFor(apiCostUsd: number, revenueUsd: number): Margin {
  if (revenueUsd <= 0) return { share: null, overLimit: false };
  const check = marginCheck(apiCostUsd, revenueUsd);
  return { share: check.share, overLimit: !check.withinRule };
}

/* Clients */

export type Health = { healthy: boolean; reasons: string[] };

export type ScanSummary = {
  id: string;
  type: ScanType;
  status: ScanStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  failedJobs: number;
};

export type ClientRow = {
  id: string;
  name: string;
  plan: Organization["plan"];
  country: Organization["country"];
  createdAt: Date;
  subscription: Subscription | null;
  revenue: number;
  revenueCurrency: Currency;
  revenueUsd: number;
  apiCost30: number;
  margin: Margin;
  score: number | null;
  scoreAt: Date | null;
  openIssues: number;
  pendingReview: number;
  lastScan: ScanSummary | null;
  lastCompletedAt: Date | null;
  brands: Brand[];
  health: Health;
};

function healthFor(row: Omit<ClientRow, "health">, now: Date): Health {
  const reasons: string[] = [];
  const status = row.subscription?.status;
  const brand = row.brands[0];

  if (status === "past_due") reasons.push("Payment overdue");
  if (status === "cancelled") reasons.push("Subscription cancelled");
  if (row.margin.overLimit) {
    reasons.push(`API cost is ${formatPercent(row.margin.share)} of revenue, over ${formatPercent(MARGIN_LIMIT)}`);
  }
  if (brand && brand.onboardingStep !== "done") {
    reasons.push(`Onboarding stopped at ${ONBOARDING_STEPS[brand.onboardingStep].label}`);
  }
  if (row.lastScan?.status === "failed") reasons.push("Latest scan failed");
  else if (row.lastScan && row.lastScan.failedJobs > 0) {
    reasons.push(`${plural(row.lastScan.failedJobs, "failed job")} in the latest scan`);
  }

  // A scheduled client should see a finished scan at least every two scan intervals.
  if (brand && brand.onboardingStep === "done") {
    const perMonth = SCAN_FREQUENCIES[brand.scanFrequency].perMonth;
    if (perMonth > 0) {
      const allowedDays = Math.ceil((30 / perMonth) * 2);
      if (!row.lastCompletedAt) reasons.push("No finished scan yet");
      else if (now.getTime() - row.lastCompletedAt.getTime() > allowedDays * DAY_MS) {
        reasons.push(`No finished scan since ${formatDate(row.lastCompletedAt)}`);
      }
    }
  }

  return { healthy: reasons.length === 0, reasons };
}

async function buildClientRows(orgs: Organization[], now: Date): Promise<ClientRow[]> {
  if (orgs.length === 0) return [];
  const db = await getDb();
  const orgIds = orgs.map((o) => o.id);
  const cutoff = dayKey(now, 30);

  const [subs, brandRows, costRows] = await Promise.all([
    db
      .selectDistinctOn([subscriptions.organizationId])
      .from(subscriptions)
      .where(inArray(subscriptions.organizationId, orgIds))
      .orderBy(subscriptions.organizationId, desc(subscriptions.createdAt)),
    db.select().from(brands).where(inArray(brands.organizationId, orgIds)).orderBy(asc(brands.createdAt)),
    db
      .select({
        organizationId: usageCosts.organizationId,
        total: sql<number>`coalesce(sum(${usageCosts.costUsd}), 0)`.mapWith(Number),
      })
      .from(usageCosts)
      .where(and(inArray(usageCosts.organizationId, orgIds), gte(usageCosts.day, cutoff)))
      .groupBy(usageCosts.organizationId),
  ]);

  const brandIds = brandRows.map((b) => b.id);
  const [issueCounts, snapshotRows, latestScanRows, completedRows] = brandIds.length
    ? await Promise.all([
        db
          .select({
            brandId: issues.brandId,
            open: sql<number>`count(*) filter (where ${issues.reviewState} = 'approved' and ${issues.dismissedAt} is null and ${issues.status} <> 'resolved')`.mapWith(
              Number,
            ),
            pending: sql<number>`count(*) filter (where ${issues.reviewState} = 'pending')`.mapWith(Number),
          })
          .from(issues)
          .where(inArray(issues.brandId, brandIds))
          .groupBy(issues.brandId),
        db
          .selectDistinctOn([scoreSnapshots.brandId], {
            brandId: scoreSnapshots.brandId,
            accuracyScore: scoreSnapshots.accuracyScore,
            takenAt: scoreSnapshots.takenAt,
          })
          .from(scoreSnapshots)
          .where(inArray(scoreSnapshots.brandId, brandIds))
          .orderBy(scoreSnapshots.brandId, desc(scoreSnapshots.takenAt)),
        db
          .selectDistinctOn([scans.brandId], {
            brandId: scans.brandId,
            id: scans.id,
            type: scans.type,
            status: scans.status,
            startedAt: scans.startedAt,
            finishedAt: scans.finishedAt,
            createdAt: scans.createdAt,
            jobsFailed: scans.jobsFailed,
          })
          .from(scans)
          .where(and(inArray(scans.brandId, brandIds), inArray(scans.type, [...FULL_SCAN_TYPES])))
          .orderBy(scans.brandId, desc(scans.createdAt)),
        db
          .selectDistinctOn([scans.brandId], { brandId: scans.brandId, finishedAt: scans.finishedAt })
          .from(scans)
          .where(
            and(
              inArray(scans.brandId, brandIds),
              inArray(scans.type, [...FULL_SCAN_TYPES]),
              eq(scans.status, "completed"),
              isNotNull(scans.finishedAt),
            ),
          )
          .orderBy(scans.brandId, desc(scans.finishedAt)),
      ])
    : [[], [], [], []];

  const failedByScan = await failedJobCounts(latestScanRows.map((s) => ({ id: s.id, jobsFailed: s.jobsFailed })));

  const subByOrg = new Map(subs.map((s) => [s.organizationId, s]));
  const costByOrg = new Map(costRows.map((c) => [c.organizationId, c.total]));
  const issuesByBrand = new Map(issueCounts.map((c) => [c.brandId, c]));
  const snapshotByBrand = new Map(snapshotRows.map((s) => [s.brandId, s]));
  const latestByBrand = new Map(latestScanRows.map((s) => [s.brandId, s]));
  const completedByBrand = new Map(completedRows.map((s) => [s.brandId, s.finishedAt]));

  return orgs.map((org) => {
    const orgBrands = brandRows.filter((b) => b.organizationId === org.id);
    const subscription = subByOrg.get(org.id) ?? null;
    const revenue = monthlyRevenue(subscription);
    const revenueCurrency = subscription?.currency ?? org.currency;
    const revenueUsd = toUsd(revenue, revenueCurrency);
    const apiCost30 = costByOrg.get(org.id) ?? 0;

    let openIssues = 0;
    let pendingReview = 0;
    let lastScan: ScanSummary | null = null;
    let lastCompletedAt: Date | null = null;
    for (const brand of orgBrands) {
      const counts = issuesByBrand.get(brand.id);
      openIssues += counts?.open ?? 0;
      pendingReview += counts?.pending ?? 0;
      const latest = latestByBrand.get(brand.id);
      if (latest && (!lastScan || latest.createdAt > lastScan.createdAt)) {
        lastScan = {
          id: latest.id,
          type: latest.type,
          status: latest.status,
          startedAt: latest.startedAt,
          finishedAt: latest.finishedAt,
          createdAt: latest.createdAt,
          failedJobs: failedByScan.get(latest.id) ?? 0,
        };
      }
      const completed = completedByBrand.get(brand.id) ?? null;
      if (completed && (!lastCompletedAt || completed > lastCompletedAt)) lastCompletedAt = completed;
    }
    const firstBrand = orgBrands[0];
    const snapshot = firstBrand ? snapshotByBrand.get(firstBrand.id) : undefined;

    const row: Omit<ClientRow, "health"> = {
      id: org.id,
      name: org.name,
      plan: org.plan,
      country: org.country,
      createdAt: org.createdAt,
      subscription,
      revenue,
      revenueCurrency,
      revenueUsd,
      apiCost30,
      margin: marginFor(apiCost30, revenueUsd),
      score: snapshot?.accuracyScore ?? null,
      scoreAt: snapshot?.takenAt ?? null,
      openIssues,
      pendingReview,
      lastScan,
      lastCompletedAt,
      brands: orgBrands,
    };
    return { ...row, health: healthFor(row, now) };
  });
}

/** Failed jobs per scan, counted live from scan_jobs; falls back to the scan's own counter when it has no job rows. */
async function failedJobCounts(scanRows: { id: string; jobsFailed: number }[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (scanRows.length === 0) return result;
  const db = await getDb();
  const rows = await db
    .select({
      scanId: scanJobs.scanId,
      total: sql<number>`count(*)`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${scanJobs.status} = 'failed')`.mapWith(Number),
    })
    .from(scanJobs)
    .where(
      inArray(
        scanJobs.scanId,
        scanRows.map((s) => s.id),
      ),
    )
    .groupBy(scanJobs.scanId);
  const live = new Map(rows.map((r) => [r.scanId, r]));
  for (const scan of scanRows) {
    const counted = live.get(scan.id);
    result.set(scan.id, counted && counted.total > 0 ? counted.failed : scan.jobsFailed);
  }
  return result;
}

/** Every client account (internal accounts excluded), accounts that need attention first. */
export async function getClients(now: Date): Promise<ClientRow[]> {
  const db = await getDb();
  const orgs = await db.select().from(organizations).where(eq(organizations.internal, false)).orderBy(asc(organizations.name));
  const rows = await buildClientRows(orgs, now);
  return rows.sort(
    (a, b) =>
      Number(a.health.healthy) - Number(b.health.healthy) || b.revenueUsd - a.revenueUsd || a.name.localeCompare(b.name),
  );
}

export type ClientMember = {
  id: string;
  name: string;
  email: string;
  title: string | null;
  role: (typeof memberships.$inferSelect)["role"];
  lastLoginAt: Date | null;
  twoFactorEnabled: boolean;
  joinedAt: Date;
};

export type BrandSetup = {
  brand: Brand;
  activeQuestions: number;
  keyQuestions: number;
  approvedFacts: number;
  draftFacts: number;
  competitors: number;
};

export type AdminScanRow = {
  id: string;
  type: ScanType;
  status: ScanStatus;
  platforms: PlatformId[];
  questionCount: number;
  runsPerQuestion: number;
  jobsTotal: number;
  jobsDone: number;
  failedJobs: number;
  totalCostUsd: number;
  simulated: boolean;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  brandName: string;
  organizationId: string;
  organizationName: string;
  internal: boolean;
};

export type ClientDetail = {
  client: ClientRow;
  organization: Organization;
  invoices: Invoice[];
  setups: BrandSetup[];
  members: ClientMember[];
  scans: AdminScanRow[];
  costByMonth: { month: string; costUsd: number }[];
  costByModel: {
    provider: string;
    model: string;
    requests: number;
    tokensIn: number;
    tokensOut: number;
    searchCalls: number;
    costUsd: number;
  }[];
  audit: { id: string; actorName: string; action: string; target: string | null; createdAt: Date }[];
};

const scanRowFields = {
  id: scans.id,
  type: scans.type,
  status: scans.status,
  platforms: scans.platforms,
  questionCount: scans.questionCount,
  runsPerQuestion: scans.runsPerQuestion,
  jobsTotal: scans.jobsTotal,
  jobsDone: scans.jobsDone,
  jobsFailed: scans.jobsFailed,
  totalCostUsd: scans.totalCostUsd,
  simulated: scans.simulated,
  startedAt: scans.startedAt,
  finishedAt: scans.finishedAt,
  createdAt: scans.createdAt,
  brandName: brands.name,
  organizationId: organizations.id,
  organizationName: organizations.name,
  internal: organizations.internal,
};

async function withFailedJobs(rows: (Omit<AdminScanRow, "failedJobs"> & { jobsFailed: number })[]): Promise<AdminScanRow[]> {
  const failed = await failedJobCounts(rows);
  return rows.map(({ jobsFailed, ...row }) => ({ ...row, failedJobs: failed.get(row.id) ?? jobsFailed }));
}

export async function getClientDetail(organizationId: string, now: Date): Promise<ClientDetail | null> {
  if (!isUuid(organizationId)) return null;
  const db = await getDb();
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!organization || organization.internal) return null;

  const [client] = await buildClientRows([organization], now);
  const brandIds = client.brands.map((b) => b.id);
  const sixMonthsBack = dayKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1, 12)), 0);
  const thirtyDaysBack = dayKey(now, 30);

  const [invoiceRows, memberRows, questionCounts, factCounts, competitorCounts, scanRows, monthRows, modelRows, auditRows] =
    await Promise.all([
      db
        .select()
        .from(invoices)
        .where(eq(invoices.organizationId, organizationId))
        .orderBy(desc(invoices.issuedOn))
        .limit(6),
      db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          title: users.title,
          role: memberships.role,
          lastLoginAt: users.lastLoginAt,
          twoFactorEnabled: users.twoFactorEnabled,
          joinedAt: memberships.createdAt,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.organizationId, organizationId))
        .orderBy(asc(memberships.createdAt)),
      brandIds.length
        ? db
            .select({
              brandId: questions.brandId,
              active: sql<number>`count(*) filter (where ${questions.active})`.mapWith(Number),
              key: sql<number>`count(*) filter (where ${questions.active} and ${questions.priority} = 'key')`.mapWith(Number),
            })
            .from(questions)
            .where(inArray(questions.brandId, brandIds))
            .groupBy(questions.brandId)
        : [],
      brandIds.length
        ? db
            .select({
              brandId: facts.brandId,
              approved: sql<number>`count(*) filter (where ${facts.status} = 'approved')`.mapWith(Number),
              draft: sql<number>`count(*) filter (where ${facts.status} = 'draft')`.mapWith(Number),
            })
            .from(facts)
            .where(inArray(facts.brandId, brandIds))
            .groupBy(facts.brandId)
        : [],
      brandIds.length
        ? db
            .select({ brandId: competitors.brandId, total: sql<number>`count(*)`.mapWith(Number) })
            .from(competitors)
            .where(inArray(competitors.brandId, brandIds))
            .groupBy(competitors.brandId)
        : [],
      brandIds.length
        ? db
            .select(scanRowFields)
            .from(scans)
            .innerJoin(brands, eq(brands.id, scans.brandId))
            .innerJoin(organizations, eq(organizations.id, brands.organizationId))
            .where(inArray(scans.brandId, brandIds))
            .orderBy(desc(scans.createdAt))
            .limit(10)
        : [],
      db
        .select({
          month: sql<string>`to_char(${usageCosts.day}, 'YYYY-MM')`,
          costUsd: sql<number>`coalesce(sum(${usageCosts.costUsd}), 0)`.mapWith(Number),
        })
        .from(usageCosts)
        .where(and(eq(usageCosts.organizationId, organizationId), gte(usageCosts.day, sixMonthsBack)))
        .groupBy(sql`to_char(${usageCosts.day}, 'YYYY-MM')`)
        .orderBy(desc(sql`to_char(${usageCosts.day}, 'YYYY-MM')`)),
      db
        .select({
          provider: usageCosts.provider,
          model: usageCosts.model,
          requests: sql<number>`count(*)`.mapWith(Number),
          tokensIn: sql<number>`coalesce(sum(${usageCosts.tokensIn}), 0)`.mapWith(Number),
          tokensOut: sql<number>`coalesce(sum(${usageCosts.tokensOut}), 0)`.mapWith(Number),
          searchCalls: sql<number>`coalesce(sum(${usageCosts.searchCalls}), 0)`.mapWith(Number),
          costUsd: sql<number>`coalesce(sum(${usageCosts.costUsd}), 0)`.mapWith(Number),
        })
        .from(usageCosts)
        .where(and(eq(usageCosts.organizationId, organizationId), gte(usageCosts.day, thirtyDaysBack)))
        .groupBy(usageCosts.provider, usageCosts.model)
        .orderBy(desc(sql`coalesce(sum(${usageCosts.costUsd}), 0)`)),
      db
        .select({
          id: auditLog.id,
          actorName: auditLog.actorName,
          action: auditLog.action,
          target: auditLog.target,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .where(eq(auditLog.organizationId, organizationId))
        .orderBy(desc(auditLog.createdAt))
        .limit(10),
    ]);

  const questionsByBrand = new Map(questionCounts.map((q) => [q.brandId, q]));
  const factsByBrand = new Map(factCounts.map((f) => [f.brandId, f]));
  const competitorsByBrand = new Map(competitorCounts.map((c) => [c.brandId, c.total]));

  return {
    client,
    organization,
    invoices: invoiceRows,
    setups: client.brands.map((brand) => ({
      brand,
      activeQuestions: questionsByBrand.get(brand.id)?.active ?? 0,
      keyQuestions: questionsByBrand.get(brand.id)?.key ?? 0,
      approvedFacts: factsByBrand.get(brand.id)?.approved ?? 0,
      draftFacts: factsByBrand.get(brand.id)?.draft ?? 0,
      competitors: competitorsByBrand.get(brand.id) ?? 0,
    })),
    members: memberRows,
    scans: await withFailedJobs(scanRows),
    costByMonth: monthRows,
    costByModel: modelRows,
    audit: auditRows,
  };
}

/** For the "View as client" action and the audit log. */
export async function getClientOrganization(organizationId: string): Promise<Organization | null> {
  if (!isUuid(organizationId)) return null;
  const db = await getDb();
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  return organization && !organization.internal ? organization : null;
}

/* Review queue */

export type ReviewQueueItem = {
  id: string;
  number: number;
  title: string;
  verdict: ErrorVerdict;
  severity: Severity;
  confidence: number;
  platforms: PlatformId[];
  firstSeenAt: Date;
  createdAt: Date;
  brandName: string;
  organizationId: string;
  organizationName: string;
  internal: boolean;
};

const queueFields = {
  id: issues.id,
  number: issues.number,
  title: issues.title,
  verdict: issues.verdict,
  severity: issues.severity,
  confidence: issues.confidence,
  platforms: issues.platforms,
  firstSeenAt: issues.firstSeenAt,
  createdAt: issues.createdAt,
  brandName: brands.name,
  organizationId: organizations.id,
  organizationName: organizations.name,
  internal: organizations.internal,
};

/** Issues waiting for review, oldest first. Clients see none of them until they are approved. */
export async function getReviewQueue(): Promise<ReviewQueueItem[]> {
  const db = await getDb();
  return db
    .select(queueFields)
    .from(issues)
    .innerJoin(brands, eq(brands.id, issues.brandId))
    .innerJoin(organizations, eq(organizations.id, brands.organizationId))
    .where(eq(issues.reviewState, "pending"))
    .orderBy(asc(issues.firstSeenAt), asc(issues.createdAt), asc(issues.number));
}

/** The oldest issue still waiting for review, other than `exceptId`. */
export async function nextPendingIssueId(exceptId?: string): Promise<string | null> {
  const queue = await getReviewQueue();
  return queue.find((item) => item.id !== exceptId)?.id ?? null;
}

export type ReviewedItem = {
  eventId: string;
  issueId: string;
  number: number;
  title: string;
  decision: "approved" | "rejected";
  reviewState: ReviewState;
  severity: Severity;
  actorName: string;
  note: string | null;
  at: Date;
  brandName: string;
  organizationName: string;
  internal: boolean;
};

export async function getRecentlyReviewed(limit = 12): Promise<ReviewedItem[]> {
  const db = await getDb();
  const rows = await db
    .select({
      eventId: issueEvents.id,
      issueId: issues.id,
      number: issues.number,
      title: issues.title,
      kind: issueEvents.kind,
      reviewState: issues.reviewState,
      severity: issues.severity,
      actorName: issueEvents.actorName,
      note: issueEvents.note,
      at: issueEvents.createdAt,
      brandName: brands.name,
      organizationName: organizations.name,
      internal: organizations.internal,
    })
    .from(issueEvents)
    .innerJoin(issues, eq(issues.id, issueEvents.issueId))
    .innerJoin(brands, eq(brands.id, issues.brandId))
    .innerJoin(organizations, eq(organizations.id, brands.organizationId))
    .where(inArray(issueEvents.kind, ["approved", "rejected"]))
    .orderBy(desc(issueEvents.createdAt))
    .limit(limit);
  return rows.map(({ kind, ...row }) => ({ ...row, decision: kind === "rejected" ? "rejected" : "approved" }));
}

export type NotAnErrorItem = {
  id: string;
  number: number;
  title: string;
  verdict: ErrorVerdict;
  wrongStatement: string;
  note: string | null;
  dismissedAt: Date;
  dismissedBy: string | null;
  brandName: string;
  organizationName: string;
};

/** Issues clients marked "Not an error", with their notes. They feed the checker's rules. */
export async function getNotAnErrorFeedback(limit = 20): Promise<NotAnErrorItem[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: issues.id,
      number: issues.number,
      title: issues.title,
      verdict: issues.verdict,
      wrongStatement: issues.wrongStatement,
      note: issues.dismissNote,
      dismissedAt: issues.dismissedAt,
      dismissedBy: users.name,
      brandName: brands.name,
      organizationName: organizations.name,
    })
    .from(issues)
    .innerJoin(brands, eq(brands.id, issues.brandId))
    .innerJoin(organizations, eq(organizations.id, brands.organizationId))
    .leftJoin(users, eq(users.id, issues.dismissedBy))
    .where(isNotNull(issues.dismissedAt))
    .orderBy(desc(issues.dismissedAt))
    .limit(limit);
  return rows.flatMap((row) => (row.dismissedAt ? [{ ...row, dismissedAt: row.dismissedAt }] : []));
}

export type ReviewStatement = {
  id: string;
  text: string;
  verdict: Verdict;
  confidence: number;
  spanStart: number | null;
  spanEnd: number | null;
  issueId: string | null;
  intermittent: boolean;
  factStatement: string | null;
};

export type ReviewSighting = {
  statementId: string;
  answerId: string;
  platform: PlatformId;
  model: string;
  runNumber: number;
  confidence: number;
  seenAt: Date;
};

export type ReviewItem = {
  issue: typeof issues.$inferSelect;
  brand: Brand;
  organization: Organization;
  fact: typeof facts.$inferSelect | null;
  question: { text: string; category: (typeof questions.$inferSelect)["category"] } | null;
  /** The answer shown in the proof view: the latest one that contains the statement. */
  answer: {
    id: string;
    text: string;
    platform: PlatformId;
    model: string;
    runNumber: number;
    createdAt: Date;
    webSearch: boolean;
  } | null;
  /** The issue's statement inside that answer. */
  statement: ReviewStatement | null;
  /** Every statement the checker extracted from that answer. */
  answerStatements: ReviewStatement[];
  citations: { url: string; title: string | null; position: number }[];
  sources: (typeof sources.$inferSelect)[];
  sightings: ReviewSighting[];
  events: (typeof issueEvents.$inferSelect)[];
  /** 1-based place in the queue, when the issue is still waiting. */
  queuePosition: number | null;
  queueLength: number;
  /** The waiting issue after this one, or the oldest other one. */
  nextId: string | null;
};

export async function getReviewItem(issueId: string): Promise<ReviewItem | null> {
  if (!isUuid(issueId)) return null;
  const db = await getDb();
  const [row] = await db
    .select({ issue: issues, brand: brands, organization: organizations })
    .from(issues)
    .innerJoin(brands, eq(brands.id, issues.brandId))
    .innerJoin(organizations, eq(organizations.id, brands.organizationId))
    .where(eq(issues.id, issueId))
    .limit(1);
  if (!row) return null;
  const { issue } = row;

  const [factRows, questionRows, sightingRows, sourceRows, eventRows, queue] = await Promise.all([
    issue.factId ? db.select().from(facts).where(eq(facts.id, issue.factId)).limit(1) : [],
    issue.questionId
      ? db
          .select({ text: questions.text, category: questions.category })
          .from(questions)
          .where(eq(questions.id, issue.questionId))
          .limit(1)
      : [],
    db
      .select({
        statementId: statements.id,
        answerId: answers.id,
        platform: answers.platform,
        model: answers.model,
        runNumber: answers.runNumber,
        confidence: statements.confidence,
        seenAt: answers.createdAt,
        hasSpan: sql<boolean>`${statements.spanStart} is not null`,
      })
      .from(statements)
      .innerJoin(answers, eq(answers.id, statements.answerId))
      .where(eq(statements.issueId, issue.id))
      .orderBy(desc(answers.createdAt), asc(answers.platform), asc(answers.runNumber)),
    db.select().from(sources).where(eq(sources.issueId, issue.id)),
    db.select().from(issueEvents).where(eq(issueEvents.issueId, issue.id)).orderBy(asc(issueEvents.createdAt)),
    getReviewQueue(),
  ]);

  // Prefer the latest answer where the statement can be marked in the text.
  const shown = sightingRows.find((s) => s.hasSpan) ?? sightingRows[0] ?? null;

  let answer: ReviewItem["answer"] = null;
  let answerStatements: ReviewStatement[] = [];
  let citationRows: ReviewItem["citations"] = [];
  if (shown) {
    const [answerRows, statementRows, citeRows] = await Promise.all([
      db
        .select({
          id: answers.id,
          text: answers.text,
          platform: answers.platform,
          model: answers.model,
          runNumber: answers.runNumber,
          createdAt: answers.createdAt,
          settings: answers.settings,
        })
        .from(answers)
        .where(eq(answers.id, shown.answerId))
        .limit(1),
      db
        .select({
          id: statements.id,
          text: statements.text,
          verdict: statements.verdict,
          confidence: statements.confidence,
          spanStart: statements.spanStart,
          spanEnd: statements.spanEnd,
          issueId: statements.issueId,
          intermittent: statements.intermittent,
          factStatement: facts.statement,
        })
        .from(statements)
        .leftJoin(facts, eq(facts.id, statements.factId))
        .where(eq(statements.answerId, shown.answerId))
        .orderBy(sql`${statements.spanStart} asc nulls last`, asc(statements.createdAt)),
      db
        .select({ url: citations.url, title: citations.title, position: citations.position })
        .from(citations)
        .where(eq(citations.answerId, shown.answerId))
        .orderBy(asc(citations.position)),
    ]);
    const a = answerRows[0];
    if (a) {
      answer = {
        id: a.id,
        text: a.text,
        platform: a.platform,
        model: a.model,
        runNumber: a.runNumber,
        createdAt: a.createdAt,
        webSearch: Boolean(a.settings?.webSearch),
      };
    }
    answerStatements = statementRows;
    citationRows = citeRows;
  }

  const position = queue.findIndex((q) => q.id === issue.id);
  return {
    issue,
    brand: row.brand,
    organization: row.organization,
    fact: factRows[0] ?? null,
    question: questionRows[0] ?? null,
    answer,
    statement: answerStatements.find((s) => s.id === shown?.statementId) ?? null,
    answerStatements,
    citations: citationRows,
    sources: sourceRows,
    sightings: sightingRows.map(({ hasSpan, ...s }) => {
      void hasSpan;
      return s;
    }),
    events: eventRows,
    queuePosition: position >= 0 ? position + 1 : null,
    queueLength: queue.length,
    nextId: (position >= 0 ? queue[position + 1]?.id : undefined) ?? queue.find((q) => q.id !== issue.id)?.id ?? null,
  };
}

/** A short line about an issue that was just reviewed, for the notice on the next page. */
export async function getReviewedSummary(issueId: string) {
  if (!isUuid(issueId)) return null;
  const db = await getDb();
  const [row] = await db
    .select({
      number: issues.number,
      title: issues.title,
      reviewState: issues.reviewState,
      severity: issues.severity,
      brandName: brands.name,
      organizationName: organizations.name,
      internal: organizations.internal,
    })
    .from(issues)
    .innerJoin(brands, eq(brands.id, issues.brandId))
    .innerJoin(organizations, eq(organizations.id, brands.organizationId))
    .where(eq(issues.id, issueId))
    .limit(1);
  return row ?? null;
}

/* Scans and jobs */

export type ScansFilter = "all" | "failed";

export type ScansOverview = {
  running: AdminScanRow[];
  recent: AdminScanRow[];
  counts: { all: number; failed: number };
  /** The next scheduled scan across clients, if any is due later. */
  nextScheduled: { brandName: string; organizationName: string; at: Date } | null;
};

const RECENT_SCANS_LIMIT = 40;

function hasFailedJobs() {
  return or(
    eq(scans.status, "failed"),
    sql`exists (select 1 from ${scanJobs} where ${scanJobs.scanId} = ${scans.id} and ${scanJobs.status} = 'failed')`,
  );
}

export async function getScansOverview(filter: ScansFilter): Promise<ScansOverview> {
  const db = await getDb();
  const finished = notInArray(scans.status, [...ACTIVE_SCAN_STATUSES]);
  const [runningRows, recentRows, [counts], [next]] = await Promise.all([
    db
      .select(scanRowFields)
      .from(scans)
      .innerJoin(brands, eq(brands.id, scans.brandId))
      .innerJoin(organizations, eq(organizations.id, brands.organizationId))
      .where(inArray(scans.status, [...ACTIVE_SCAN_STATUSES]))
      .orderBy(sql`coalesce(${scans.startedAt}, ${scans.createdAt}) asc`),
    db
      .select(scanRowFields)
      .from(scans)
      .innerJoin(brands, eq(brands.id, scans.brandId))
      .innerJoin(organizations, eq(organizations.id, brands.organizationId))
      .where(filter === "failed" ? and(finished, hasFailedJobs()) : finished)
      .orderBy(desc(scans.createdAt))
      .limit(RECENT_SCANS_LIMIT),
    db
      .select({
        all: sql<number>`count(*)`.mapWith(Number),
        failed: sql<number>`count(*) filter (where ${hasFailedJobs()})`.mapWith(Number),
      })
      .from(scans)
      .where(finished),
    db
      .select({ brandName: brands.name, organizationName: organizations.name, at: brands.nextScanAt })
      .from(brands)
      .innerJoin(organizations, eq(organizations.id, brands.organizationId))
      .where(and(eq(organizations.internal, false), isNotNull(brands.nextScanAt)))
      .orderBy(asc(brands.nextScanAt))
      .limit(1),
  ]);
  return {
    running: await withFailedJobs(runningRows),
    recent: await withFailedJobs(recentRows),
    counts: { all: counts?.all ?? 0, failed: counts?.failed ?? 0 },
    nextScheduled: next?.at ? { brandName: next.brandName, organizationName: next.organizationName, at: next.at } : null,
  };
}

export type FailedJob = {
  id: string;
  question: string;
  platform: PlatformId;
  runNumber: number;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: Date | null;
};

export type ScanAnswerRow = {
  id: string;
  question: string;
  platform: PlatformId;
  model: string;
  runNumber: number;
  costUsd: number;
  latencyMs: number | null;
  statements: number;
  wrong: number;
};

export type ScanDetail = {
  scan: typeof scans.$inferSelect;
  brand: Brand;
  organization: Organization;
  triggeredBy: string | null;
  recheckIssue: { id: string; number: number; title: string } | null;
  jobsByPlatform: { platform: PlatformId; counts: Record<JobStatus, number> }[];
  jobTotals: Record<JobStatus, number> & { total: number };
  failedJobs: FailedJob[];
  answers: ScanAnswerRow[];
  answerCount: number;
  wrongTotal: number;
};

export const SCAN_ANSWERS_LIMIT = 60;

export async function getScanDetail(scanId: string): Promise<ScanDetail | null> {
  if (!isUuid(scanId)) return null;
  const db = await getDb();
  const [row] = await db
    .select({ scan: scans, brand: brands, organization: organizations, triggeredBy: users.name })
    .from(scans)
    .innerJoin(brands, eq(brands.id, scans.brandId))
    .innerJoin(organizations, eq(organizations.id, brands.organizationId))
    .leftJoin(users, eq(users.id, scans.triggeredBy))
    .where(eq(scans.id, scanId))
    .limit(1);
  if (!row) return null;

  const [jobRows, failedRows, answerRows, [answerTotals], recheckRows] = await Promise.all([
    db
      .select({ platform: scanJobs.platform, status: scanJobs.status, total: sql<number>`count(*)`.mapWith(Number) })
      .from(scanJobs)
      .where(eq(scanJobs.scanId, scanId))
      .groupBy(scanJobs.platform, scanJobs.status),
    db
      .select({
        id: scanJobs.id,
        question: questions.text,
        platform: scanJobs.platform,
        runNumber: scanJobs.runNumber,
        attempts: scanJobs.attempts,
        lastError: scanJobs.lastError,
        nextAttemptAt: scanJobs.nextAttemptAt,
      })
      .from(scanJobs)
      .innerJoin(questions, eq(questions.id, scanJobs.questionId))
      .where(and(eq(scanJobs.scanId, scanId), eq(scanJobs.status, "failed")))
      .orderBy(asc(scanJobs.platform), asc(questions.text), asc(scanJobs.runNumber)),
    db
      .select({
        id: answers.id,
        question: questions.text,
        platform: answers.platform,
        model: answers.model,
        runNumber: answers.runNumber,
        costUsd: answers.costUsd,
        latencyMs: answers.latencyMs,
      })
      .from(answers)
      .innerJoin(questions, eq(questions.id, answers.questionId))
      .where(eq(answers.scanId, scanId))
      .orderBy(asc(questions.text), asc(answers.platform), asc(answers.runNumber))
      .limit(SCAN_ANSWERS_LIMIT),
    db
      .select({
        total: sql<number>`count(distinct ${answers.id})`.mapWith(Number),
        wrong: sql<number>`count(${statements.id}) filter (where ${inArray(statements.verdict, [...WRONG_VERDICTS])})`.mapWith(
          Number,
        ),
      })
      .from(answers)
      .leftJoin(statements, eq(statements.answerId, answers.id))
      .where(eq(answers.scanId, scanId)),
    row.scan.issueId && isUuid(row.scan.issueId)
      ? db
          .select({ id: issues.id, number: issues.number, title: issues.title })
          .from(issues)
          .where(eq(issues.id, row.scan.issueId))
          .limit(1)
      : [],
  ]);

  const answerIds = answerRows.map((a) => a.id);
  const statementCounts = answerIds.length
    ? await db
        .select({
          answerId: statements.answerId,
          total: sql<number>`count(*)`.mapWith(Number),
          wrong: sql<number>`count(*) filter (where ${inArray(statements.verdict, [...WRONG_VERDICTS])})`.mapWith(Number),
        })
        .from(statements)
        .where(inArray(statements.answerId, answerIds))
        .groupBy(statements.answerId)
    : [];
  const countsByAnswer = new Map(statementCounts.map((c) => [c.answerId, c]));

  const emptyCounts = (): Record<JobStatus, number> => ({ queued: 0, running: 0, done: 0, failed: 0 });
  const byPlatform = new Map<PlatformId, Record<JobStatus, number>>();
  const totals = { ...emptyCounts(), total: 0 };
  for (const job of jobRows) {
    const counts = byPlatform.get(job.platform) ?? emptyCounts();
    counts[job.status] += job.total;
    byPlatform.set(job.platform, counts);
    totals[job.status] += job.total;
    totals.total += job.total;
  }
  const platformOrder = row.scan.platforms;
  const jobsByPlatform = [...byPlatform.entries()]
    .sort(([a], [b]) => platformOrder.indexOf(a) - platformOrder.indexOf(b))
    .map(([platform, counts]) => ({ platform, counts }));

  return {
    scan: row.scan,
    brand: row.brand,
    organization: row.organization,
    triggeredBy: row.triggeredBy,
    recheckIssue: recheckRows[0] ?? null,
    jobsByPlatform,
    jobTotals: totals,
    failedJobs: failedRows,
    answers: answerRows.map((a) => ({
      ...a,
      statements: countsByAnswer.get(a.id)?.total ?? 0,
      wrong: countsByAnswer.get(a.id)?.wrong ?? 0,
    })),
    answerCount: answerTotals?.total ?? 0,
    wrongTotal: answerTotals?.wrong ?? 0,
  };
}

/** The organization that owns a scan, for audit log entries. */
export async function getScanOwner(scanId: string) {
  if (!isUuid(scanId)) return null;
  const db = await getDb();
  const [row] = await db
    .select({
      scanId: scans.id,
      status: scans.status,
      type: scans.type,
      createdAt: scans.createdAt,
      organizationId: organizations.id,
      organizationName: organizations.name,
      brandName: brands.name,
    })
    .from(scans)
    .innerJoin(brands, eq(brands.id, scans.brandId))
    .innerJoin(organizations, eq(organizations.id, brands.organizationId))
    .where(eq(scans.id, scanId))
    .limit(1);
  return row ?? null;
}
