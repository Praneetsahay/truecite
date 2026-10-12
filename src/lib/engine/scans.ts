import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { brands, getDb, issueEvents, issues, organizations, questions, scanJobs, scans, users } from "@/lib/db";
import { PLATFORM_IDS, SYSTEM_ACTOR, type PlatformId, type ScanFrequency, type ScanType } from "@/lib/domain/constants";
import { EngineError } from "./errors";
import { startWorker } from "./worker";

/*
  Starting, re-checking, retrying, cancelling and scheduling scans. Each scan is
  a set of jobs (question × platform × run) that the in-process worker runs;
  every function here returns at once.
*/

export type StartScanInput = {
  brandId: string;
  type: ScanType;
  triggeredBy?: string | null;
  /** Defaults to the brand's active questions (key questions first). */
  questionIds?: string[];
  /** Defaults to the brand's enabled platforms. */
  platforms?: PlatformId[];
  /** Defaults to the brand's runsPerQuestion. */
  runsPerQuestion?: number;
  /** For re-checks. */
  issueId?: string;
  note?: string;
};

const ACTIVE_SCAN_STATUSES = ["queued", "running", "checking"] as const;
const MAX_RUNS = 5;
const JOB_CHUNK = 500;

/** Creates a scan and its jobs (question × platform × run) and starts the worker. Returns at once. */
export async function startScan(input: StartScanInput): Promise<{ scanId: string }> {
  const db = await getDb();
  const [brand] = await db.select().from(brands).where(eq(brands.id, input.brandId)).limit(1);
  if (!brand) throw new EngineError("That company no longer exists.");

  const platforms = PLATFORM_IDS.filter((p) => (input.platforms ?? brand.platforms).includes(p));
  if (platforms.length === 0) throw new EngineError("Choose at least one AI assistant to ask, then start the scan again.");
  const runsPerQuestion = Math.min(MAX_RUNS, Math.max(1, Math.round(input.runsPerQuestion ?? brand.runsPerQuestion)));

  if (input.questionIds && input.questionIds.length === 0) {
    throw new EngineError("Choose at least one question to ask, then start the scan again.");
  }
  const questionRows = await db
    .select({ id: questions.id })
    .from(questions)
    .where(
      input.questionIds
        ? and(eq(questions.brandId, brand.id), inArray(questions.id, input.questionIds))
        : and(eq(questions.brandId, brand.id), eq(questions.active, true)),
    )
    .orderBy(sql`case when ${questions.priority} = 'key' then 0 else 1 end`, asc(questions.createdAt), asc(questions.id));
  if (questionRows.length === 0) {
    throw new EngineError("There are no active questions to ask. Add or switch on questions in the Question Set, then start the scan.");
  }

  // Pressing the button twice does not start a second scan of the same kind.
  if (input.type !== "recheck") {
    const [running] = await db
      .select({ id: scans.id })
      .from(scans)
      .where(and(eq(scans.brandId, brand.id), eq(scans.type, input.type), inArray(scans.status, [...ACTIVE_SCAN_STATUSES])))
      .limit(1);
    if (running) {
      startWorker();
      return { scanId: running.id };
    }
  }

  const jobs = questionRows.flatMap((q) =>
    platforms.flatMap((platform) =>
      Array.from({ length: runsPerQuestion }, (_, i) => ({ questionId: q.id, platform, runNumber: i + 1 })),
    ),
  );

  const scanId = await db.transaction(async (tx) => {
    const [scan] = await tx
      .insert(scans)
      .values({
        brandId: brand.id,
        type: input.type,
        status: "queued",
        platforms,
        runsPerQuestion,
        questionCount: questionRows.length,
        jobsTotal: jobs.length,
        issueId: input.issueId ?? null,
        triggeredBy: input.triggeredBy ?? null,
        note: input.note?.trim() || null,
      })
      .returning({ id: scans.id });
    for (let i = 0; i < jobs.length; i += JOB_CHUNK) {
      await tx
        .insert(scanJobs)
        .values(jobs.slice(i, i + JOB_CHUNK).map((job) => ({ ...job, scanId: scan.id, status: "queued" as const })))
        .onConflictDoNothing({ target: [scanJobs.scanId, scanJobs.questionId, scanJobs.platform, scanJobs.runNumber] });
    }
    return scan.id;
  });

  startWorker();
  return { scanId };
}

