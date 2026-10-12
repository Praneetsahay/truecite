import "server-only";
import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { ClientContext } from "@/lib/auth/dal";
import {
  alertRules,
  auditLog,
  competitorSnapshots,
  competitors,
  getDb,
  invites,
  invoices,
  memberships,
  outbox,
  questions,
  reports,
  scoreSnapshots,
  subscriptions,
  users,
  type Report,
  type SentimentSplit,
} from "@/lib/db";
import type { Role } from "@/lib/domain/constants";
import { DISPLAY_TIME_ZONE, formatMonth } from "@/lib/domain/format";

/*
  Reads for the account pages: competitors, reports, alerts, team and billing.
  Every query is scoped to the signed-in client's brand or organization.
*/

/** How many scans the competitor trend shows. */
export const COMPETITOR_TREND_LENGTH = 12;

/** How many recent emails the alerts page lists. */
export const RECENT_MESSAGES = 15;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids come from URLs; anything that is not a UUID can never match a row. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** The address people use to reach TrueCite, for links in emails and share links. */
export async function appOrigin(): Promise<string> {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "localhost:3000";
  const proto = list.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/** Important account changes go to the audit log, with who made them. */
export async function recordAudit(
  ctx: Pick<ClientContext, "organization" | "user">,
  action: string,
  target?: string | null,
  detail?: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();
  await db.insert(auditLog).values({
    organizationId: ctx.organization.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action,
    target: target ?? null,
    detail: detail ?? null,
  });
}

/* Competitors */

export type ComparisonRow = {
  /** Null for the client itself. */
  competitorId: string | null;
  name: string;
  isClient: boolean;
  score: number | null;
  /** Competitor scores come from unconfirmed Fact Sheets. */
  estimate: boolean;
  shareOfVoice: number | null;
  sentiment: SentimentSplit | null;
};

export type TrendSeries = { label: string; emphasis?: boolean; points: { date: Date; value: number | null }[] };

export type CompetitorComparison = {
  /** The client and its competitors, most accurate first. */
  rows: ComparisonRow[];
  /** The competitors the client tracks, by name. */
  tracked: { id: string; name: string; website: string; createdAt: Date; lastScoredAt: Date | null }[];
  /** The client first, then each competitor, on the client's scan dates. */
  trend: TrendSeries[];
  /** When the latest client snapshot was taken. */
  measuredAt: Date | null;
};

/** A competitor snapshot belongs to a client scan date when it was taken up to this long after it. */
const SNAPSHOT_MATCH_MS = 3 * 24 * 60 * 60 * 1000;

export async function getCompetitorComparison(ctx: ClientContext): Promise<CompetitorComparison> {
  const db = await getDb();
  const brandId = ctx.brand.id;

  const [clientRows, tracked, snapshotRows] = await Promise.all([
    db
      .select({
        takenAt: scoreSnapshots.takenAt,
        accuracyScore: scoreSnapshots.accuracyScore,
        shareOfVoice: scoreSnapshots.shareOfVoice,
        sentiment: scoreSnapshots.sentiment,
      })
      .from(scoreSnapshots)
      .where(eq(scoreSnapshots.brandId, brandId))
      .orderBy(desc(scoreSnapshots.takenAt))
      .limit(COMPETITOR_TREND_LENGTH),
    db
      .select({ id: competitors.id, name: competitors.name, website: competitors.website, createdAt: competitors.createdAt })
      .from(competitors)
      .where(eq(competitors.brandId, brandId))
      .orderBy(asc(competitors.name)),
    db
      .select({
        competitorId: competitorSnapshots.competitorId,
        takenAt: competitorSnapshots.takenAt,
        accuracyScore: competitorSnapshots.accuracyScore,
        shareOfVoice: competitorSnapshots.shareOfVoice,
        sentiment: competitorSnapshots.sentiment,
      })
      .from(competitorSnapshots)
      .where(eq(competitorSnapshots.brandId, brandId))
      .orderBy(asc(competitorSnapshots.takenAt)),
  ]);

  const clientTrend = [...clientRows].reverse();
  const current = clientRows[0] ?? null;

  const byCompetitor = new Map<string, typeof snapshotRows>();
  for (const row of snapshotRows) {
    const list = byCompetitor.get(row.competitorId) ?? [];
    list.push(row);
    byCompetitor.set(row.competitorId, list);
  }

  const rows: ComparisonRow[] = [
    {
      competitorId: null,
      name: ctx.brand.name,
      isClient: true,
      score: current?.accuracyScore ?? null,
      estimate: false,
      shareOfVoice: current?.shareOfVoice ?? null,
      sentiment: current?.sentiment ?? null,
    },
    ...tracked.map((competitor) => {
      const list = byCompetitor.get(competitor.id) ?? [];
      const latest = list[list.length - 1];
      return {
        competitorId: competitor.id,
        name: competitor.name,
        isClient: false,
        score: latest?.accuracyScore ?? null,
        estimate: true,
        shareOfVoice: latest?.shareOfVoice ?? null,
        sentiment: latest?.sentiment ?? null,
      };
    }),
  ].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || Number(b.isClient) - Number(a.isClient));

  /* Competitors are scanned alongside the client, so each one is placed on the client's scan dates. */
  const trend: TrendSeries[] = [];
  if (clientTrend.length > 0) {
    trend.push({
      label: ctx.brand.name,
      emphasis: true,
      points: clientTrend.map((s) => ({ date: s.takenAt, value: s.accuracyScore })),
    });
    for (const competitor of tracked) {
      const list = byCompetitor.get(competitor.id) ?? [];
      if (list.length === 0) continue;
      const points = clientTrend.map((s) => {
        const limit = s.takenAt.getTime() + SNAPSHOT_MATCH_MS;
        let value: number | null = null;
        for (const snapshot of list) {
          if (snapshot.takenAt.getTime() > limit) break;
          value = snapshot.accuracyScore;
        }
        return { date: s.takenAt, value };
      });
      if (points.some((p) => p.value !== null)) trend.push({ label: competitor.name, points });
    }
  }

  return {
    rows,
    tracked: tracked.map((competitor) => {
      const list = byCompetitor.get(competitor.id) ?? [];
      return { ...competitor, lastScoredAt: list[list.length - 1]?.takenAt ?? null };
    }),
    trend,
    measuredAt: current?.takenAt ?? null,
  };
}

