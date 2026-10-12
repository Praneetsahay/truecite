import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, reports } from "@/lib/db";
import type { ReportType } from "@/lib/domain/constants";
import type { ReportData } from "@/lib/domain/report";
import { EngineError } from "./errors";
import { renderPdf } from "./pdf";
import { buildReport, midpoint, monthKey, monthLabel } from "./report-builder";

/*
  Builds frozen ReportData from scans, snapshots and issues, stores reports, and
  renders PDFs from the print view.
*/

const DAY_MS = 86_400_000;

export async function buildReportData(input: { brandId: string; type: ReportType; from: Date; to: Date }): Promise<ReportData> {
  return buildReport(input);
}

function reportTitle(type: ReportType, period: string | null, middle: Date): string {
  if (type === "audit") return "Full audit";
  if (type === "prospect") return "Prospect report";
  const match = period ? /^(\d{4})-(\d{2})$/.exec(period) : null;
  const month = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 15)) : middle;
  return `Monthly report, ${monthLabel(month)}`;
}

export async function createReport(input: {
  brandId: string;
  type: ReportType;
  from: Date;
  to: Date;
  /** "2026-09" for monthly reports. */
  period?: string;
}): Promise<{ reportId: string }> {
  const data = await buildReport(input);
  const middle = midpoint(input.from, input.to);
  const period = input.period ?? (input.type === "monthly" ? monthKey(middle) : null);
  const title = reportTitle(input.type, period, middle);
  const db = await getDb();

  // One monthly report per month: building it again refreshes it, unless it was already sent.
  if (input.type === "monthly" && period) {
    const [existing] = await db
      .select({ id: reports.id, status: reports.status })
      .from(reports)
      .where(and(eq(reports.brandId, input.brandId), eq(reports.type, "monthly"), eq(reports.period, period)))
      .limit(1);
    if (existing) {
      if (existing.status !== "sent") {
        await db.update(reports).set({ data, title }).where(eq(reports.id, existing.id));
      }
      return { reportId: existing.id };
    }
  }

  const [row] = await db
    .insert(reports)
    .values({ brandId: input.brandId, type: input.type, title, period, status: "ready", data })
    .returning({ id: reports.id });
  return { reportId: row.id };
}

/** Creates or renews a private share link. Prospect links expire after 30 days. */
export async function shareReport(reportId: string, days = 30): Promise<{ token: string; expiresAt: Date }> {
  const db = await getDb();
  const [report] = await db
    .select({ id: reports.id, shareToken: reports.shareToken, shareExpiresAt: reports.shareExpiresAt })
    .from(reports)
    .where(eq(reports.id, reportId))
    .limit(1);
  if (!report) throw new EngineError("This report could not be found. Reload the page and try again.");

  const now = new Date();
  const span = Math.min(365, Math.max(1, Math.round(days))) * DAY_MS;
  const renewedUntil = new Date(now.getTime() + span);
  if (report.shareToken && report.shareExpiresAt && report.shareExpiresAt > now) {
    // The link keeps working; sharing it again only extends it.
    if (renewedUntil > report.shareExpiresAt) {
      await db.update(reports).set({ shareExpiresAt: renewedUntil }).where(eq(reports.id, reportId));
      return { token: report.shareToken, expiresAt: renewedUntil };
    }
    return { token: report.shareToken, expiresAt: report.shareExpiresAt };
  }

  // 24 random bytes are exactly 32 URL-safe characters.
  const token = randomBytes(24).toString("base64url");
  await db.update(reports).set({ shareToken: token, shareExpiresAt: renewedUntil }).where(eq(reports.id, reportId));
  return { token, expiresAt: renewedUntil };
}

/**
 * Renders a report's print view to PDF with a local Chrome or Edge, through
 * playwright-core. Returns null when no browser is available, so the caller can
 * fall back to the browser's print dialog.
 */
export async function renderReportPdf(input: { url: string; cookieHeader?: string }): Promise<Uint8Array | null> {
  return renderPdf(input);
}
