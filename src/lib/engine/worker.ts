import "server-only";
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { answers, citations, getDb, prospects, questions, scanJobs, scans, usageCosts, type ScanJob } from "@/lib/db";
import { requestCost } from "@/lib/domain/costs";
import { loadBrandContext, type BrandContext } from "./context";
import { runPipeline } from "./pipeline";
import { askPlatform, PROVIDER_LABELS, ProviderError } from "./providers";
import { getSettings, priceFor, type Settings } from "./settings";
import { roll, sleep, today } from "./text";

/*
  The scan worker: one loop per server process, kept on globalThis so it
  survives module reloads in development. It claims queued jobs (question ×
  platform × run), asks the platform, saves the answer, and retries failures
  with exponential backoff. When a scan has no queued or running jobs left, it
  runs the pipeline (check, issues, sources, alerts, scores) and closes the scan.

  Bump WORKER_VERSION when the loop changes: a reloaded module with a newer
  version stops the old loop and takes over.
*/

const WORKER_VERSION = 3;
/** How often an idle loop with delayed retries looks again. */
const POLL_MS = 1_000;
/** A brand's context is reused for this long while its jobs run. */
const CONTEXT_TTL_MS = 60_000;

type WorkerState = {
  version: number;
  stopped: boolean;
  /** Set by ensureWorker; the loop looks again before going idle. */
  dirty: boolean;
  loop: Promise<void> | null;
  wake: (() => void) | null;
  active: Set<string>;
  booted: boolean;
};

type WorkerGlobal = {
  __trueciteWorker?: WorkerState;
  /** Scans whose pipeline runs in this process right now. */
  __trueciteFinishing?: Set<string>;
};

const g = globalThis as unknown as WorkerGlobal;

function finishing(): Set<string> {
  return (g.__trueciteFinishing ??= new Set());
}

/** Makes sure a loop of this version is running and looks for work now. */
export function startWorker(): void {
  const current = g.__trueciteWorker;
  if (current && !current.stopped && current.version >= WORKER_VERSION) {
    current.dirty = true;
    if (current.loop) current.wake?.();
    else current.loop = runLoop(current);
    return;
  }
  // An older loop (from before a reload) finishes its in-flight jobs and stops.
  if (current) {
    current.stopped = true;
    current.wake?.();
  }
  const state: WorkerState = {
    version: WORKER_VERSION,
    stopped: false,
    dirty: true,
    loop: null,
    wake: null,
    active: new Set(),
    booted: current?.booted ?? false,
  };
  g.__trueciteWorker = state;
  state.loop = runLoop(state);
}

/** Stops the loop after the jobs in flight. Used by scripts before they exit. */
export async function stopWorker(): Promise<void> {
  const state = g.__trueciteWorker;
  if (!state) return;
  state.stopped = true;
  state.wake?.();
  await state.loop?.catch(() => undefined);
}

export function workerStatus(): { running: boolean; version: number | null; activeJobs: number } {
  const state = g.__trueciteWorker;
  return { running: Boolean(state?.loop && !state.stopped), version: state?.version ?? null, activeJobs: state?.active.size ?? 0 };
}

async function runLoop(state: WorkerState): Promise<void> {
  try {
    if (!state.booted) {
      state.booted = true;
      await recover().catch((error: unknown) => logError("Recovering unfinished scans failed", error));
    }
    const contexts = new Map<string, { ctx: BrandContext; at: number }>();
    const inflight = new Set<Promise<void>>();

    while (!state.stopped) {
      state.dirty = false;
      const settings = await getSettings();
      const limit = Math.max(1, settings.limits.maxConcurrentRequests);
      const free = limit - state.active.size;
      const claimed = free > 0 ? await claimJobs(free) : [];

      for (const job of claimed) {
        state.active.add(job.id);
        const task = runJob(job, settings, contexts)
          .catch((error: unknown) => logError(`Job ${job.id} failed unexpectedly`, error))
          .then(() => finishScanIfDone(job.scanId))
          .catch((error: unknown) => logError(`Closing scan ${job.scanId} failed`, error))
          .finally(() => {
            state.active.delete(job.id);
            inflight.delete(task);
            // A free slot: look for the next job straight away.
            state.dirty = true;
            state.wake?.();
          });
        inflight.add(task);
      }

      if (state.stopped) break;
      if (claimed.length > 0 && state.active.size < limit) continue;

      if (state.active.size === 0 && claimed.length === 0) {
        const waitMs = await msUntilNextJob();
        if (waitMs === null && !state.dirty) break; // Nothing queued: go idle until ensureWorker is called again.
        if (waitMs !== null && waitMs > 0) await pause(state, Math.min(waitMs, POLL_MS * 5));
        continue;
      }
      // Jobs are running: wait until one finishes, or poll for delayed retries.
      await pause(state, POLL_MS);
    }
    await Promise.allSettled([...inflight]);
  } catch (error) {
    logError("The scan worker stopped", error);
  } finally {
    state.loop = null;
    state.wake = null;
    // Work that arrived while the loop was stopping gets a fresh loop.
    if (!state.stopped && state.dirty) {
      state.loop = runLoop(state);
    }
  }
}

