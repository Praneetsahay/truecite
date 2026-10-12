import "server-only";
import { and, asc, countDistinct, count, desc, eq, gte, inArray, isNull, lt, sql, sum } from "drizzle-orm";
import {
  answers,
  auditLog,
  brands,
  checkRequests,
  getDb,
  issues,
  organizations,
  prospects,
  reports,
  scans,
  subscriptions,
  usageCosts,
  type CheckRequest,
  type Issue,
  type Prospect,
  type Report,
  type Scan,
  type Subscription,
} from "@/lib/db";
import { SEVERITY_ORDER, type Currency, type PlanId, type ScanType } from "@/lib/domain/constants";
import { marginCheck, toUsd } from "@/lib/domain/costs";
import { DISPLAY_TIME_ZONE } from "@/lib/domain/format";
import type { ReportFinding } from "@/lib/domain/report";

/*
  Reads for the business side of the admin panel: what each client costs
  against what it pays, the prospect pipeline, and the settings audit trail.
  Admin pages call requireAdmin() before any of these.
*/

/* Labels */

export const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  google: "Google",
  perplexity: "Perplexity",
  anthropic: "Anthropic",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

export const COST_PURPOSES = {
  answer: { label: "Answering questions", description: "AI assistants answering the Question Set, with web search" },
  check: { label: "Checking answers", description: "The checker model extracting and checking statements" },
  trace: { label: "Tracing sources", description: "Reading cited pages to find where errors come from" },
  facts: { label: "Drafting Fact Sheets", description: "Reading company websites to draft facts" },
  questions: { label: "Writing Question Sets", description: "Generating questions for new brands" },
} as const;

export type CostPurpose = keyof typeof COST_PURPOSES;

/** Scans that ask the whole Question Set; used for "cost per scan". */
const FULL_SCAN_TYPES = ["scheduled", "manual", "audit"] as const satisfies readonly ScanType[];