export async function countCompetitors(brandId: string): Promise<number> {
  const db = await getDb();
  const [{ value }] = await db.select({ value: count() }).from(competitors).where(eq(competitors.brandId, brandId));
  return value;
}

/* Reports */

export type ReportListItem = Pick<Report, "id" | "title" | "type" | "period" | "createdAt" | "shareToken" | "shareExpiresAt"> & {
  periodLabel: string;
};

export async function listReports(ctx: ClientContext): Promise<ReportListItem[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: reports.id,
      title: reports.title,
      type: reports.type,
      period: reports.period,
      createdAt: reports.createdAt,
      shareToken: reports.shareToken,
      shareExpiresAt: reports.shareExpiresAt,
      data: reports.data,
    })
    .from(reports)
    .where(eq(reports.brandId, ctx.brand.id))
    .orderBy(desc(reports.createdAt));
  return rows.map(({ data, ...row }) => ({ ...row, periodLabel: data.periodLabel }));
}

/** A report of the signed-in client's brand, or a 404. */
export async function getReportForClient(ctx: ClientContext, id: string): Promise<Report> {
  if (!isUuid(id)) notFound();
  const db = await getDb();
  const [report] = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
  if (!report || report.brandId !== ctx.brand.id) notFound();
  return report;
}

/** The calendar month before `now`, in the display time zone: its dates, "2026-09" and "September 2026". */
export function lastMonthPeriod(now: Date): { from: Date; to: Date; period: string; label: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: DISPLAY_TIME_ZONE, year: "numeric", month: "numeric" }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const y = month === 1 ? year - 1 : year;
  const m = month === 1 ? 12 : month - 1;
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1) - 1);
  return { from, to, period: `${y}-${String(m).padStart(2, "0")}`, label: formatMonth(new Date(Date.UTC(y, m - 1, 15))) };
}

export async function findMonthlyReport(brandId: string, period: string): Promise<{ id: string } | null> {
  const db = await getDb();
  const [row] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.brandId, brandId), eq(reports.type, "monthly"), eq(reports.period, period)))
    .limit(1);
  return row ?? null;
}

export type ShareStatus = { state: "none" } | { state: "active"; expiresAt: Date | null } | { state: "expired"; expiresAt: Date };

export function shareStatus(report: Pick<Report, "shareToken" | "shareExpiresAt">, now: Date): ShareStatus {
  if (!report.shareToken) return { state: "none" };
  if (report.shareExpiresAt && report.shareExpiresAt.getTime() <= now.getTime()) {
    return { state: "expired", expiresAt: report.shareExpiresAt };
  }
  return { state: "active", expiresAt: report.shareExpiresAt };
}

