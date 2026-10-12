"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireEditor } from "@/lib/auth/dal";
import { actionError, type ActionState } from "@/lib/actions";
import { getDb, reports } from "@/lib/db";
import { formatDate } from "@/lib/domain/format";
import { createReport, shareReport } from "@/lib/engine";
import { findMonthlyReport, isUuid, lastMonthPeriod, recordAudit } from "@/lib/queries/account";

/** How long a share link made from the app works. */
const SHARE_DAYS = 30;

const MISSING = "That report no longer exists. Go back to Reports and open it again.";

/** Creates the monthly report for last month and opens it. If it already exists, opens that one. */
export async function createLastMonthReport(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  void _formData;
  let reportId: string;
  try {
    const ctx = await requireEditor();
    const month = lastMonthPeriod(ctx.now);
    const existing = await findMonthlyReport(ctx.brand.id, month.period);
    if (existing) {
      reportId = existing.id;
    } else {
      const created = await createReport({
        brandId: ctx.brand.id,
        type: "monthly",
        from: month.from,
        to: month.to,
        period: month.period,
      });
      reportId = created.reportId;
      await recordAudit(ctx, "Created a report", `Monthly report, ${month.label}`, { reportId });
    }
  } catch (error) {
    return actionError(error);
  }
  redirect(`/app/reports/${reportId}`);
}

async function ownReport(id: string, brandId: string) {
  if (!isUuid(id)) return null;
  const db = await getDb();
  const [report] = await db
    .select({ id: reports.id, title: reports.title })
    .from(reports)
    .where(and(eq(reports.id, id), eq(reports.brandId, brandId)))
    .limit(1);
  return report ?? null;
}

/** Creates or renews the private link to a report. */
export async function shareReportLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireEditor();
    const report = await ownReport(String(formData.get("id") ?? ""), ctx.brand.id);
    if (!report) return { ok: false, message: MISSING };
    const { expiresAt } = await shareReport(report.id, SHARE_DAYS);
    await recordAudit(ctx, "Shared a report by link", report.title, { expiresAt: expiresAt.toISOString() });
    refresh();
    return { ok: true, message: `Share link ready. It works until ${formatDate(expiresAt)}.` };
  } catch (error) {
    return actionError(error);
  }
}

/** Turns the private link off at once. Anyone who opens it then sees that it has expired. */
export async function stopSharingReport(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireEditor();
    const report = await ownReport(String(formData.get("id") ?? ""), ctx.brand.id);
    if (!report) return { ok: false, message: MISSING };
    const db = await getDb();
    await db
      .update(reports)
      .set({ shareToken: null, shareExpiresAt: null })
      .where(and(eq(reports.id, report.id), eq(reports.brandId, ctx.brand.id)));
    await recordAudit(ctx, "Turned off a report link", report.title);
    refresh();
    return { ok: true, message: "Link turned off." };
  } catch (error) {
    return actionError(error);
  }
}
