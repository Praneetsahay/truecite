import { alertRules, auditLog, outbox } from "../schema";
import type { People } from "./people";
import { addDays, addMinutes, insertRows, istDay, istTime, monthName, monthStart, shiftDay, type SeedContext } from "./util";

/*
  Alert rules, the outbox of alerts TrueCite sent (logged, as no email provider is
  configured in the demo) and the admin audit log.
*/

const APP = "https://app.truecite.example";

export async function seedActivity(
  ctx: SeedContext,
  people: People,
  acme: { score: number | null; openCritical: number; openHigh: number },
): Promise<void> {
  const { db, anchor, anchorDay } = ctx;
  const { orgs, users } = people;
  const at = (daysFromAnchor: number, hour: number, minute = 0) => istTime(shiftDay(anchorDay, daysFromAnchor), hour, minute);
  const audit = addDays(anchor, -91);
  const auditDay = istDay(audit);

  await insertRows(db, alertRules, [
    {
      id: ctx.newId(),
      organizationId: orgs.acme,
      name: "Critical and high issues",
      channel: "email",
      minimumSeverity: "high",
      frequency: "instant",
      recipients: ["priya@acme.example", "neha@acme.example"],
      active: true,
      createdAt: at(-90, 12, 10),
    },
    {
      id: ctx.newId(),
      organizationId: orgs.acme,
      name: "Weekly digest",
      channel: "email",
      minimumSeverity: "low",
      frequency: "weekly",
      recipients: ["priya@acme.example", "karan@acme.example"],
      active: true,
      createdAt: at(-90, 12, 14),
    },
    {
      id: ctx.newId(),
      organizationId: orgs.acme,
      name: "Critical issues to Slack",
      channel: "slack",
      minimumSeverity: "critical",
      frequency: "instant",
      recipients: ["#comms-alerts"],
      active: false,
      createdAt: at(-60, 15, 30),
    },
    {
      id: ctx.newId(),
      organizationId: orgs.woodgrove,
      name: "Weekly digest",
      channel: "email",
      minimumSeverity: "low",
      frequency: "weekly",
      recipients: ["arjun@woodgrove.example"],
      active: true,
      createdAt: at(-148, 11, 0),
    },
    {
      id: ctx.newId(),
      organizationId: orgs.litware,
      name: "Critical and high issues",
      channel: "email",
      minimumSeverity: "high",
      frequency: "instant",
      recipients: ["emma@litware.example"],
      active: true,
      createdAt: at(-118, 10, 0),
    },
  ]);

  const lastMonth = monthStart(anchorDay, -1);
  const lastMonthLabel = `${monthName(lastMonth)} ${lastMonth.slice(0, 4)}`;
  const weekEnding = istDay(anchor);
  const mail = (recipient: string, subject: string, body: string, createdAt: Date) => ({
    id: ctx.newId(),
    organizationId: orgs.acme,
    channel: "email" as const,
    recipient,
    subject,
    body,
    status: "logged" as const,
    createdAt,
  });
  const reopened = (name: string) =>
    `Hello ${name},\n\nAn issue your team had resolved has come back in this morning's scan.\n\nIssue #106: Old refund policy (30 days)\nSeverity: High\nSeen on ChatGPT in 2 of 3 runs and on Perplexity in 2 of 3 runs.\nWhat AI says: "annual plans can be refunded within 30 days"\nCorrect: Annual plans can be refunded within 14 days of the first payment.\nLikely source: acme.example/legal/refund-policy-2024.pdf, which is still live.\n\nOpen the issue: ${APP}/app/issues/106\n\nTrueCite`;
  const digest = (name: string) =>
    `Hello ${name},\n\nHere is Acme's weekly summary.\n\nAccuracy Score: ${acme.score === null ? "not measured" : Math.round(acme.score)}.\nOpen risks: ${acme.openCritical} critical and ${acme.openHigh} high issues.\nReopened: #106 Old refund policy (30 days).\nStill seen: #101 Wrong price for Basic plan, on ChatGPT in 2 of 3 runs. Perplexity now answers correctly.\nNew issues waiting for review: 3.\n\nOpen the dashboard: ${APP}/app\n\nTrueCite`;

  await insertRows(db, outbox, [
    mail(
      "priya@acme.example",
      "New critical issue: Linked to another company's data breach",
      `Hello Priya,\n\nTrueCite confirmed a new critical issue.\n\nIssue #102: Linked to another company's data breach\nSeen on Perplexity in 3 of 3 runs and on Gemini in 2 of 3 runs.\nWhat AI says: "Acme suffered a data breach in March 2024 that exposed customer records"\nCorrect: Acme has never reported a data breach.\nLikely source: newsdaily.example/2024/03/acme-fintech-data-breach, which is about Acme Fintech Ltd.\n\nOpen the issue: ${APP}/app/issues/102\n\nTrueCite`,
      istTime(shiftDay(auditDay, 1), 9, 51),
    ),
    mail(
      "priya@acme.example",
      "New critical issue: False claim of a wage lawsuit",
      `Hello Priya,\n\nTrueCite confirmed a new critical issue.\n\nIssue #114: False claim of a wage lawsuit\nSeen on Perplexity in 2 of 3 runs.\nWhat AI says: "Acme faced a lawsuit from employees over unpaid wages in 2022"\nCorrect: Acme has no pending lawsuits.\nLikely source: newsdaily.example/2022/acme-builders-wage-dispute, which is about Acme Builders.\n\nOpen the issue: ${APP}/app/issues/114\n\nTrueCite`,
      addMinutes(addDays(anchor, -20), 3 * 60 + 41),
    ),
    mail(
      "priya@acme.example",
      `Your monthly report for ${lastMonthLabel} is ready`,
      `Hello Priya,\n\nAcme's monthly report for ${lastMonthLabel} is ready. It covers the Accuracy Score and its trend, the top open risks, the issues fixed during the month and what to do next.\n\nRead the report: ${APP}/app/reports\n\nTrueCite`,
      istTime(monthStart(anchorDay), 9, 2),
    ),
    mail("priya@acme.example", "Issue reopened: Old refund policy (30 days)", reopened("Priya"), addMinutes(anchor, 4)),
    mail("neha@acme.example", "Issue reopened: Old refund policy (30 days)", reopened("Neha"), addMinutes(anchor, 4)),
    mail("priya@acme.example", `Weekly digest: Acme, week ending ${weekEnding}`, digest("Priya"), addMinutes(anchor, 12)),
    mail("karan@acme.example", `Weekly digest: Acme, week ending ${weekEnding}`, digest("Karan"), addMinutes(anchor, 12)),
  ]);

  const sam = { actorId: users.sam.id, actorName: users.sam.name };
  const priya = { actorId: users.priya.id, actorName: users.priya.name };
  await insertRows(db, auditLog, [
    { id: ctx.newId(), organizationId: orgs.acme, ...sam, action: "Approved issue #101", target: "Issue #101", detail: { number: 101 }, createdAt: istTime(shiftDay(auditDay, 1), 10, 5) },
    { id: ctx.newId(), organizationId: orgs.acme, ...sam, action: "Approved issue #102", target: "Issue #102", detail: { number: 102 }, createdAt: istTime(shiftDay(auditDay, 1), 9, 50) },
    { id: ctx.newId(), organizationId: orgs.acme, ...priya, action: "Changed an alert rule", target: "Critical and high issues", detail: { added: "neha@acme.example" }, createdAt: at(-45, 16, 20) },
    { id: ctx.newId(), organizationId: orgs.acme, ...sam, action: "Approved issue #114", target: "Issue #114", detail: { number: 114 }, createdAt: istTime(shiftDay(istDay(addDays(anchor, -21)), 1), 9, 40) },
    { id: ctx.newId(), organizationId: orgs.acme, ...sam, action: "Rejected issue #118", target: "Issue #118", detail: { number: 118, reason: "Names Acme Fintech Ltd explicitly" }, createdAt: at(-13, 10, 0) },
    { id: ctx.newId(), organizationId: null, ...sam, action: "Changed the checker model", target: "Settings", detail: { from: "claude-sonnet-5-5", to: "claude-haiku-5-5" }, createdAt: at(-12, 18, 5) },
    { id: ctx.newId(), organizationId: orgs.acme, ...priya, action: "Marked issue #119 as not an error", target: "Issue #119", detail: { number: 119 }, createdAt: at(-10, 12, 15) },
    { id: ctx.newId(), organizationId: orgs.woodgrove, ...sam, action: "Viewed Woodgrove Bank as a client", target: "Woodgrove Bank", detail: { reason: "Support: failed Gemini jobs" }, createdAt: at(-3, 11, 5) },
    { id: ctx.newId(), organizationId: orgs.woodgrove, ...sam, action: "Stopped viewing Woodgrove Bank as a client", target: "Woodgrove Bank", detail: null, createdAt: at(-3, 11, 23) },
    { id: ctx.newId(), organizationId: orgs.prospects, ...sam, action: "Created a prospect report", target: "Trey Research", detail: null, createdAt: at(-1, 17, 10) },
  ]);
}
