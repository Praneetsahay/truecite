import { PLATFORM_IDS, type PlatformId } from "@/lib/domain/constants";
import { domainOf } from "@/lib/domain/format";
import {
  answers,
  brands,
  citations,
  competitorSnapshots,
  competitors,
  facts,
  issueEvents,
  issues,
  questions,
  reports,
  scans,
  scoreSnapshots,
  sources,
  statements,
  usageCosts,
} from "../schema";
import { ACME_COMPETITORS, acmeFacts, priceChangeDay, type FactDef } from "./acme-facts";
import { acmeIssueDefs, type Actor, type ScanClock } from "./acme-issues";
import { ACME_QUESTIONS } from "./acme-questions";
import { composeScan, type FactRef, type IssueRef, type QuestionRef } from "./answers";
import {
  competitorRows,
  computeSnapshot,
  dailyTraceRows,
  historicalValues,
  openCountsAt,
  scanUsageRows,
  snapshotRow,
  trendScores,
  type CompetitorProfile,
  type SnapshotValues,
  type TimelineIssue,
} from "./history";
import type { People } from "./people";
import { auditReport, monthlyReport, type CompetitorSeries, type SnapshotPoint } from "./reports";
import { checkerCost } from "./settings";
import { addDays, addMinutes, insertRows, istDay, istTime, monthStart, round, rngFor, shiftDay, tokenFor, type SeedContext } from "./util";

/*
  Acme: the main demo client. A Fact Sheet with former facts, 100 questions, twelve
  weekly scans plus an audit and a re-check, full answers for the latest scan,
  issues 101–119 with their evidence trail, score history and reports.
*/

export type AcmeSummary = {
  brandId: string;
  latestScanId: string;
  score: number | null;
  byPlatform: Partial<Record<PlatformId, number | null>>;
  openCritical: number;
  openHigh: number;
  issueIds: Map<number, string>;
  answers: number;
  statements: number;
  latestCostUsd: number;
};