/* Months */

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "2026-10" for the month `now` falls in, in the display time zone. */
export function monthKeyFor(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: DISPLAY_TIME_ZONE, year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value ?? "2026";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${year}-${month}`;
}

export function parseMonth(value: unknown): string | null {
  return typeof value === "string" && MONTH.test(value) ? value : null;
}

function shiftMonth(month: string, by: number): string {
  const [, y, m] = MONTH.exec(month)!;
  const index = Number(y) * 12 + (Number(m) - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The offset of the display time zone from UTC at an instant, in ms. */
function zoneOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - at.getTime();
}

/** Midnight at the start of a month in the display time zone. */
function monthStart(month: string): Date {
  const [, y, m] = MONTH.exec(month)!;
  const guess = Date.UTC(Number(y), Number(m) - 1, 1);
  return new Date(guess - zoneOffsetMs(new Date(guess)));
}

function monthRange(month: string) {
  const next = shiftMonth(month, 1);
  return { firstDay: `${month}-01`, nextFirstDay: `${next}-01`, start: monthStart(month), end: monthStart(next) };
}

/* Costs */

export type Margin = { share: number | null; overLimit: boolean };

export type ClientCostRow = {
  id: string;
  name: string;
  plan: PlanId;
  trial: boolean;
  revenue: number;
  revenueCurrency: Currency;
  revenueUsd: number;
  apiCost: number;
  margin: Margin;
  requests: number;
  fullScans: number;
  costPerScan: number | null;
};

export type CostLine = {
  key: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  searchCalls: number;
  cost: number;
};

export type CostsOverview = {
  month: string;
  months: string[];
  clients: ClientCostRow[];
  internal: { cost: number; scans: number; requests: number };
  byModel: CostLine[];
  byPurpose: { purpose: CostPurpose; cost: number; tokensIn: number; tokensOut: number }[];
  totals: { revenueUsd: number; clientCost: number; allCost: number; requests: number; overLimit: number };
};

/** What a subscription brings in per month, in its own currency. Trials and cancelled plans bring in nothing. */
function monthlyRevenue(subscription: Pick<Subscription, "status" | "amount" | "interval"> | null): number {
  if (!subscription) return 0;
  if (subscription.status === "trialing" || subscription.status === "cancelled") return 0;
  return subscription.interval === "year" ? subscription.amount / 12 : subscription.amount;
}

const num = (value: unknown) => Number(value ?? 0) || 0;

export async function getCostsOverview(month: string, now: Date): Promise<CostsOverview> {
  const db = await getDb();
  const range = monthRange(month);
  const inMonth = and(gte(usageCosts.day, range.firstDay), lt(usageCosts.day, range.nextFirstDay));

  const [orgs, usageByOrg, byModelRows, byPurposeRows, requestRows, scanRows, monthRows] = await Promise.all([
    db
      .select({ id: organizations.id, name: organizations.name, plan: organizations.plan, currency: organizations.currency, internal: organizations.internal })
      .from(organizations)
      .orderBy(asc(organizations.name)),
    db
      .select({ organizationId: usageCosts.organizationId, cost: sum(usageCosts.costUsd) })
      .from(usageCosts)
      .where(inMonth)
      .groupBy(usageCosts.organizationId),
    db
      .select({
        provider: usageCosts.provider,
        model: usageCosts.model,
        cost: sum(usageCosts.costUsd),
        tokensIn: sum(usageCosts.tokensIn),
        tokensOut: sum(usageCosts.tokensOut),
        searchCalls: sum(usageCosts.searchCalls),
      })
      .from(usageCosts)
      .where(inMonth)
      .groupBy(usageCosts.provider, usageCosts.model),
    db
      .select({
        purpose: usageCosts.purpose,
        cost: sum(usageCosts.costUsd),
        tokensIn: sum(usageCosts.tokensIn),
        tokensOut: sum(usageCosts.tokensOut),
      })
      .from(usageCosts)
      .where(inMonth)
      .groupBy(usageCosts.purpose),
    db
      .select({ organizationId: brands.organizationId, requests: count() })
      .from(answers)
      .innerJoin(brands, eq(brands.id, answers.brandId))
      .where(and(gte(answers.createdAt, range.start), lt(answers.createdAt, range.end)))
      .groupBy(brands.organizationId),
    db
      .select({
        organizationId: usageCosts.organizationId,
        type: scans.type,
        cost: sum(usageCosts.costUsd),
        scans: countDistinct(scans.id),
      })
      .from(usageCosts)
      .innerJoin(scans, eq(scans.id, usageCosts.scanId))
      .where(inMonth)
      .groupBy(usageCosts.organizationId, scans.type),
    db
      .selectDistinct({ month: sql<string>`to_char(${usageCosts.day}, 'YYYY-MM')` })
      .from(usageCosts),
  ]);

  const orgIds = orgs.map((o) => o.id);
  const subs = orgIds.length
    ? await db
        .select()
        .from(subscriptions)
        .where(and(inArray(subscriptions.organizationId, orgIds), lt(subscriptions.createdAt, range.end)))
        .orderBy(desc(subscriptions.createdAt))
    : [];
  const latestSub = new Map<string, Subscription>();
  for (const sub of subs) if (!latestSub.has(sub.organizationId)) latestSub.set(sub.organizationId, sub);

  const costOf = new Map(usageByOrg.map((r) => [r.organizationId, num(r.cost)]));
  const requestsOf = new Map(requestRows.map((r) => [r.organizationId, num(r.requests)]));
  const fullScans = new Map<string, { cost: number; scans: number }>();
  const internalIds = new Set(orgs.filter((o) => o.internal).map((o) => o.id));
  let internalScans = 0;
  for (const row of scanRows) {
    if (internalIds.has(row.organizationId)) {
      internalScans += num(row.scans);
      continue;
    }
    if (!(FULL_SCAN_TYPES as readonly string[]).includes(row.type)) continue;
    const entry = fullScans.get(row.organizationId) ?? { cost: 0, scans: 0 };
    entry.cost += num(row.cost);
    entry.scans += num(row.scans);
    fullScans.set(row.organizationId, entry);
  }

  const clients: ClientCostRow[] = orgs
    .filter((o) => !o.internal)
    .map((org) => {
      const sub = latestSub.get(org.id) ?? null;
      const revenue = monthlyRevenue(sub);
      const revenueCurrency = sub?.currency ?? org.currency;
      const revenueUsd = toUsd(revenue, revenueCurrency);
      const apiCost = costOf.get(org.id) ?? 0;
      const check = marginCheck(apiCost, revenueUsd);
      const scansFull = fullScans.get(org.id);
      return {
        id: org.id,
        name: org.name,
        plan: org.plan,
        trial: org.plan === "trial" || sub?.status === "trialing",
        revenue,
        revenueCurrency,
        revenueUsd,
        apiCost,
        margin: revenueUsd > 0 ? { share: check.share, overLimit: !check.withinRule } : { share: null, overLimit: false },
        requests: requestsOf.get(org.id) ?? 0,
        fullScans: scansFull?.scans ?? 0,
        costPerScan: scansFull && scansFull.scans > 0 ? scansFull.cost / scansFull.scans : null,
      };
    })
    // Worst first: paying clients by cost share, then clients that pay nothing by cost.
    .sort((a, b) => {
      if (a.margin.share !== null && b.margin.share !== null) return b.margin.share - a.margin.share;
      if (a.margin.share !== null) return -1;
      if (b.margin.share !== null) return 1;
      return b.apiCost - a.apiCost || a.name.localeCompare(b.name);
    });

  const internalCost = [...internalIds].reduce((total, id) => total + (costOf.get(id) ?? 0), 0);
  const internalRequests = [...internalIds].reduce((total, id) => total + (requestsOf.get(id) ?? 0), 0);

  const byModel: CostLine[] = byModelRows
    .map((r) => ({
      key: `${r.provider}/${r.model}`,
      provider: r.provider,
      model: r.model,
      cost: num(r.cost),
      tokensIn: num(r.tokensIn),
      tokensOut: num(r.tokensOut),
      searchCalls: num(r.searchCalls),
    }))
    .sort((a, b) => b.cost - a.cost);

  const purposeOrder = Object.keys(COST_PURPOSES) as CostPurpose[];
  const byPurpose = byPurposeRows
    .map((r) => ({ purpose: r.purpose, cost: num(r.cost), tokensIn: num(r.tokensIn), tokensOut: num(r.tokensOut) }))
    .sort((a, b) => purposeOrder.indexOf(a.purpose) - purposeOrder.indexOf(b.purpose));

  const current = monthKeyFor(now);
  const months = [...new Set([current, month, ...monthRows.map((r) => r.month).filter(Boolean)])]
    .filter((m) => m <= current || m === month)
    .sort()
    .reverse()
    .slice(0, 18);

  const clientCost = clients.reduce((total, c) => total + c.apiCost, 0);
  return {
    month,
    months,
    clients,
    internal: { cost: internalCost, scans: internalScans, requests: internalRequests },
    byModel,
    byPurpose,
    totals: {
      revenueUsd: clients.reduce((total, c) => total + c.revenueUsd, 0),
      clientCost,
      allCost: byModel.reduce((total, line) => total + line.cost, 0),
      requests: clients.reduce((total, c) => total + c.requests, 0),
      overLimit: clients.filter((c) => c.margin.overLimit).length,
    },
  };
}

/* Prospects */

export function appUrl(): string {
  return (process.env.APP_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
}

export function shareUrl(token: string): string {
  return `${appUrl()}/r/${token}`;
}

export type ReportLink = Pick<Report, "id" | "shareToken" | "shareExpiresAt" | "createdAt">;

export type ProspectRow = Prospect & { report: ReportLink | null; findings: number; pending: number };

export async function getNewCheckRequests(): Promise<CheckRequest[]> {
  const db = await getDb();
  return db.select().from(checkRequests).where(eq(checkRequests.status, "new")).orderBy(asc(checkRequests.createdAt));
}

export async function getCheckRequestCounts(): Promise<{ accepted: number; declined: number }> {
  const db = await getDb();
  const rows = await db.select({ status: checkRequests.status, value: count() }).from(checkRequests).groupBy(checkRequests.status);
  const of = (status: string) => num(rows.find((r) => r.status === status)?.value);
  return { accepted: of("accepted"), declined: of("declined") };
}

async function findingCounts(brandIds: string[]) {
  if (brandIds.length === 0) return new Map<string, { approved: number; pending: number }>();
  const db = await getDb();
  const rows = await db
    .select({ brandId: issues.brandId, reviewState: issues.reviewState, value: count() })
    .from(issues)
    .where(and(inArray(issues.brandId, brandIds), isNull(issues.dismissedAt)))
    .groupBy(issues.brandId, issues.reviewState);
  const map = new Map<string, { approved: number; pending: number }>();
  for (const row of rows) {
    const entry = map.get(row.brandId) ?? { approved: 0, pending: 0 };
    if (row.reviewState === "approved") entry.approved += num(row.value);
    if (row.reviewState === "pending") entry.pending += num(row.value);
    map.set(row.brandId, entry);
  }
  return map;
}

export async function getProspects(): Promise<ProspectRow[]> {
  const db = await getDb();
  const rows = await db
    .select({
      prospect: prospects,
      reportId: reports.id,
      shareToken: reports.shareToken,
      shareExpiresAt: reports.shareExpiresAt,
      reportCreatedAt: reports.createdAt,
      reportFindings: sql<number | null>`jsonb_array_length(${reports.data}->'topRisks')`,
    })
    .from(prospects)
    .leftJoin(reports, eq(reports.id, prospects.reportId))
    .orderBy(desc(prospects.updatedAt));
  const counts = await findingCounts(rows.map((r) => r.prospect.brandId).filter((id): id is string => Boolean(id)));
  return rows.map((row) => {
    const found = row.prospect.brandId ? counts.get(row.prospect.brandId) : undefined;
    return {
      ...row.prospect,
      report:
        row.reportId && row.reportCreatedAt
          ? { id: row.reportId, shareToken: row.shareToken, shareExpiresAt: row.shareExpiresAt, createdAt: row.reportCreatedAt }
          : null,
      // Approved findings; a report built earlier counts its own findings when the issues are gone.
      findings: Math.max(found?.approved ?? 0, row.reportId ? num(row.reportFindings) : 0),
      pending: found?.pending ?? 0,
    };
  });
}

export type ProspectFinding = Pick<
  Issue,
  "id" | "number" | "title" | "severity" | "verdict" | "reviewState" | "platforms" | "wrongStatement" | "correctStatement" | "category" | "type"
>;

export type ProspectDetail = {
  prospect: Prospect;
  report: (ReportLink & { findings: ReportFinding[] }) | null;
  scan: Pick<Scan, "id" | "status" | "jobsDone" | "jobsTotal" | "jobsFailed" | "totalCostUsd" | "simulated" | "questionCount" | "platforms" | "createdAt" | "finishedAt" | "error"> | null;
  scanCount: number;
  findings: ProspectFinding[];
  request: CheckRequest | null;
};

export async function getProspectDetail(id: string): Promise<ProspectDetail | null> {
  const db = await getDb();
  const [prospect] = await db.select().from(prospects).where(eq(prospects.id, id)).limit(1);
  if (!prospect) return null;

  const [reportRows, scanRows, findings, requestRows] = await Promise.all([
    prospect.reportId
      ? db
          .select({
            id: reports.id,
            shareToken: reports.shareToken,
            shareExpiresAt: reports.shareExpiresAt,
            createdAt: reports.createdAt,
            data: reports.data,
          })
          .from(reports)
          .where(eq(reports.id, prospect.reportId))
          .limit(1)
      : [],
    prospect.brandId
      ? db
          .select({
            id: scans.id,
            status: scans.status,
            jobsDone: scans.jobsDone,
            jobsTotal: scans.jobsTotal,
            jobsFailed: scans.jobsFailed,
            totalCostUsd: scans.totalCostUsd,
            simulated: scans.simulated,
            questionCount: scans.questionCount,
            platforms: scans.platforms,
            createdAt: scans.createdAt,
            finishedAt: scans.finishedAt,
            error: scans.error,
          })
          .from(scans)
          .where(and(eq(scans.brandId, prospect.brandId), eq(scans.type, "prospect")))
          .orderBy(desc(scans.createdAt))
      : [],
    prospect.brandId
      ? db
          .select({
            id: issues.id,
            number: issues.number,
            title: issues.title,
            severity: issues.severity,
            verdict: issues.verdict,
            reviewState: issues.reviewState,
            platforms: issues.platforms,
            wrongStatement: issues.wrongStatement,
            correctStatement: issues.correctStatement,
            category: issues.category,
            type: issues.type,
          })
          .from(issues)
          .where(and(eq(issues.brandId, prospect.brandId), isNull(issues.dismissedAt)))
          .orderBy(asc(issues.number))
      : [],
    db.select().from(checkRequests).where(eq(checkRequests.prospectId, prospect.id)).limit(1),
  ]);

  const reviewOrder = { pending: 0, approved: 1, rejected: 2 } as const;
  findings.sort(
    (a, b) =>
      reviewOrder[a.reviewState] - reviewOrder[b.reviewState] ||
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      a.number - b.number,
  );

  return {
    prospect,
    report: reportRows[0]
      ? {
          id: reportRows[0].id,
          shareToken: reportRows[0].shareToken,
          shareExpiresAt: reportRows[0].shareExpiresAt,
          createdAt: reportRows[0].createdAt,
          findings: reportRows[0].data?.topRisks ?? [],
        }
      : null,
    scan: scanRows[0] ?? null,
    scanCount: scanRows.length,
    findings,
    request: requestRows[0] ?? null,
  };
}

/* Settings */

export type AuditRow = {
  id: string;
  createdAt: Date;
  actorName: string;
  action: string;
  target: string | null;
  organizationName: string | null;
};

export async function getAuditLog(limit = 50): Promise<AuditRow[]> {
  const db = await getDb();
  return db
    .select({
      id: auditLog.id,
      createdAt: auditLog.createdAt,
      actorName: auditLog.actorName,
      action: auditLog.action,
      target: auditLog.target,
      organizationName: organizations.name,
    })
    .from(auditLog)
    .leftJoin(organizations, eq(organizations.id, auditLog.organizationId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}
