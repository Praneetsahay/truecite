import { desc, eq, inArray } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getViewer } from "@/lib/auth/dal";
import { brands, getDb, scans } from "@/lib/db";
import { PLATFORM_IDS, SCAN_TYPES, type ScanType } from "@/lib/domain/constants";
import { EngineError, ensureWorker, startScan } from "@/lib/engine";
import { scanProgress } from "@/lib/engine/scans";
import { workerStatus } from "@/lib/engine/worker";

/*
  Development only, for admins: start a scan by hand and watch its progress.
  POST { brandId, type?, platforms?, runsPerQuestion?, questionIds? } starts a scan.
  GET ?id=SCAN_ID returns its progress; GET without an id lists unfinished scans.
*/

const NO_STORE = { "cache-control": "no-store" };

const StartSchema = z.object({
  brandId: z.uuid(),
  type: z
    .enum(Object.keys(SCAN_TYPES) as [ScanType, ...ScanType[]])
    .refine((type) => type !== "recheck", "Use the issue page to start a re-check.")
    .default("manual"),
  platforms: z.array(z.enum(PLATFORM_IDS)).min(1).optional(),
  runsPerQuestion: z.number().int().min(1).max(5).optional(),
  questionIds: z.array(z.uuid()).min(1).optional(),
});

async function guard(): Promise<NextResponse | null> {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  const viewer = await getViewer();
  if (!viewer?.user.isAdmin) {
    return NextResponse.json({ error: "Sign in as an admin to use this endpoint." }, { status: 403, headers: NO_STORE });
  }
  return null;
}

export async function POST(request: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  const body: unknown = await request.json().catch(() => null);
  const parsed = StartSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Send JSON with a brandId.", issues: parsed.error.issues }, { status: 400, headers: NO_STORE });
  }
  const viewer = await getViewer();
  try {
    const { scanId } = await startScan({ ...parsed.data, triggeredBy: viewer?.user.id ?? null, note: "Started from the dev endpoint" });
    return NextResponse.json({ scanId, progress: await scanProgress(scanId) }, { status: 202, headers: NO_STORE });
  } catch (error) {
    if (error instanceof EngineError) return NextResponse.json({ error: error.message }, { status: 400, headers: NO_STORE });
    throw error;
  }
}

export async function GET(request: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  ensureWorker();
  const id = request.nextUrl.searchParams.get("id");
  if (id) {
    if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "id must be a scan id." }, { status: 400, headers: NO_STORE });
    const progress = await scanProgress(id);
    if (!progress) return NextResponse.json({ error: "No scan with that id." }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ worker: workerStatus(), progress }, { headers: NO_STORE });
  }
  const db = await getDb();
  const unfinished = await db
    .select({ id: scans.id })
    .from(scans)
    .where(inArray(scans.status, ["queued", "running", "checking"]))
    .orderBy(desc(scans.createdAt))
    .limit(20);
  const progress = await Promise.all(unfinished.map((s) => scanProgress(s.id)));
  const recent = await db
    .select({
      id: scans.id,
      brandId: scans.brandId,
      brand: brands.name,
      type: scans.type,
      status: scans.status,
      jobsDone: scans.jobsDone,
      jobsFailed: scans.jobsFailed,
      jobsTotal: scans.jobsTotal,
      finishedAt: scans.finishedAt,
      error: scans.error,
    })
    .from(scans)
    .innerJoin(brands, eq(brands.id, scans.brandId))
    .orderBy(desc(scans.createdAt))
    .limit(10);
  return NextResponse.json({ worker: workerStatus(), unfinished: progress, recent }, { headers: NO_STORE });
}