/** "Re-check now": a small scan of the issue's question on the issue's platforms. */
export async function startRecheck(input: { issueId: string; triggeredBy: string }): Promise<{ scanId: string }> {
  const db = await getDb();
  const [issue] = await db.select().from(issues).where(eq(issues.id, input.issueId)).limit(1);
  if (!issue) throw new EngineError("That issue no longer exists.");
  if (!issue.questionId) {
    throw new EngineError("This issue is not linked to a question, so it cannot be re-checked on its own. It is checked again in the next full scan.");
  }
  if (issue.dismissedAt) throw new EngineError("This issue was marked as not an error, so it is not re-checked.");

  // A re-check already under way is reused.
  const [running] = await db
    .select({ id: scans.id })
    .from(scans)
    .where(and(eq(scans.issueId, issue.id), eq(scans.type, "recheck"), inArray(scans.status, [...ACTIVE_SCAN_STATUSES])))
    .limit(1);
  if (running) {
    startWorker();
    return { scanId: running.id };
  }

  const [brand] = await db.select().from(brands).where(eq(brands.id, issue.brandId)).limit(1);
  if (!brand) throw new EngineError("That company no longer exists.");
  const [person] = await db.select({ name: users.name }).from(users).where(eq(users.id, input.triggeredBy)).limit(1);
  const platforms = issue.platforms.length > 0 ? issue.platforms : brand.platforms;

  const { scanId } = await startScan({
    brandId: issue.brandId,
    type: "recheck",
    triggeredBy: input.triggeredBy,
    questionIds: [issue.questionId],
    platforms,
    runsPerQuestion: brand.runsPerQuestion,
    issueId: issue.id,
    note: `Re-check of issue ${issue.number}`,
  });

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(issues).set({ nextCheckAt: now, updatedAt: now }).where(eq(issues.id, issue.id));
    await tx.insert(issueEvents).values({
      issueId: issue.id,
      kind: "recheck",
      actorId: person ? input.triggeredBy : null,
      actorName: person?.name ?? SYSTEM_ACTOR,
      note: "Re-check started",
    });
  });
  return { scanId };
}

/** Puts failed jobs of a scan back in the queue. */
export async function retryFailedJobs(scanId: string): Promise<{ retried: number }> {
  const db = await getDb();
  const [scan] = await db.select().from(scans).where(eq(scans.id, scanId)).limit(1);
  if (!scan) throw new EngineError("That scan no longer exists.");
  if (scan.status === "checking") throw new EngineError("This scan is checking its answers. Retry the failed requests when it has finished.");

  const retried = await db.transaction(async (tx) => {
    const rows = await tx
      .update(scanJobs)
      .set({ status: "queued", attempts: 0, lastError: null, nextAttemptAt: null, startedAt: null, finishedAt: null })
      .where(and(eq(scanJobs.scanId, scan.id), eq(scanJobs.status, "failed")))
      .returning({ id: scanJobs.id });
    if (rows.length === 0) return 0;
    await tx
      .update(scans)
      .set({
        status: "running",
        error: null,
        // The note described the failures; it no longer applies once they are retried.
        note: null,
        jobsFailed: sql`greatest(${scans.jobsFailed} - ${rows.length}, 0)`,
        // A scan that never completed runs the whole pipeline again; a completed one only adds the new answers.
        ...(scan.status === "completed" ? {} : { finishedAt: null }),
      })
      .where(eq(scans.id, scan.id));
    return rows.length;
  });

  if (retried > 0) startWorker();
  return { retried };
}

