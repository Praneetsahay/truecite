import type { IssueStatus, PlatformId } from "@/lib/domain/constants";
import { SEVERITY_ORDER } from "@/lib/domain/constants";
import { displayUrl, listJoin } from "@/lib/domain/format";
import { PLAYBOOK } from "@/lib/domain/playbook";
import { METHOD_NOTES, type ReportData, type ReportFinding } from "@/lib/domain/report";
import type { PlatformBreakdown, SentimentSplit } from "../schema";
import type { IssueRef } from "./answers";
import { isOpenAt, openCountsAt, type TimelineIssue } from "./history";
import { istDay, istTime, monthEnd, monthName, monthStart, round, shiftDay, shortDate } from "./util";

/*
  Acme's monthly reports and the full audit. Each is a frozen ReportData built from
  the same issues, snapshots and answers the app shows, as they stood at the time.
*/

export type SnapshotPoint = {
  takenAt: Date;
  score: number | null;
  byPlatform: PlatformBreakdown;
  shareOfVoice: number | null;
  sentiment: SentimentSplit | null;
  type: "scheduled" | "audit";
};

export type CompetitorSeries = {
  name: string;
  points: { takenAt: Date; score: number | null; shareOfVoice: number | null; sentiment: SentimentSplit | null }[];
};

export type ReportContext = {
  brandName: string;
  website: string;
  platforms: PlatformId[];
  runsPerQuestion: number;
  activeQuestions: number;
  snapshots: SnapshotPoint[];
  competitors: CompetitorSeries[];
  issues: (IssueRef & { timeline: TimelineIssue })[];
  questionText: Map<string, string>;
  excerpts: Map<number, { text: string; platform: PlatformId }>;
};

/** The issue's status at time t, replayed from its evidence trail. */
export function statusAt(issue: IssueRef, t: Date): IssueStatus {
  let status: IssueStatus = "open";
  for (const event of issue.events) {
    if (event.at > t) continue;
    if (event.kind === "status" && event.to) status = event.to;
    if (event.kind === "resolved") status = "resolved";
    if (event.kind === "reopened") status = "reopened";
  }
  return status;
}

function finding(ctx: ReportContext, issue: IssueRef, t: Date): ReportFinding {
  const example = ctx.excerpts.get(issue.number) ?? issue.excerpt ?? null;
  let answer: ReportFinding["answer"] = null;
  if (example) {
    const start = example.text.indexOf(issue.claim);
    if (start >= 0) answer = { text: example.text, wrongStart: start, wrongEnd: start + issue.claim.length, platform: example.platform };
  }
  return {
    issueNumber: issue.number,
    title: issue.title,
    severity: issue.severity,
    status: statusAt(issue, t),
    platforms: issue.platforms,
    question: ctx.questionText.get(issue.questionKey) ?? "",
    answer,
    wrong: issue.claim,
    correct: issue.correct,
    likelySources: issue.sources.filter((s) => s.likelihood === "likely" || s.contains).map((s) => displayUrl(s.url)),
    fix: [...PLAYBOOK[issue.type].steps],
  };
}

function topRisks(ctx: ReportContext, t: Date, limit: number): IssueRef[] {
  return ctx.issues
    .filter((issue) => isOpenAt(issue.timeline, t))
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.number - b.number)
    .slice(0, limit);
}

function competitorList(ctx: ReportContext, t: Date, client: SnapshotPoint | undefined): ReportData["competitors"] {
  const list: ReportData["competitors"] = [
    {
      name: ctx.brandName,
      isClient: true,
      score: client?.score ?? null,
      estimate: false,
      shareOfVoice: client?.shareOfVoice ?? null,
      sentiment: client?.sentiment ?? null,
    },
  ];
  for (const c of ctx.competitors) {
    const point = [...c.points].filter((p) => p.takenAt <= t).pop();
    list.push({
      name: c.name,
      score: point?.score ?? null,
      estimate: true,
      shareOfVoice: point?.shareOfVoice ?? null,
      sentiment: point?.sentiment ?? null,
    });
  }
  return list;
}

