import "server-only";
import { and, eq, gte, inArray, isNull, like } from "drizzle-orm";
import {
  alertRules,
  brands,
  getDb,
  issueEvents,
  issues,
  organizations,
  outbox,
  questions,
  type AlertRule,
  type Issue,
} from "@/lib/db";
import { ISSUE_STATUSES, PLATFORMS, SEVERITY_ORDER, UNRESOLVED_STATUSES, IMPORTANCE, type Severity } from "@/lib/domain/constants";
import { formatDate, listJoin } from "@/lib/domain/format";
import { compareSeverity } from "@/lib/domain/severity";
import { sendEmail } from "./email";
import { getSettings } from "./settings";

/*
  Alerts follow the client's alert rules: new issues at or above a rule's
  minimum severity are emailed straight away, and weekly rules get a plain
  digest of new and open issues at most once every 7 days.
*/

export const DIGEST_SUBJECT_PREFIX = "Weekly digest";
const DIGEST_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export function appUrl(): string {
  return (process.env.APP_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
}

/** True when the issue is at least as severe as the rule's minimum. */
function meetsMinimum(issueSeverity: Severity, minimum: Severity): boolean {
  return compareSeverity(issueSeverity, minimum) <= 0;
}

function platformNames(ids: readonly string[]): string {
  return listJoin(ids.map((id) => PLATFORMS[id as keyof typeof PLATFORMS]?.name ?? id));
}

/** Emails one alert per recipient for a newly visible issue. Returns how many emails were sent or logged. */
export async function sendInstantAlerts(issueId: string): Promise<{ emails: number }> {
  const settings = await getSettings();
  if (!settings.features.instantAlerts) return { emails: 0 };
  const db = await getDb();
  const [row] = await db
    .select({ issue: issues, brandName: brands.name, organizationId: brands.organizationId, question: questions.text })
    .from(issues)
    .innerJoin(brands, eq(brands.id, issues.brandId))
    .leftJoin(questions, eq(questions.id, issues.questionId))
    .where(eq(issues.id, issueId))
    .limit(1);
  if (!row || row.issue.reviewState !== "approved" || row.issue.dismissedAt) return { emails: 0 };

  const rules = await db
    .select()
    .from(alertRules)
    .where(
      and(
        eq(alertRules.organizationId, row.organizationId),
        eq(alertRules.active, true),
        eq(alertRules.frequency, "instant"),
        eq(alertRules.channel, "email"),
      ),
    );

  const issue = row.issue;
  const recipients = new Map<string, AlertRule>();
  for (const rule of rules) {
    if (!meetsMinimum(issue.severity, rule.minimumSeverity)) continue;
    for (const recipient of rule.recipients) {
      const email = recipient.trim().toLowerCase();
      if (email && !recipients.has(email)) recipients.set(email, rule);
    }
  }

  const severityWord = IMPORTANCE[issue.severity].label.toLowerCase();
  const subject = `New ${severityWord} issue: ${issue.title}`;
  let emails = 0;
  for (const [to, rule] of recipients) {
    const body = [
      `TrueCite found a new ${severityWord} issue for ${row.brandName}.`,
      "",
      issue.title,
      "",
      ...(row.question ? [`Question: ${row.question}`] : []),
      `Seen on: ${platformNames(issue.platforms) || "not recorded"}`,
      `What the AI said: "${issue.wrongStatement}"`,
      `Correct fact: ${issue.correctStatement}`,
      "",
      `Open the issue: ${appUrl()}/app/issues/${issue.number}`,
      "",
      `You get this email because of the alert rule "${rule.name}". An owner can change alerts in TrueCite under Settings.`,
    ].join("\n");
    await sendEmail({ organizationId: row.organizationId, to, subject, body });
    emails += 1;
  }
  return { emails };
}

function digestLine(issue: Pick<Issue, "number" | "title" | "severity" | "status" | "platforms">, withStatus: boolean): string {
  const parts = [`#${issue.number} ${issue.title}`, IMPORTANCE[issue.severity].label];
  if (issue.platforms.length) parts.push(platformNames(issue.platforms));
  if (withStatus) parts.push(ISSUE_STATUSES[issue.status].label);
  return `- ${parts.join(". ")}.`;
}

function bySeverity<T extends Pick<Issue, "severity" | "number">>(a: T, b: T): number {
  return compareSeverity(a.severity, b.severity) || a.number - b.number;
}

/**
 * Weekly digests for rules with frequency "weekly": new and open issues at or
 * above the rule's minimum severity. Each recipient gets at most one digest per
 * 7 days, tracked through the outbox.
 */
export async function sendWeeklyDigests(now: Date): Promise<{ rules: number; emails: number }> {
  const db = await getDb();
  const since = new Date(now.getTime() - DIGEST_INTERVAL_MS);
  const rules = await db
    .select({ rule: alertRules })
    .from(alertRules)
    .innerJoin(organizations, eq(organizations.id, alertRules.organizationId))
    .where(
      and(
        eq(alertRules.active, true),
        eq(alertRules.frequency, "weekly"),
        eq(alertRules.channel, "email"),
        eq(organizations.internal, false),
      ),
    );

  let emails = 0;
  for (const { rule } of rules) {
    if (rule.recipients.length === 0) continue;
    const severities = SEVERITY_ORDER.filter((s) => meetsMinimum(s, rule.minimumSeverity));
    const brandRows = await db.select({ id: brands.id, name: brands.name }).from(brands).where(eq(brands.organizationId, rule.organizationId));
    if (brandRows.length === 0) continue;
    const brandIds = brandRows.map((b) => b.id);
    const visible = and(
      inArray(issues.brandId, brandIds),
      eq(issues.reviewState, "approved"),
      isNull(issues.dismissedAt),
      inArray(issues.severity, severities),
    );

    const [openRows, newRows] = await Promise.all([
      db.select().from(issues).where(and(visible, inArray(issues.status, [...UNRESOLVED_STATUSES]))),
      db
        .selectDistinct({ id: issues.id })
        .from(issueEvents)
        .innerJoin(issues, eq(issues.id, issueEvents.issueId))
        .where(and(visible, inArray(issueEvents.kind, ["approved", "detected", "reopened"]), gte(issueEvents.createdAt, since))),
    ]);
    const newIds = new Set(newRows.map((r) => r.id));
    const fresh = openRows.filter((issue) => newIds.has(issue.id)).sort(bySeverity);
    const stillOpen = openRows.filter((issue) => !newIds.has(issue.id)).sort(bySeverity);
    if (fresh.length === 0 && stillOpen.length === 0) continue;

    const brandName = brandRows.length === 1 ? brandRows[0].name : listJoin(brandRows.map((b) => b.name));
    const subject = `${DIGEST_SUBJECT_PREFIX}: ${brandName}, ${fresh.length} new, ${stillOpen.length + fresh.length} open`;
    const body = [
      `Your weekly TrueCite summary for ${brandName}, ${formatDate(since)} to ${formatDate(now)}.`,
      "",
      `New this week (${fresh.length})`,
      ...(fresh.length ? fresh.map((issue) => digestLine(issue, false)) : ["- Nothing new."]),
      "",
      `Still open (${stillOpen.length})`,
      ...(stillOpen.length ? stillOpen.map((issue) => digestLine(issue, true)) : ["- Nothing else open."]),
      "",
      `Open the issues: ${appUrl()}/app/issues`,
      "",
      `You get this digest because of the alert rule "${rule.name}". An owner can change alerts in TrueCite under Settings.`,
    ]
      .join("\n")
      .replace(/ /g, " ");

    for (const recipient of rule.recipients) {
      const to = recipient.trim().toLowerCase();
      if (!to) continue;
      const [recent] = await db
        .select({ id: outbox.id })
        .from(outbox)
        .where(
          and(
            eq(outbox.recipient, to),
            eq(outbox.organizationId, rule.organizationId),
            like(outbox.subject, `${DIGEST_SUBJECT_PREFIX}:%`),
            gte(outbox.createdAt, since),
          ),
        )
        .limit(1);
      if (recent) continue;
      await sendEmail({ organizationId: rule.organizationId, to, subject, body });
      emails += 1;
    }
  }
  return { rules: rules.length, emails };
}