export async function cancelScan(scanId: string): Promise<void> {
  const db = await getDb();
  const [scan] = await db.select().from(scans).where(eq(scans.id, scanId)).limit(1);
  if (!scan) throw new EngineError("That scan no longer exists.");
  if (scan.status === "checking") throw new EngineError("This scan is already checking its answers and will finish in a moment.");
  if (scan.status !== "queued" && scan.status !== "running") return;

  await db.transaction(async (tx) => {
    const cancelled = await tx
      .update(scanJobs)
      .set({ status: "failed", lastError: "Cancelled", finishedAt: new Date(), nextAttemptAt: null })
      .where(and(eq(scanJobs.scanId, scan.id), eq(scanJobs.status, "queued")))
      .returning({ id: scanJobs.id });
    await tx
      .update(scans)
      .set({
        status: "cancelled",
        jobsFailed: sql`${scans.jobsFailed} + ${cancelled.length}`,
        finishedAt: new Date(),
      })
      .where(and(eq(scans.id, scan.id), inArray(scans.status, ["queued", "running"])));
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The next scan time after `from` for a frequency. */
function advance(from: Date, frequency: Exclude<ScanFrequency, "manual">): Date {
  if (frequency === "monthly") {
    const next = new Date(from);
    next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }
  return new Date(from.getTime() + (frequency === "weekly" ? 7 : 14) * DAY_MS);
}

/** Starts scheduled scans that are due. Called by the cron route. */
export async function runScheduledScans(now: Date): Promise<{ started: string[] }> {
  const db = await getDb();
  const due = await db
    .select({ id: brands.id, frequency: brands.scanFrequency, nextScanAt: brands.nextScanAt })
    .from(brands)
    .innerJoin(organizations, eq(organizations.id, brands.organizationId))
    .where(
      and(
        eq(organizations.internal, false),
        eq(brands.onboardingStep, "done"),
        ne(brands.scanFrequency, "manual"),
        isNotNull(brands.nextScanAt),
        lte(brands.nextScanAt, now),
      ),
    )
    .orderBy(asc(brands.nextScanAt));

  const started: string[] = [];
  for (const brand of due) {
    if (brand.frequency === "manual" || !brand.nextScanAt) continue;
    // Move the schedule forward first, so a second cron call in the same minute starts nothing.
    let next = advance(brand.nextScanAt, brand.frequency);
    while (next <= now) next = advance(next, brand.frequency);
    const [claimed] = await db
      .update(brands)
      .set({ nextScanAt: next })
      .where(and(eq(brands.id, brand.id), eq(brands.nextScanAt, brand.nextScanAt)))
      .returning({ id: brands.id });
    if (!claimed) continue;
    try {
      const { scanId } = await startScan({ brandId: brand.id, type: "scheduled", note: "Scheduled scan" });
      started.push(scanId);
    } catch (error) {
      console.error(`[engine] scheduled scan for brand ${brand.id} not started: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { started };
}

/** Makes sure the in-process worker is running (it also resumes queued jobs after a restart). */
export function ensureWorker(): void {
  startWorker();
}

/** Progress of one scan, for polling. */
export async function scanProgress(scanId: string) {
  const db = await getDb();
  const [scan] = await db.select().from(scans).where(eq(scans.id, scanId)).limit(1);
  if (!scan) return null;
  const jobs = await db
    .select({ status: scanJobs.status, count: sql<number>`count(*)::int` })
    .from(scanJobs)
    .where(eq(scanJobs.scanId, scanId))
    .groupBy(scanJobs.status);
  const failures = await db
    .select({ platform: scanJobs.platform, lastError: scanJobs.lastError })
    .from(scanJobs)
    .where(and(eq(scanJobs.scanId, scanId), eq(scanJobs.status, "failed")))
    .orderBy(desc(scanJobs.finishedAt))
    .limit(5);
  return {
    id: scan.id,
    type: scan.type,
    status: scan.status,
    jobsTotal: scan.jobsTotal,
    jobsDone: scan.jobsDone,
    jobsFailed: scan.jobsFailed,
    jobs: Object.fromEntries(jobs.map((j) => [j.status, Number(j.count)])),
    totalCostUsd: scan.totalCostUsd,
    simulated: scan.simulated,
    error: scan.error,
    startedAt: scan.startedAt,
    finishedAt: scan.finishedAt,
    recentFailures: failures,
  };
}