export async function seedAcme(ctx: SeedContext, people: People): Promise<AcmeSummary> {
  const { db, anchor, anchorDay } = ctx;
  const orgId = people.orgs.acme;
  const brandId = ctx.newId();
  const platforms: PlatformId[] = [...PLATFORM_IDS];
  const runs = 3;

  await insertRows(db, brands, [
    {
      id: brandId,
      organizationId: orgId,
      name: "Acme",
      website: "https://acme.example",
      description: "Payroll and HR software for mid-size companies in India, the UAE and the UK.",
      industry: "HR and payroll software",
      markets: ["IN", "AE", "GB"],
      languages: ["en"],
      platforms,
      scanFrequency: "weekly",
      runsPerQuestion: runs,
      onboardingStep: "done",
      nextScanAt: addDays(anchor, 7),
      createdAt: addDays(anchor, -104),
    },
  ]);

  const competitorIds = new Map<string, string>();
  await insertRows(
    db,
    competitors,
    ACME_COMPETITORS.map((c) => {
      const id = ctx.newId();
      competitorIds.set(c.key, id);
      return { id, brandId, name: c.name, website: c.website, createdAt: addDays(anchor, -104) };
    }),
  );

  // Fact Sheet
  const factRefs: FactRef[] = acmeFacts(anchorDay).map((f: FactDef) => ({ ...f, id: ctx.newId() }));
  const approvedAt = istTime(shiftDay(anchorDay, -93), 15, 30);
  await insertRows(
    db,
    facts,
    factRefs.map((f) => {
      const draft = f.status === "draft";
      const created = draft ? istTime(shiftDay(anchorDay, -1), 8, 10) : f.origin === "manual" ? addDays(approvedAt, 2) : addDays(approvedAt, -1);
      return {
        id: f.id,
        brandId,
        category: f.category,
        statement: f.statement,
        importance: f.importance,
        sourceUrl: f.sourceUrl,
        validFrom: f.validFrom,
        validTo: f.validTo,
        status: f.status,
        origin: f.origin,
        approvedBy: draft ? null : people.users.priya.id,
        approvedAt: draft ? null : f.origin === "manual" ? addDays(approvedAt, 2) : approvedAt,
        createdAt: created,
        updatedAt: f.status === "archived" ? istTime(shiftDay(anchorDay, -40), 11, 0) : created,
      };
    }),
  );
  const factByKey = new Map(factRefs.map((f) => [f.key, f]));

  // Question Set
  const questionRefs: QuestionRef[] = ACME_QUESTIONS.map((q) => ({ ...q, id: ctx.newId() }));
  await insertRows(
    db,
    questions,
    questionRefs.map((q, index) => ({
      id: q.id,
      brandId,
      text: q.text,
      category: q.category,
      language: "en" as const,
      priority: q.priority,
      active: q.active,
      origin: q.origin,
      createdAt: q.origin === "custom" ? istTime(shiftDay(anchorDay, -60), 12, index % 60) : istTime(shiftDay(anchorDay, -94), 10, index % 60),
    })),
  );
  const questionByKey = new Map(questionRefs.map((q) => [q.key, q]));
  const activeCount = questionRefs.filter((q) => q.active).length;

  // Scan clock: the latest weekly scan finished at the anchor.
  const weeklyIds = Array.from({ length: 12 }, () => ctx.newId());
  const auditId = ctx.newId();
  const recheckId = ctx.newId();
  const clock: ScanClock = {
    anchor,
    scan: (i) => addDays(anchor, -7 * i),
    audit: addDays(anchor, -91),
    recheck: istTime(shiftDay(anchorDay, -2), 11, 20),
  };

  // Issues
  const defs = acmeIssueDefs(clock, priceChangeDay(anchorDay));
  const issueRefs: IssueRef[] = defs.map((d) => ({ ...d, id: ctx.newId() }));
  const issueIds = new Map(issueRefs.map((i) => [i.number, i.id]));

  // The latest scan, answered in full.
  const latestStarted = addMinutes(anchor, -40);
  const composed = composeScan({
    scanId: weeklyIds[0],
    brandId,
    startedAt: latestStarted,
    finishedAt: anchor,
    platforms,
    runs,
    questions: questionRefs,
    facts: factRefs,
    issues: issueRefs,
    newId: ctx.newId,
  });
  const checkCost = composed.answers.length * checkerCost({ tokensIn: 1100, tokensOut: 180, searchCalls: 0 });
  const latestCost = round(composed.answerCostUsd + checkCost + composed.answerCostUsd * 0.008, 2);

  // Scans
  const scanRows: (typeof scans.$inferInsert)[] = [];
  const weeklyCost: number[] = [];
  for (let i = 0; i < 12; i++) {
    const rng = rngFor("acme-scan", i);
    const finishedAt = clock.scan(i);
    const startedAt = i === 0 ? latestStarted : addMinutes(finishedAt, -rng.int(36, 47));
    const cost = i === 0 ? latestCost : round(rng.range(22.0, 22.6), 2);
    weeklyCost.push(cost);
    scanRows.push({
      id: weeklyIds[i],
      brandId,
      type: "scheduled",
      status: "completed",
      platforms,
      runsPerQuestion: runs,
      questionCount: activeCount,
      jobsTotal: activeCount * platforms.length * runs,
      jobsDone: activeCount * platforms.length * runs,
      jobsFailed: 0,
      totalCostUsd: cost,
      simulated: false,
      note: i === 0 ? "2 requests to Gemini timed out and succeeded on retry." : null,
      startedAt,
      finishedAt,
      createdAt: addMinutes(startedAt, -1),
    });
  }
  const auditStarted = addMinutes(clock.audit, -72);
  scanRows.push({
    id: auditId,
    brandId,
    type: "audit",
    status: "completed",
    platforms,
    runsPerQuestion: runs,
    questionCount: questionRefs.length,
    jobsTotal: questionRefs.length * platforms.length * runs,
    jobsDone: questionRefs.length * platforms.length * runs,
    jobsFailed: 0,
    totalCostUsd: 27.48,
    triggeredBy: people.users.sam.id,
    note: "Full audit before monitoring started.",
    startedAt: auditStarted,
    finishedAt: clock.audit,
    createdAt: addMinutes(auditStarted, -2),
  });
  scanRows.push({
    id: recheckId,
    brandId,
    type: "recheck",
    status: "completed",
    platforms: ["chatgpt", "perplexity"],
    runsPerQuestion: runs,
    questionCount: 1,
    jobsTotal: 6,
    jobsDone: 6,
    jobsFailed: 0,
    totalCostUsd: 0.09,
    issueId: issueIds.get(101),
    triggeredBy: people.users.karan.id,
    startedAt: clock.recheck,
    finishedAt: addMinutes(clock.recheck, 6),
    createdAt: clock.recheck,
  });
  await insertRows(db, scans, scanRows);

  // Answers, citations and statements of the latest scan.
  await insertRows(db, answers, composed.answers);
  await insertRows(db, citations, composed.citations);
  await insertRows(db, statements, composed.statements);

  // Issue rows, events and sources.
  const actorRef = (actor: Actor) =>
    actor === "system" ? { actorId: null, actorName: "TrueCite" } : { actorId: people.users[actor].id, actorName: people.users[actor].name };
  const userId = (who: Actor | null) => (who && who !== "system" ? people.users[who].id : null);
  const issueRows: (typeof issues.$inferInsert)[] = [];
  const eventRows: (typeof issueEvents.$inferInsert)[] = [];
  const sourceRows: (typeof sources.$inferInsert)[] = [];
  for (const issue of issueRefs) {
    const main = issue.appearances.filter((a) => a.q === issue.questionKey);
    const runsSeen = issue.lastRuns?.seen ?? main.reduce((sum, a) => sum + a.runs.length, 0);
    const runsTotal = issue.lastRuns?.total ?? platforms.length * runs;
    const q = questionByKey.get(issue.questionKey)!;
    const lastEvent = issue.events.reduce((latest, e) => (e.at > latest ? e.at : latest), issue.firstSeenAt);
    const unresolved = issue.status !== "resolved" && issue.reviewState !== "rejected" && !issue.dismissedAt;
    issueRows.push({
      id: issue.id,
      brandId,
      number: issue.number,
      title: issue.title,
      type: issue.type,
      verdict: issue.verdict,
      severity: issue.severity,
      status: issue.status,
      reviewState: issue.reviewState,
      reviewNote: issue.reviewNote ?? null,
      wrongStatement: issue.claim,
      correctStatement: issue.correct,
      factId: issue.factKey ? factByKey.get(issue.factKey)!.id : null,
      questionId: q.id,
      category: q.category,
      platforms: issue.platforms,
      origin: issue.origin,
      confidence: issue.confidence,
      runsSeen,
      runsTotal,
      firstSeenAt: issue.firstSeenAt,
      lastSeenAt: issue.lastSeenAt,
      resolvedAt: issue.resolvedAt,
      assigneeId: userId(issue.assignee),
      cleanScanStreak: issue.cleanScanStreak,
      nextCheckAt: unresolved ? addDays(anchor, 7) : null,
      fixProgress: issue.fixProgress,
      dismissedAt: issue.dismissedAt,
      dismissedBy: userId(issue.dismissedBy),
      dismissNote: issue.dismissNote,
      createdAt: issue.firstSeenAt,
      updatedAt: lastEvent,
    });
    for (const event of [...issue.events].sort((a, b) => a.at.getTime() - b.at.getTime())) {
      eventRows.push({
        id: ctx.newId(),
        issueId: issue.id,
        kind: event.kind,
        fromStatus: event.from ?? null,
        toStatus: event.to ?? null,
        ...actorRef(event.actor),
        note: event.note ?? null,
        createdAt: event.at,
      });
    }
    issue.sources.forEach((source, index) => {
      const rng = rngFor("source", issue.number, index);
      sourceRows.push({
        id: ctx.newId(),
        issueId: issue.id,
        url: source.url,
        title: source.title,
        domain: domainOf(source.url),
        sourceType: source.sourceType,
        containsStatement: source.contains,
        likelihood: source.likelihood,
        publishedLabel: source.published ?? null,
        note: source.note ?? null,
        citedBy: source.citedBy,
        checkedAt: addMinutes(anchor, -rng.int(90, 1300)),
      });
    });
  }
  await insertRows(db, issues, issueRows);
  await insertRows(db, issueEvents, eventRows);
  await insertRows(db, sources, sourceRows);

  // Score history
  const timeline = new Map<number, TimelineIssue>();
  for (const issue of issueRefs) {
    const q = questionByKey.get(issue.questionKey)!;
    timeline.set(issue.number, {
      platforms: issue.platforms,
      category: q.category,
      severity: issue.severity,
      reviewState: issue.reviewState,
      approvedAt: issue.events.find((e) => e.kind === "approved")?.at ?? null,
      dismissedAt: issue.dismissedAt,
      transitions: issue.events.filter((e) => e.kind === "resolved" || e.kind === "reopened").map((e) => ({ at: e.at, kind: e.kind as "resolved" | "reopened" })),
    });
  }
  const timelines = [...timeline.values()];
  const latestOpen = openCountsAt(timelines, anchor);
  const latest = computeSnapshot(composed.scored, platforms, latestOpen);
  const latestScore = latest.accuracyScore ?? 70;

  // Oldest first: the audit, then weekly scans 11 → 1, then the latest.
  const history = [
    { scanId: auditId, takenAt: clock.audit, type: "audit" as const },
    ...Array.from({ length: 11 }, (_, k) => ({ scanId: weeklyIds[11 - k], takenAt: clock.scan(11 - k), type: "scheduled" as const })),
  ];
  const trend = trendScores(history.length, 54.2, latestScore, "acme");
  const snapshotRows: (typeof scoreSnapshots.$inferInsert)[] = [];
  const points: SnapshotPoint[] = [];
  history.forEach((h, k) => {
    const rng = rngFor("acme-snapshot", k);
    const values: SnapshotValues = historicalValues(latest, trend[k], k / history.length, rng);
    const sov = round(0.236 + (0.034 * k) / history.length + rng.range(-0.006, 0.006), 3);
    const row = snapshotRow({ id: ctx.newId(), brandId, scanId: h.scanId, takenAt: h.takenAt, values, open: openCountsAt(timelines, h.takenAt), shareOfVoice: sov });
    snapshotRows.push(row);
    points.push({ takenAt: h.takenAt, score: values.accuracyScore, byPlatform: row.byPlatform!, shareOfVoice: sov, sentiment: values.sentiment, type: h.type });
  });
  const latestRow = snapshotRow({ id: ctx.newId(), brandId, scanId: weeklyIds[0], takenAt: anchor, values: latest, open: latestOpen, shareOfVoice: 0.272 });
  snapshotRows.push(latestRow);
  points.push({ takenAt: anchor, score: latest.accuracyScore, byPlatform: latestRow.byPlatform!, shareOfVoice: 0.272, sentiment: latest.sentiment, type: "scheduled" });
  await insertRows(db, scoreSnapshots, snapshotRows);

  // Competitor estimates
  const profiles: (CompetitorProfile & { name: string })[] = [
    { id: competitorIds.get("northwind")!, name: "Northwind Payroll", score: [80, 83], sentiment: { positive: 0.52, neutral: 0.38, negative: 0.1 }, shareOfVoice: 0.33 },
    { id: competitorIds.get("fabrikam")!, name: "Fabrikam HR", score: [72, 76], sentiment: { positive: 0.44, neutral: 0.45, negative: 0.11 }, shareOfVoice: 0.21 },
    { id: competitorIds.get("contoso")!, name: "Contoso People", score: [64, 69], sentiment: { positive: 0.39, neutral: 0.46, negative: 0.15 }, shareOfVoice: 0.15 },
  ];
  const scanPoints = [...history, { scanId: weeklyIds[0], takenAt: anchor }].map((h) => ({ id: h.scanId, takenAt: h.takenAt }));
  const compRows = competitorRows({ brandId, scans: scanPoints, competitors: profiles, newId: ctx.newId });
  await insertRows(db, competitorSnapshots, compRows);

  // API usage: every scan, plus small daily source-tracing runs.
  const usageRows: (typeof usageCosts.$inferInsert)[] = [];
  const perPlatform = activeCount * runs;
  for (let i = 0; i < 12; i++) {
    usageRows.push(
      ...scanUsageRows({
        organizationId: orgId,
        brandId,
        scanId: weeklyIds[i],
        at: clock.scan(i),
        platforms,
        requestsPerPlatform: perPlatform,
        totalCostUsd: weeklyCost[i],
        exact: i === 0 ? composed.costByPlatform : undefined,
        newId: ctx.newId,
      }),
    );
  }
  usageRows.push(
    ...scanUsageRows({ organizationId: orgId, brandId, scanId: auditId, at: clock.audit, platforms, requestsPerPlatform: questionRefs.length * runs, totalCostUsd: 27.48, newId: ctx.newId }),
    ...scanUsageRows({
      organizationId: orgId,
      brandId,
      scanId: recheckId,
      at: addMinutes(clock.recheck, 6),
      platforms: ["chatgpt", "perplexity"],
      requestsPerPlatform: 3,
      totalCostUsd: 0.09,
      newId: ctx.newId,
    }),
  );
  const scanDays = new Set([...Array.from({ length: 12 }, (_, i) => istDay(clock.scan(i))), istDay(clock.audit), istDay(clock.recheck)]);
  usageRows.push(...dailyTraceRows({ organizationId: orgId, brandId, from: addDays(anchor, -91), to: anchor, skipDays: scanDays, scale: 0.6, newId: ctx.newId }));
  await insertRows(db, usageCosts, usageRows);

  // Reports
  const series: CompetitorSeries[] = profiles.map((p) => ({
    name: p.name,
    points: compRows
      .filter((r) => r.competitorId === p.id)
      .map((r) => ({ takenAt: r.takenAt, score: r.accuracyScore ?? null, shareOfVoice: r.shareOfVoice ?? null, sentiment: r.sentiment ?? null })),
  }));
  const reportCtx = {
    brandName: "Acme",
    website: "https://acme.example",
    platforms,
    runsPerQuestion: runs,
    activeQuestions: activeCount,
    snapshots: points,
    competitors: series,
    issues: issueRefs.map((i) => ({ ...i, timeline: timeline.get(i.number)! })),
    questionText: new Map(questionRefs.map((q) => [q.key, q.text])),
    excerpts: composed.excerpts,
  };
  const lastMonth = monthStart(anchorDay, -1);
  const monthBefore = monthStart(anchorDay, -2);
  const reportRows: (typeof reports.$inferInsert)[] = [
    {
      id: ctx.newId(),
      brandId,
      type: "audit",
      title: "Full audit",
      period: null,
      status: "sent",
      data: auditReport(reportCtx, { startedAt: auditStarted, finishedAt: clock.audit, questions: questionRefs.length }),
      createdAt: addDays(clock.audit, 3),
    },
  ];
  for (const month of [monthBefore, lastMonth]) {
    const recent = month === lastMonth;
    const data = monthlyReport(reportCtx, month);
    reportRows.push({
      id: ctx.newId(),
      brandId,
      type: "monthly",
      title: `Monthly report, ${data.periodLabel}`,
      period: month.slice(0, 7),
      status: "sent",
      data,
      shareToken: recent ? tokenFor(`acme-${month}`) : null,
      shareExpiresAt: recent ? addDays(anchor, 30) : null,
      createdAt: new Date(data.generatedAt),
    });
  }
  await insertRows(db, reports, reportRows);

  const byPlatform: AcmeSummary["byPlatform"] = {};
  for (const p of platforms) byPlatform[p] = latest.byPlatform[p]?.score ?? null;
  return {
    brandId,
    latestScanId: weeklyIds[0],
    score: latest.accuracyScore,
    byPlatform,
    openCritical: latestOpen.critical,
    openHigh: latestOpen.high,
    issueIds,
    answers: composed.answers.length,
    statements: composed.statements.length,
    latestCostUsd: latestCost,
  };
}