function pause(state: WorkerState, ms: number): Promise<void> {
  if (state.dirty || state.stopped) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      if (state.wake === done) state.wake = null;
      resolve();
    }
    state.wake = done;
  });
}

function logError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[engine] ${context}: ${message}`);
}

/** Milliseconds until the next queued job is due, 0 when one is due now, null when nothing is queued. */
async function msUntilNextJob(): Promise<number | null> {
  const db = await getDb();
  const [row] = await db
    .select({ next: sql<Date | string | null>`min(coalesce(${scanJobs.nextAttemptAt}, now()))`, count: sql<number>`count(*)::int` })
    .from(scanJobs)
    .where(eq(scanJobs.status, "queued"));
  if (!row || Number(row.count) === 0 || !row.next) return null;
  return Math.max(0, new Date(row.next).getTime() - Date.now());
}

/**
 * Claims up to `count` due jobs. The select picks candidates; the update only
 * takes rows that are still queued, so two claimers (or two processes on
 * Postgres) never run the same job.
 */
async function claimJobs(count: number): Promise<ScanJob[]> {
  const db = await getDb();
  const now = new Date();
  const candidates = await db
    .select({ id: scanJobs.id })
    .from(scanJobs)
    .innerJoin(scans, eq(scans.id, scanJobs.scanId))
    .where(
      and(
        eq(scanJobs.status, "queued"),
        or(isNull(scanJobs.nextAttemptAt), lte(scanJobs.nextAttemptAt, now)),
        inArray(scans.status, ["queued", "running"]),
      ),
    )
    // Re-checks first (someone is waiting), then older scans; one question across platforms at a time.
    .orderBy(
      sql`case when ${scans.type} = 'recheck' then 0 else 1 end`,
      asc(scans.createdAt),
      asc(scanJobs.runNumber),
      asc(scanJobs.questionId),
      asc(scanJobs.platform),
    )
    .limit(count);
  if (candidates.length === 0) return [];

  const claimed = await db
    .update(scanJobs)
    .set({ status: "running", startedAt: now, finishedAt: null })
    .where(and(inArray(scanJobs.id, candidates.map((c) => c.id)), eq(scanJobs.status, "queued")))
    .returning();

  const scanIds = [...new Set(claimed.map((job) => job.scanId))];
  if (scanIds.length > 0) {
    await db
      .update(scans)
      .set({ status: "running", startedAt: sql`coalesce(${scans.startedAt}, ${now.toISOString()}::timestamptz)` })
      .where(and(inArray(scans.id, scanIds), eq(scans.status, "queued")));
  }
  return claimed;
}

async function contextFor(brandId: string, contexts: Map<string, { ctx: BrandContext; at: number }>): Promise<BrandContext> {
  const cached = contexts.get(brandId);
  const nowMs = Date.now();
  if (cached && nowMs - cached.at < CONTEXT_TTL_MS) return cached.ctx;
  const ctx = await loadBrandContext(brandId, new Date());
  contexts.set(brandId, { ctx, at: nowMs });
  return ctx;
}

function seconds(ms: number): string {
  const s = Math.round(ms / 100) / 10;
  return `${Number.isInteger(s) ? s : s.toFixed(1)} s`;
}

/** Asks one question on one platform and saves the answer, or schedules a retry. */
async function runJob(job: ScanJob, settings: Settings, contexts: Map<string, { ctx: BrandContext; at: number }>): Promise<void> {
  const db = await getDb();
  const [scan] = await db.select().from(scans).where(eq(scans.id, job.scanId)).limit(1);
  const [question] = await db
    .select({ id: questions.id, text: questions.text, category: questions.category })
    .from(questions)
    .where(eq(questions.id, job.questionId))
    .limit(1);
  if (!scan || !question) {
    await failJob(job, "The scan or its question was deleted.", job.attempts);
    return;
  }

  const config = settings.models.answer[job.platform];
  const timeoutMs = Math.max(1_000, settings.limits.requestTimeoutMs);
  const maxAttempts = Math.max(1, settings.limits.maxAttempts);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ProviderError({ message: `${PROVIDER_LABELS[config.provider]} request timed out`, retryable: true, kind: "timeout" }));
    }, timeoutMs);
  });

  try {
    const ctx = await contextFor(scan.brandId, contexts);
    const answer = await Promise.race([
      askPlatform({
        settings,
        ctx,
        platform: job.platform,
        question,
        runNumber: job.runNumber,
        scanId: scan.id,
        signal: controller.signal,
      }),
      timeout,
    ]);
    clearTimeout(timer);

    const price = priceFor(settings.prices, answer.provider, answer.model) ?? priceFor(settings.prices, answer.provider, answer.requestedModel);
    const cost = price && !answer.simulated ? requestCost({ tokensIn: answer.tokensIn, tokensOut: answer.tokensOut, searchCalls: answer.searchCalls }, price) : 0;
    const now = new Date();

    await db.transaction(async (tx) => {
      const [done] = await tx
        .update(scanJobs)
        .set({ status: "done", finishedAt: now, lastError: null, nextAttemptAt: null })
        .where(and(eq(scanJobs.id, job.id), eq(scanJobs.status, "running")))
        .returning({ id: scanJobs.id });
      // The job was cancelled or taken back meanwhile: keep nothing.
      if (!done) return;

      const [saved] = await tx
        .insert(answers)
        .values({
          scanId: scan.id,
          questionId: question.id,
          brandId: scan.brandId,
          platform: job.platform,
          model: answer.model || answer.requestedModel,
          runNumber: job.runNumber,
          text: answer.text,
          rawResponse: answer.raw ?? null,
          settings: {
            webSearch: answer.webSearch,
            provider: answer.provider,
            requestedModel: answer.requestedModel,
            effort: answer.effort,
            ...(answer.refusal ? { refusal: true } : {}),
          },
          tokensIn: answer.tokensIn,
          tokensOut: answer.tokensOut,
          searchCalls: answer.searchCalls,
          costUsd: cost,
          latencyMs: Math.round(answer.latencyMs),
          simulated: answer.simulated,
        })
        // A retry after a crash never stores the same answer twice.
        .onConflictDoNothing({ target: [answers.scanId, answers.questionId, answers.platform, answers.runNumber] })
        .returning({ id: answers.id });

      if (saved) {
        if (answer.citations.length > 0) {
          await tx.insert(citations).values(answer.citations.map((c, i) => ({ answerId: saved.id, url: c.url, title: c.title, position: i + 1 })));
        }
        await tx.insert(usageCosts).values({
          organizationId: ctx.organization.id,
          brandId: scan.brandId,
          scanId: scan.id,
          provider: answer.provider,
          model: answer.model || answer.requestedModel,
          purpose: "answer",
          tokensIn: answer.tokensIn,
          tokensOut: answer.tokensOut,
          searchCalls: answer.searchCalls,
          costUsd: cost,
          day: today(now),
        });
      }
      await tx
        .update(scans)
        .set({
          jobsDone: sql`${scans.jobsDone} + 1`,
          totalCostUsd: sql`${scans.totalCostUsd} + ${saved ? cost : 0}`,
          ...(answer.simulated ? { simulated: true } : {}),
        })
        .where(eq(scans.id, scan.id));
    });
  } catch (error) {
    clearTimeout(timer);
    if (!controller.signal.aborted) controller.abort();
    const attempts = job.attempts + 1;
    const providerError = error instanceof ProviderError ? error : null;
    const retryable = providerError ? providerError.retryable : true;
    const base =
      providerError?.kind === "timeout"
        ? `${PROVIDER_LABELS[config.provider]} request timed out after ${seconds(timeoutMs)}`
        : error instanceof Error
          ? error.message.replace(/\.$/, "")
          : String(error);
    if (retryable && attempts < maxAttempts) {
      const delay = 2 ** attempts * 2_000 + Math.round(roll(job.id, attempts, "jitter") * 1_000);
      await db
        .update(scanJobs)
        .set({
          status: "queued",
          attempts,
          lastError: `${base} (attempt ${attempts} of ${maxAttempts}). Trying again.`,
          nextAttemptAt: new Date(Date.now() + delay),
          startedAt: null,
        })
        .where(and(eq(scanJobs.id, job.id), eq(scanJobs.status, "running")));
      return;
    }
    const message = retryable ? `${base} (attempt ${attempts} of ${maxAttempts})` : `${base}${/[.)]$/.test(base) ? "" : "."}`;
    await failJob(job, message, attempts);
  }
}

async function failJob(job: ScanJob, message: string, attempts: number): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [failed] = await tx
      .update(scanJobs)
      .set({ status: "failed", attempts, lastError: message, finishedAt: new Date(), nextAttemptAt: null })
      .where(and(eq(scanJobs.id, job.id), eq(scanJobs.status, "running")))
      .returning({ id: scanJobs.id });
    if (failed) await tx.update(scans).set({ jobsFailed: sql`${scans.jobsFailed} + 1` }).where(eq(scans.id, job.scanId));
  });
}

/**
 * Closes a scan once no job is queued or running: checks the answers, then
 * marks it completed (or failed, with a reason people can act on).
 */
export async function finishScanIfDone(scanId: string): Promise<void> {
  const db = await getDb();
  const [open] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(scanJobs)
    .where(and(eq(scanJobs.scanId, scanId), inArray(scanJobs.status, ["queued", "running"])));
  if (Number(open?.count ?? 0) > 0) return;
  if (finishing().has(scanId)) return;

  const [scan] = await db
    .update(scans)
    .set({ status: "checking" })
    .where(and(eq(scans.id, scanId), inArray(scans.status, ["queued", "running"])))
    .returning();
  if (!scan) return;
  await closeScan(scan);
}

async function closeScan(scan: typeof scans.$inferSelect): Promise<void> {
  const db = await getDb();
  finishing().add(scan.id);
  try {
    const [{ answered }] = await db.select({ answered: sql<number>`count(*)::int` }).from(answers).where(eq(answers.scanId, scan.id));
    if (Number(answered) === 0) {
      const [firstError] = await db
        .select({ lastError: scanJobs.lastError })
        .from(scanJobs)
        .where(and(eq(scanJobs.scanId, scan.id), eq(scanJobs.status, "failed")))
        .orderBy(asc(scanJobs.finishedAt))
        .limit(1);
      await db
        .update(scans)
        .set({
          status: "failed",
          error: firstError?.lastError
            ? `No answers came back. ${firstError.lastError}`
            : "No answers came back. The scan had no jobs to run.",
          finishedAt: new Date(),
        })
        .where(eq(scans.id, scan.id));
      return;
    }

    try {
      await runPipeline(scan.id);
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/\.$/, "") : String(error);
      await db
        .update(scans)
        .set({ status: "failed", error: `${message}. Retry the scan once the problem is fixed; answers already saved are kept.`, finishedAt: new Date() })
        .where(eq(scans.id, scan.id));
      logError(`Checking scan ${scan.id} failed`, error);
      return;
    }
    await db.update(scans).set({ status: "completed", error: null, finishedAt: new Date() }).where(eq(scans.id, scan.id));
    if (scan.type === "prospect") {
      await db
        .update(prospects)
        .set({ status: "reviewing", updatedAt: new Date() })
        .where(and(eq(prospects.brandId, scan.brandId), eq(prospects.status, "scanning")));
    }
  } finally {
    finishing().delete(scan.id);
  }
}

/**
 * After a restart: jobs stuck in "running" for longer than twice the timeout go
 * back to the queue, and scans left half-closed are closed again.
 */
async function recover(): Promise<void> {
  const db = await getDb();
  const settings = await getSettings();
  const cutoff = new Date(Date.now() - 2 * Math.max(1_000, settings.limits.requestTimeoutMs));
  await db
    .update(scanJobs)
    .set({ status: "queued", startedAt: null, nextAttemptAt: null })
    .where(and(eq(scanJobs.status, "running"), or(isNull(scanJobs.startedAt), lt(scanJobs.startedAt, cutoff))));

  // A scan stuck in "checking" (the process stopped mid-pipeline): the pipeline is safe to run again.
  const stuck = await db.select().from(scans).where(eq(scans.status, "checking"));
  for (const scan of stuck) {
    if (finishing().has(scan.id)) continue;
    await closeScan(scan).catch((error: unknown) => logError(`Closing scan ${scan.id} failed`, error));
  }
  // Scans whose jobs all ended but that were never closed.
  const open = await db.select({ id: scans.id }).from(scans).where(inArray(scans.status, ["queued", "running"]));
  for (const scan of open) {
    await finishScanIfDone(scan.id).catch((error: unknown) => logError(`Closing scan ${scan.id} failed`, error));
  }
}

/** Waits until a scan is completed, failed or cancelled. For scripts and tests. */
export async function waitForScan(scanId: string, timeoutMs = 10 * 60_000): Promise<typeof scans.$inferSelect> {
  const db = await getDb();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [scan] = await db.select().from(scans).where(eq(scans.id, scanId)).limit(1);
    if (!scan) throw new Error(`Scan ${scanId} was not found.`);
    if (scan.status === "completed" || scan.status === "failed" || scan.status === "cancelled") return scan;
    if (Date.now() > deadline) throw new Error(`Scan ${scanId} did not finish within ${seconds(timeoutMs)}.`);
    startWorker();
    await sleep(250);
  }
}
