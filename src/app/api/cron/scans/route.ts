import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runScheduledScans } from "@/lib/engine";
import { sendWeeklyDigests } from "@/lib/engine/alerts";

/*
  Called by a scheduler (for example Vercel Cron or a system cron) every few
  minutes: starts the scheduled scans that are due and sends weekly digests.
  Protected with `Authorization: Bearer CRON_SECRET`. In development it also
  accepts calls without the secret.
*/

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  const header = request.headers.get("authorization") ?? "";
  if (secret) {
    const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (given && timingSafeEqual(digest(given), digest(secret))) return true;
  }
  return process.env.NODE_ENV === "development";
}

async function handle(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json(
      { ok: false, error: "Not authorized. Send the header Authorization: Bearer CRON_SECRET." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  const now = new Date();
  try {
    const scansStarted = await runScheduledScans(now);
    const digests = await sendWeeklyDigests(now);
    return NextResponse.json(
      { ok: true, at: now.toISOString(), scansStarted: scansStarted.started, digests },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[cron] scheduled scans failed: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