function byPlatform(ctx: ReportContext, point: SnapshotPoint | undefined, t: Date): ReportData["byPlatform"] {
  const open = openCountsAt(
    ctx.issues.map((i) => i.timeline),
    t,
  );
  return ctx.platforms.map((platform) => ({
    platform,
    score: point?.byPlatform[platform]?.score ?? null,
    openIssues: open.byPlatform[platform] ?? 0,
  }));
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The monthly report for the calendar month containing `anyDay`. */
export function monthlyReport(ctx: ReportContext, anyDay: string): ReportData {
  const from = monthStart(anyDay);
  const to = monthEnd(anyDay);
  const start = istTime(from, 0, 0);
  const end = istTime(shiftDay(to, 1), 0, 0);
  const month = `${monthName(from)} ${from.slice(0, 4)}`;

  const upToEnd = ctx.snapshots.filter((s) => s.takenAt < end);
  const current = upToEnd[upToEnd.length - 1];
  const previous = [...ctx.snapshots].filter((s) => s.takenAt < start).pop();
  const scansInMonth = ctx.snapshots.filter((s) => s.takenAt >= start && s.takenAt < end && s.type === "scheduled").length;
  const open = openCountsAt(
    ctx.issues.map((i) => i.timeline),
    end,
  );
  const risks = topRisks(ctx, end, 4);
  const fixed = ctx.issues.flatMap((issue) =>
    issue.timeline.transitions
      .filter((e) => e.kind === "resolved" && e.at >= start && e.at < end)
      .map((e) => ({ title: issue.title, resolvedOn: istDay(e.at), platforms: issue.platforms })),
  );

  const cur = current?.score ?? null;
  const prev = previous?.score ?? null;
  let first: string;
  if (cur !== null && prev !== null) {
    const a = Math.round(prev);
    const b = Math.round(cur);
    first =
      b > a
        ? `${ctx.brandName}'s Accuracy Score rose from ${a} to ${b} in ${monthName(from)}.`
        : b < a
          ? `${ctx.brandName}'s Accuracy Score fell from ${a} to ${b} in ${monthName(from)}.`
          : `${ctx.brandName}'s Accuracy Score held at ${b} in ${monthName(from)}.`;
  } else {
    first = `${ctx.brandName}'s Accuracy Score was ${cur === null ? "not yet measured" : Math.round(cur)} in ${monthName(from)}.`;
  }
  const second = risks.length
    ? `At the end of the month ${open.critical} critical and ${open.high} high issues were open, led by "${risks[0].title}".`
    : "No critical or high issues were open at the end of the month.";
  const inProgress = ctx.issues.filter((i) => isOpenAt(i.timeline, end) && statusAt(i, end) !== "open").length;
  const third = fixed.length
    ? `The team resolved ${fixed.length === 1 ? "one issue" : `${fixed.length} issues`}: ${listJoin(fixed.map((f) => lowerFirst(f.title)))}.`
    : `No issues were resolved this month, and work is under way on ${inProgress === 1 ? "one issue" : `${inProgress} issues`}.`;

  const nextSteps = risks.map((r) => r.nextStep).filter(Boolean);
  if (nextSteps.length < 3) nextSteps.push("Review the Fact Sheet and approve the draft facts so new answers are checked against them.");
  if (nextSteps.length < 4) nextSteps.push("Share this report with leadership and agree owners for the open critical issues.");

  const generated = istTime(shiftDay(to, 1), 9, 0);
  return {
    type: "monthly",
    brandName: ctx.brandName,
    website: ctx.website,
    periodLabel: month,
    generatedAt: generated.toISOString(),
    summary: `${first} ${second} ${third}`,
    score: {
      current: cur,
      previous: prev,
      trend: upToEnd.filter((s) => s.score !== null).map((s) => ({ date: istDay(s.takenAt), score: s.score as number })),
    },
    openRisks: { critical: open.critical, high: open.high },
    byPlatform: byPlatform(ctx, current, end),
    topRisks: risks.map((issue) => finding(ctx, issue, end)),
    fixed,
    nextSteps: nextSteps.slice(0, 4),
    competitors: competitorList(ctx, end, current),
    method: {
      from,
      to,
      platforms: ctx.platforms,
      questions: ctx.activeQuestions,
      runsPerQuestion: ctx.runsPerQuestion,
      scans: scansInMonth,
      notes: [...METHOD_NOTES],
    },
  };
}

/** The one-time full audit, as it stood when the audit scan finished. */
export function auditReport(ctx: ReportContext, audit: { startedAt: Date; finishedAt: Date; questions: number }): ReportData {
  const point = ctx.snapshots.find((s) => s.type === "audit");
  // Findings as the admin approved them, the day after the scan.
  const t = new Date(audit.finishedAt.getTime() + 2 * 24 * 3_600_000);
  const found = ctx.issues.filter((i) => i.firstSeenAt.getTime() === audit.finishedAt.getTime() && i.reviewState === "approved");
  const risks = [...found]
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.number - b.number)
    .slice(0, 5);
  const critical = found.filter((i) => i.severity === "critical").length;
  const high = found.filter((i) => i.severity === "high").length;
  const ahead = ctx.competitors
    .map((c) => ({ name: c.name, score: [...c.points].filter((p) => p.takenAt <= t).pop()?.score ?? null }))
    .filter((c) => c.score !== null && point?.score != null && c.score > point.score)
    .map((c) => c.name);
  const score = point?.score ?? null;
  const day = istDay(audit.finishedAt);

  return {
    type: "audit",
    brandName: ctx.brandName,
    website: ctx.website,
    periodLabel: `Audit, ${shortDate(day)}`,
    generatedAt: new Date(audit.finishedAt.getTime() + 3 * 24 * 3_600_000).toISOString(),
    summary: [
      `The full audit found ${found.length} confirmed errors in what AI assistants tell people about ${ctx.brandName}, ${critical} of them critical and ${high} high.`,
      risks.length ? `The most serious is "${risks[0].title}", which comes from news about a different company with a similar name.` : "",
      score !== null
        ? `${ctx.brandName}'s Accuracy Score was ${Math.round(score)}${ahead.length ? `, below the estimates for ${listJoin(ahead)}` : ""}.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    score: { current: score, previous: null, trend: score === null ? [] : [{ date: day, score }] },
    openRisks: { critical, high },
    byPlatform: ctx.platforms.map((platform) => ({
      platform,
      score: point?.byPlatform[platform]?.score ?? null,
      openIssues: found.filter((i) => i.platforms.includes(platform)).length,
    })),
    topRisks: risks.map((issue) => ({ ...finding(ctx, issue, t), status: "open" as IssueStatus })),
    fixed: [],
    nextSteps: [
      ...risks.slice(0, 3).map((r) => r.nextStep),
      "Start weekly monitoring so every fix is re-checked and progress is visible per platform.",
    ],
    competitors: competitorList(ctx, t, point),
    method: {
      from: istDay(audit.startedAt),
      to: day,
      platforms: ctx.platforms,
      questions: audit.questions,
      runsPerQuestion: ctx.runsPerQuestion,
      scans: 1,
      notes: [...METHOD_NOTES],
    },
  };
}

export function roundShare(value: number): number {
  return round(value, 3);
}
