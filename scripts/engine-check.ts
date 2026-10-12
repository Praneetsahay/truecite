/*
  Checks the scanning engine end to end against a throwaway database: a manual
  scan of Acme's key questions on all four platforms, the worker, the checker,
  issues, snapshots, source tracing, review and alerts, a re-check of issue 101,
  failure and retry, cancelling, scheduled scans and weekly digests.

  npx --yes tsx --conditions=react-server scripts/engine-check.ts

  It uses its own PGlite folder (.data/engine-check, deleted first), so it never
  touches the dev database. Without API keys the simulator and the deterministic
  checker run. When the demo seed is not in place yet, it creates the few
  records it needs itself.
*/
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), ".data", "engine-check");
fs.rmSync(DIR, { recursive: true, force: true });
process.env.PGLITE_DIR = DIR;
process.env.SIMULATOR_LATENCY_MS ??= "120";
// Source tracing would try to fetch real URLs; .example domains are skipped without a request.
const DAY = 86_400_000;

let failures = 0;
function check(condition: boolean, label: string) {
  console.log(`  ${condition ? "ok  " : "FAIL"} ${label}`);
  if (!condition) failures++;
}
function heading(text: string) {
  console.log(`\n${text}`);
}
function line(label: string, value: unknown) {
  console.log(`  ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

async function main() {
  const db = await import("../src/lib/db");
  const { and, asc, desc, eq, gte, ilike, inArray, sql } = await import("drizzle-orm");
  const engine = await import("../src/lib/engine");
  const worker = await import("../src/lib/engine/worker");
  const { runPipeline } = await import("../src/lib/engine/pipeline");
  const { sendWeeklyDigests } = await import("../src/lib/engine/alerts");
  const started = Date.now();
  const conn = await db.getDb();
  console.log(`Opened, migrated and seeded the check database in ${((Date.now() - started) / 1000).toFixed(1)} s.`);

  /* Fixtures, only when the demo seed has not created them. */
  let [acme] = await conn.select().from(db.brands).where(ilike(db.brands.name, "Acme")).limit(1);
  const seeded = Boolean(acme);
  if (!acme) {
    console.log("  The demo seed is not in place yet: creating Acme for this check.");
    acme = await createAcmeFixture();
  }
  const [priya] = await conn.select().from(db.users).where(eq(db.users.email, "priya@acme.example")).limit(1);
  const [admin] = await conn.select().from(db.users).where(eq(db.users.isAdmin, true)).limit(1);
  const rules = await conn.select({ id: db.alertRules.id }).from(db.alertRules).where(eq(db.alertRules.organizationId, acme.organizationId));
  if (rules.length === 0) {
    console.log("  The seed has no alert rules yet: adding an instant and a weekly rule for this check.");
    await conn.insert(db.alertRules).values([
      { organizationId: acme.organizationId, name: "Critical and high issues", minimumSeverity: "high", frequency: "instant", recipients: ["priya@acme.example"] },
      { organizationId: acme.organizationId, name: "Weekly summary", minimumSeverity: "low", frequency: "weekly", recipients: ["priya@acme.example", "karan@acme.example"] },
    ]);
  }

  async function createAcmeFixture() {
    const { acmeFacts, ACME_COMPETITORS } = await import("../src/lib/db/seed/acme-facts");
    const { ACME_QUESTIONS } = await import("../src/lib/db/seed/acme-questions");
    const now = new Date();
    const anchorDay = now.toISOString().slice(0, 10);
    const [org] = await conn.insert(db.organizations).values({ name: "Acme", plan: "professional", country: "IN", currency: "INR" }).returning();
    await conn.insert(db.users).values([
      { name: "Priya Sharma", email: "priya@acme.example", passwordHash: "x" },
      { name: "Sam Admin", email: "admin@truecite.example", passwordHash: "x", isAdmin: true },
    ]);
    const [owner] = await conn.select().from(db.users).where(eq(db.users.email, "priya@acme.example"));
    await conn.insert(db.memberships).values({ userId: owner.id, organizationId: org.id, role: "owner" });
    const [brand] = await conn
      .insert(db.brands)
      .values({
        organizationId: org.id,
        name: "Acme",
        website: "https://acme.example",
        industry: "Payroll and HR software",
        markets: ["IN"],
        platforms: ["chatgpt", "gemini", "perplexity", "claude"],
        scanFrequency: "weekly",
        runsPerQuestion: 3,
        onboardingStep: "done",
        nextScanAt: new Date(now.getTime() + 3 * DAY),
      })
      .returning();
    const factDefs = acmeFacts(anchorDay);
    const factRows = await conn
      .insert(db.facts)
      .values(
        factDefs.map((f) => ({
          brandId: brand.id,
          category: f.category,
          statement: f.statement,
          importance: f.importance,
          sourceUrl: f.sourceUrl,
          validFrom: f.validFrom,
          validTo: f.validTo,
          status: f.status,
          origin: f.origin,
        })),
      )
      .returning({ id: db.facts.id, statement: db.facts.statement });
    const factId = (key: string) => factRows[factDefs.findIndex((f) => f.key === key)]?.id ?? null;
    const questionRows = await conn
      .insert(db.questions)
      .values(ACME_QUESTIONS.map((q) => ({ brandId: brand.id, text: q.text, category: q.category, priority: q.priority, active: q.active, origin: q.origin })))
      .returning({ id: db.questions.id, text: db.questions.text });
    const questionId = (key: string) => questionRows[ACME_QUESTIONS.findIndex((q) => q.key === key)]?.id ?? null;
    await conn.insert(db.competitors).values(ACME_COMPETITORS.map((c) => ({ brandId: brand.id, name: c.name, website: c.website })));
    await conn.insert(db.alertRules).values([
      { organizationId: org.id, name: "Critical and high issues", minimumSeverity: "high", frequency: "instant", recipients: ["priya@acme.example"] },
      { organizationId: org.id, name: "Weekly summary", minimumSeverity: "low", frequency: "weekly", recipients: ["priya@acme.example", "karan@acme.example"] },
    ]);
    const [issue] = await conn
      .insert(db.issues)
      .values({
        brandId: brand.id,
        number: 101,
        title: "Wrong price for Basic plan",
        type: "wrong_price",
        verdict: "outdated",
        severity: "critical",
        status: "fixed_rechecking",
        reviewState: "approved",
        wrongStatement: "The Basic plan costs $49 per month.",
        correctStatement: "The Basic plan costs $79 per month.",
        factId: factId("price_basic_usd"),
        questionId: questionId("p_basic"),
        category: "pricing",
        platforms: ["chatgpt", "gemini"],
        origin: "web",
        confidence: 0.94,
        runsSeen: 4,
        runsTotal: 6,
        firstSeenAt: new Date(now.getTime() - 40 * DAY),
        lastSeenAt: new Date(now.getTime() - 7 * DAY),
        cleanScanStreak: 1,
      })
      .returning();
    await conn.insert(db.issueEvents).values({ issueId: issue.id, kind: "detected", actorName: "TrueCite", note: "Seen in 2 of 3 runs on ChatGPT and 2 of 3 on Gemini." });
    return brand;
  }

  const allPlatforms = ["chatgpt", "gemini", "perplexity", "claude"] as const;
  const keyQuestions = await conn
    .select({ id: db.questions.id })
    .from(db.questions)
    .where(and(eq(db.questions.brandId, acme.id), eq(db.questions.priority, "key"), eq(db.questions.active, true)));
  line("seed", seeded ? "demo seed" : "fixture created by this script");
  line("key questions", keyQuestions.length);

  // Seeded scans with queued jobs (Litware) run on the same worker.
  const unfinishedBefore = await conn
    .select({ id: db.scans.id, brandId: db.scans.brandId, status: db.scans.status, jobsTotal: db.scans.jobsTotal })
    .from(db.scans)
    .where(inArray(db.scans.status, ["queued", "running", "checking"]));
  line("unfinished scans in the seed", unfinishedBefore.length);

  /* 1. A manual scan of the key questions on all four platforms, one run each. */
  heading("Manual scan: Acme, key questions, four platforms, 1 run");
  const scanStart = new Date();
  const issuesBefore = await conn.select({ id: db.issues.id, number: db.issues.number }).from(db.issues).where(eq(db.issues.brandId, acme.id));
  const outboxBefore = await conn.select({ id: db.outbox.id }).from(db.outbox);
  const { scanId } = await engine.startScan({
    brandId: acme.id,
    type: "manual",
    platforms: [...allPlatforms],
    runsPerQuestion: 1,
    questionIds: keyQuestions.map((q) => q.id),
    triggeredBy: priya?.id ?? null,
  });
  const again = await engine.startScan({ brandId: acme.id, type: "manual", runsPerQuestion: 1, questionIds: keyQuestions.map((q) => q.id) });
  check(again.scanId === scanId, "starting the same scan twice while it runs returns the running scan");
  const t0 = Date.now();
  const scan = await worker.waitForScan(scanId);
  line("finished in", `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  line("status", scan.status + (scan.error ? ` (${scan.error})` : ""));
  line("jobs done / failed / total", `${scan.jobsDone} / ${scan.jobsFailed} / ${scan.jobsTotal}`);
  line("simulated", scan.simulated);
  line("cost USD", scan.totalCostUsd);
  check(scan.status === "completed", "scan completed");
  check(scan.jobsDone === keyQuestions.length * 4 && scan.jobsFailed === 0, "every job answered");

  const answerCount = await conn.select({ n: sql<number>`count(*)::int` }).from(db.answers).where(eq(db.answers.scanId, scanId));
  line("answers", answerCount[0].n);
  check(answerCount[0].n === scan.jobsDone, "one answer per job");
  const byVerdict = await conn
    .select({ verdict: db.statements.verdict, n: sql<number>`count(*)::int` })
    .from(db.statements)
    .innerJoin(db.answers, eq(db.answers.id, db.statements.answerId))
    .where(eq(db.answers.scanId, scanId))
    .groupBy(db.statements.verdict);
  line("statements by verdict", Object.fromEntries(byVerdict.map((r) => [r.verdict, r.n])));
  const spans = await conn
    .select({ withSpan: sql<number>`count(${db.statements.spanStart})::int`, total: sql<number>`count(*)::int` })
    .from(db.statements)
    .innerJoin(db.answers, eq(db.answers.id, db.statements.answerId))
    .where(eq(db.answers.scanId, scanId));
  line("statements with an exact span", `${spans[0].withSpan} of ${spans[0].total}`);
  const intermittent = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(db.statements)
    .innerJoin(db.answers, eq(db.answers.id, db.statements.answerId))
    .where(and(eq(db.answers.scanId, scanId), eq(db.statements.intermittent, true)));
  line("intermittent statements", intermittent[0].n);

  const beforeIds = new Set(issuesBefore.map((i) => i.id));
  const issuesAfter = await conn.select().from(db.issues).where(eq(db.issues.brandId, acme.id)).orderBy(asc(db.issues.number));
  const created = issuesAfter.filter((i) => !beforeIds.has(i.id));
  const updated = issuesAfter.filter((i) => beforeIds.has(i.id) && i.lastSeenAt >= scanStart);
  const events = await conn
    .select({ kind: db.issueEvents.kind, number: db.issues.number })
    .from(db.issueEvents)
    .innerJoin(db.issues, eq(db.issues.id, db.issueEvents.issueId))
    .where(and(eq(db.issues.brandId, acme.id), gte(db.issueEvents.createdAt, scanStart)));
  const eventsOf = (kind: string) => events.filter((e) => e.kind === kind).map((e) => e.number);
  line("issues created", created.map((i) => `#${i.number} ${i.title} (${i.verdict}, ${i.severity}, ${i.reviewState}, ${i.origin}, ${i.runsSeen}/${i.runsTotal})`));
  line("issues updated", updated.map((i) => i.number));
  line("resolved", eventsOf("resolved"));
  line("reopened", eventsOf("reopened"));
  line("events written", Object.fromEntries([...new Set(events.map((e) => e.kind))].map((k) => [k, eventsOf(k).length])));
  check(created.every((i) => eventsOf("detected").includes(i.number)), "every new issue has a detected event");
  check(new Set(issuesAfter.map((i) => i.number)).size === issuesAfter.length, "issue numbers are unique");

  const [snapshot] = await conn.select().from(db.scoreSnapshots).where(eq(db.scoreSnapshots.scanId, scanId)).limit(1);
  line(
    "new snapshot",
    snapshot
      ? { score: snapshot.accuracyScore, statements: snapshot.statementsChecked, open: snapshot.openTotal, critical: snapshot.openCritical, shareOfVoice: snapshot.shareOfVoice, sentiment: snapshot.sentiment }
      : null,
  );
  check(Boolean(snapshot && snapshot.accuracyScore !== null), "score snapshot written");
  const sourceRows = await conn
    .select({ domain: db.sources.domain, type: db.sources.sourceType, note: db.sources.note, contains: db.sources.containsStatement })
    .from(db.sources)
    .innerJoin(db.issues, eq(db.issues.id, db.sources.issueId))
    .where(and(eq(db.issues.brandId, acme.id), gte(db.sources.checkedAt, scanStart)));
  line("sources upserted", sourceRows.length);
  if (sourceRows.length) line("source sample", sourceRows.slice(0, 3));
  const usage = await conn
    .select({ purpose: db.usageCosts.purpose, n: sql<number>`count(*)::int` })
    .from(db.usageCosts)
    .where(eq(db.usageCosts.scanId, scanId))
    .groupBy(db.usageCosts.purpose);
  line("usage_costs rows", Object.fromEntries(usage.map((u) => [u.purpose, u.n])));

  /* Running the pipeline again changes nothing. */
  heading("Idempotency: the pipeline again on the same scan");
  const countAll = async () => {
    const [s] = await conn.select({ n: sql<number>`count(*)::int` }).from(db.statements).where(eq(db.statements.brandId, acme.id));
    const [i] = await conn.select({ n: sql<number>`count(*)::int` }).from(db.issues).where(eq(db.issues.brandId, acme.id));
    const [e] = await conn.select({ n: sql<number>`count(*)::int` }).from(db.issueEvents);
    const [snap] = await conn.select({ n: sql<number>`count(*)::int` }).from(db.scoreSnapshots).where(eq(db.scoreSnapshots.scanId, scanId));
    return { statements: s.n, issues: i.n, events: e.n, snapshots: snap.n };
  };
  const beforeRerun = await countAll();
  const summary = await runPipeline(scanId);
  const afterRerun = await countAll();
  line("before", beforeRerun);
  line("after", afterRerun);
  line("summary of the second run", { checked: summary.answersChecked, added: summary.statementsAdded, created: summary.issuesCreated });
  check(
    beforeRerun.statements === afterRerun.statements && beforeRerun.issues === afterRerun.issues && beforeRerun.events === afterRerun.events && beforeRerun.snapshots === afterRerun.snapshots,
    "no new statements, issues, events or snapshots",
  );

  /* Review and alerts. */
  heading("Review queue and alerts");
  const pending = created.filter((i) => i.reviewState === "pending").sort((a, b) => ["critical", "high", "medium", "low"].indexOf(a.severity) - ["critical", "high", "medium", "low"].indexOf(b.severity));
  if (pending.length > 0 && admin) {
    const first = pending[0];
    await engine.approveIssue({ issueId: first.id, reviewer: { id: admin.id, name: admin.name }, note: "Checked against the pricing page." });
    const [approved] = await conn.select().from(db.issues).where(eq(db.issues.id, first.id));
    line("approved", `#${approved.number} ${approved.title} (${approved.severity})`);
    check(approved.reviewState === "approved", "issue approved");
    if (pending[1]) {
      await engine.rejectIssue({ issueId: pending[1].id, reviewer: { id: admin.id, name: admin.name }, note: "The answer was about a different product." });
      const [rejected] = await conn.select().from(db.issues).where(eq(db.issues.id, pending[1].id));
      check(rejected.reviewState === "rejected" && rejected.reviewNote !== null, `#${rejected.number} rejected with a note`);
    }
  } else {
    line("review", "no pending issue was created in this scan");
  }
  const outboxRows = await conn
    .select({ to: db.outbox.recipient, subject: db.outbox.subject, status: db.outbox.status })
    .from(db.outbox)
    .where(gte(db.outbox.createdAt, scanStart));
  line("outbox rows", outboxRows.length);
  for (const row of outboxRows) line("  email", `${row.status} to ${row.to}: ${row.subject}`);
  const alerted = pending.length > 0 && ["critical", "high"].includes(pending[0].severity);
  if (alerted) check(outboxRows.some((r) => r.status === "logged" && r.subject.startsWith("New ")), "approving a critical or high issue logs an alert email (no RESEND_API_KEY)");
  void outboxBefore;

  /* 2. Re-check issue 101. */
  heading("Re-check of issue 101");
  const [issue101] = await conn.select().from(db.issues).where(and(eq(db.issues.brandId, acme.id), eq(db.issues.number, 101))).limit(1);
  check(Boolean(issue101), "issue 101 exists");
  if (issue101) {
    line("before", { status: issue101.status, cleanScanStreak: issue101.cleanScanStreak, platforms: issue101.platforms });
    const recheckStart = new Date();
    const requester = priya ?? admin;
    const { scanId: recheckId } = await engine.startRecheck({ issueId: issue101.id, triggeredBy: requester.id });
    const second = await engine.startRecheck({ issueId: issue101.id, triggeredBy: requester.id });
    check(second.scanId === recheckId, "pressing Re-check twice reuses the running re-check");
    const recheck = await worker.waitForScan(recheckId);
    line("re-check scan", `${recheck.status}, ${recheck.jobsDone} answers, ${recheck.jobsFailed} failed`);
    const [after] = await conn.select().from(db.issues).where(eq(db.issues.id, issue101.id));
    line("after", { status: after.status, cleanScanStreak: after.cleanScanStreak, resolvedAt: after.resolvedAt, nextCheckAt: after.nextCheckAt });
    const recheckEvents = await conn
      .select({ kind: db.issueEvents.kind, actor: db.issueEvents.actorName, note: db.issueEvents.note, from: db.issueEvents.fromStatus, to: db.issueEvents.toStatus })
      .from(db.issueEvents)
      .where(and(eq(db.issueEvents.issueId, issue101.id), gte(db.issueEvents.createdAt, recheckStart)))
      .orderBy(asc(db.issueEvents.createdAt));
    for (const e of recheckEvents) line("  event", `${e.kind} by ${e.actor}${e.from ? ` (${e.from} to ${e.to})` : ""}: ${e.note ?? ""}`);
    check(recheck.status === "completed", "re-check completed");
    check(recheckEvents.filter((e) => e.kind === "recheck").length === 1, "one recheck event with the person's name");
    check(recheckEvents.some((e) => ["seen", "clean", "resolved", "reopened"].includes(e.kind)), "the re-check result is in the evidence trail");
    const [recheckSnap] = await conn.select({ n: sql<number>`count(*)::int` }).from(db.scoreSnapshots).where(eq(db.scoreSnapshots.scanId, recheckId));
    check(recheckSnap.n === 0, "re-checks do not write score snapshots");
  }

  /* 3. Failure, retry and cancel. */
  heading("Failed jobs, retry and cancel");
  const settingsNow = await engine.getSettings();
  await engine.updateSetting("features", { ...settingsNow.features, simulateWithoutKeys: false });
  const oneQuestion = keyQuestions.slice(0, 1).map((q) => q.id);
  const { scanId: failingId } = await engine.startScan({ brandId: acme.id, type: "manual", platforms: ["gemini", "claude"], runsPerQuestion: 1, questionIds: oneQuestion });
  const failing = await worker.waitForScan(failingId);
  line("without keys or simulator", `${failing.status}: ${failing.error}`);
  const failedJobs = await conn.select({ lastError: db.scanJobs.lastError, attempts: db.scanJobs.attempts }).from(db.scanJobs).where(eq(db.scanJobs.scanId, failingId));
  for (const job of failedJobs) line("  job", `${job.lastError} (attempts ${job.attempts})`);
  check(failing.status === "failed" && failing.jobsFailed === 2, "scan failed with both jobs failed");
  check(failedJobs.every((j) => j.lastError?.includes("Add ") && j.lastError.includes("Admin, Settings")), "the job error says what to do");
  await engine.updateSetting("features", { ...settingsNow.features, simulateWithoutKeys: true });
  const retried = await engine.retryFailedJobs(failingId);
  const afterRetry = await worker.waitForScan(failingId);
  line("retried", `${retried.retried} jobs: ${afterRetry.status}, ${afterRetry.jobsDone} done, ${afterRetry.jobsFailed} failed`);
  check(retried.retried === 2 && afterRetry.status === "completed" && afterRetry.jobsFailed === 0, "retry finished the scan");

  const { scanId: cancelId } = await engine.startScan({ brandId: acme.id, type: "audit", runsPerQuestion: 1 });
  await engine.cancelScan(cancelId);
  const cancelled = await worker.waitForScan(cancelId, 60_000);
  const [cancelledJobs] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(db.scanJobs)
    .where(and(eq(db.scanJobs.scanId, cancelId), eq(db.scanJobs.lastError, "Cancelled")));
  line("cancelled scan", `${cancelled.status}, ${cancelledJobs.n} jobs marked Cancelled of ${cancelled.jobsTotal}`);
  check(cancelled.status === "cancelled", "scan cancelled");

  /* 4. Scheduled scans and weekly digests. */
  heading("Scheduled scans and digests");
  const now = new Date();
  const none = await engine.runScheduledScans(new Date(0));
  check(none.started.length === 0, "nothing is due at the start of time");
  await conn.update(db.brands).set({ nextScanAt: new Date(now.getTime() - 60_000) }).where(eq(db.brands.id, acme.id));
  const scheduled = await engine.runScheduledScans(now);
  const scheduledAgain = await engine.runScheduledScans(now);
  const acmeScheduled = [];
  for (const id of scheduled.started) {
    const [s] = await conn.select({ brandId: db.scans.brandId, jobsTotal: db.scans.jobsTotal }).from(db.scans).where(eq(db.scans.id, id));
    if (s.brandId === acme.id) acmeScheduled.push(id);
    await engine.cancelScan(id);
  }
  const [acmeAfter] = await conn.select({ nextScanAt: db.brands.nextScanAt }).from(db.brands).where(eq(db.brands.id, acme.id));
  line("scheduled scans started", `${scheduled.started.length} (then cancelled), second call ${scheduledAgain.started.length}`);
  line("Acme next scan", acmeAfter.nextScanAt?.toISOString());
  check(acmeScheduled.length === 1, "Acme got a scheduled scan");
  check(scheduledAgain.started.length === 0, "a second cron call starts nothing");
  check(Boolean(acmeAfter.nextScanAt && acmeAfter.nextScanAt > now), "next scan moved forward");

  const digests = await sendWeeklyDigests(now);
  const digestsAgain = await sendWeeklyDigests(now);
  line("weekly digests", `${digests.emails} emails from ${digests.rules} rules, then ${digestsAgain.emails}`);
  check(digests.emails > 0, "weekly rules get a digest");
  check(digestsAgain.emails === 0, "at most one digest per 7 days per recipient");

  /* 5. Seeded scans left running (Litware) finish on the same worker. */
  if (unfinishedBefore.length > 0) {
    heading("Seeded unfinished scans");
    for (const s of unfinishedBefore) {
      const done = await worker.waitForScan(s.id, 5 * 60_000);
      const [brand] = await conn.select({ name: db.brands.name }).from(db.brands).where(eq(db.brands.id, s.brandId));
      line(brand?.name ?? s.brandId, `${done.status}, ${done.jobsDone} done, ${done.jobsFailed} failed of ${done.jobsTotal}`);
      check(done.status === "completed", `${brand?.name ?? "seeded"} scan completed`);
    }
  }

  const [totals] = await conn.select({ n: sql<number>`count(*)::int` }).from(db.outbox);
  line("\noutbox rows in total", totals.n);
  const latestScans = await conn
    .select({ type: db.scans.type, status: db.scans.status })
    .from(db.scans)
    .where(eq(db.scans.brandId, acme.id))
    .orderBy(desc(db.scans.createdAt))
    .limit(6);
  line("latest Acme scans", latestScans.map((s) => `${s.type} ${s.status}`));

  await worker.stopWorker();
  console.log(failures === 0 ? "\nAll engine checks passed." : `\n${failures} engine check(s) failed.`);
}

main()
  .then(() => process.exit(failures === 0 ? 0 : 1))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