/** A report opened through its share link. Null when the link does not exist or has expired. */
export async function getSharedReport(token: string, now: Date): Promise<Report | null> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null;
  const db = await getDb();
  const [report] = await db.select().from(reports).where(eq(reports.shareToken, token)).limit(1);
  if (!report) return null;
  if (report.shareExpiresAt && report.shareExpiresAt.getTime() <= now.getTime()) return null;
  return report;
}

/* Team */

export type TeamMember = {
  membershipId: string;
  userId: string;
  name: string;
  title: string | null;
  email: string;
  role: Role;
  lastLoginAt: Date | null;
  joinedAt: Date;
};

export type PendingInvite = {
  id: string;
  email: string;
  role: Role;
  invitedBy: string | null;
  createdAt: Date;
};

const ROLE_ORDER: Record<Role, number> = { owner: 0, member: 1, viewer: 2 };

export async function getTeam(organizationId: string): Promise<{ members: TeamMember[]; invites: PendingInvite[] }> {
  const db = await getDb();
  const [memberRows, inviteRows] = await Promise.all([
    db
      .select({
        membershipId: memberships.id,
        userId: users.id,
        name: users.name,
        title: users.title,
        email: users.email,
        role: memberships.role,
        lastLoginAt: users.lastLoginAt,
        joinedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, organizationId))
      .orderBy(asc(users.name)),
    db
      .select({
        id: invites.id,
        email: invites.email,
        role: invites.role,
        invitedBy: users.name,
        createdAt: invites.createdAt,
      })
      .from(invites)
      .leftJoin(users, eq(users.id, invites.invitedBy))
      .where(and(eq(invites.organizationId, organizationId), isNull(invites.acceptedAt)))
      .orderBy(desc(invites.createdAt)),
  ]);
  memberRows.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));
  return { members: memberRows, invites: inviteRows };
}

/* Alerts */

export async function getAlertsPage(organizationId: string) {
  const db = await getDb();
  const [rules, messages, people] = await Promise.all([
    db.select().from(alertRules).where(eq(alertRules.organizationId, organizationId)).orderBy(asc(alertRules.createdAt)),
    db
      .select({
        id: outbox.id,
        subject: outbox.subject,
        recipient: outbox.recipient,
        channel: outbox.channel,
        status: outbox.status,
        error: outbox.error,
        createdAt: outbox.createdAt,
      })
      .from(outbox)
      .where(eq(outbox.organizationId, organizationId))
      .orderBy(desc(outbox.createdAt))
      .limit(RECENT_MESSAGES),
    db
      .select({ name: users.name, email: users.email, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, organizationId))
      .orderBy(asc(users.name)),
  ]);
  return { rules, messages, people };
}

/* Billing */

export async function getBilling(ctx: ClientContext) {
  const db = await getDb();
  const organizationId = ctx.organization.id;
  const [subscriptionRows, invoiceRows, questionCount, competitorCount, memberCount, inviteCount] = await Promise.all([
    db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, organizationId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1),
    db.select().from(invoices).where(eq(invoices.organizationId, organizationId)).orderBy(desc(invoices.issuedOn), desc(invoices.number)),
    db
      .select({ value: count() })
      .from(questions)
      .where(and(eq(questions.brandId, ctx.brand.id), eq(questions.active, true))),
    db.select({ value: count() }).from(competitors).where(eq(competitors.brandId, ctx.brand.id)),
    db.select({ value: count() }).from(memberships).where(eq(memberships.organizationId, organizationId)),
    db
      .select({ value: count() })
      .from(invites)
      .where(and(eq(invites.organizationId, organizationId), isNull(invites.acceptedAt))),
  ]);
  return {
    subscription: subscriptionRows[0] ?? null,
    invoices: invoiceRows,
    usage: {
      questions: questionCount[0].value,
      competitors: competitorCount[0].value,
      members: memberCount[0].value,
      invites: inviteCount[0].value,
    },
  };
}

/** Seats in use: members plus invitations nobody has accepted yet. */
export async function seatsInUse(organizationId: string): Promise<number> {
  const db = await getDb();
  const [[members], [pending]] = await Promise.all([
    db.select({ value: count() }).from(memberships).where(eq(memberships.organizationId, organizationId)),
    db
      .select({ value: count() })
      .from(invites)
      .where(and(eq(invites.organizationId, organizationId), isNull(invites.acceptedAt))),
  ]);
  return members.value + pending.value;
}
