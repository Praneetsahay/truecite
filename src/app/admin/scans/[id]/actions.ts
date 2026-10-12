"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actionError, type ActionState } from "@/lib/actions";
import { requireAdmin } from "@/lib/auth/dal";
import { auditLog, getDb } from "@/lib/db";
import { SCAN_TYPES } from "@/lib/domain/constants";
import { formatDate, plural } from "@/lib/domain/format";
import { cancelScan, retryFailedJobs } from "@/lib/engine";
import { ACTIVE_SCAN_STATUSES, getScanOwner } from "@/lib/queries/admin-ops";

const scanSchema = z.object({ scanId: z.uuid() });

const MISSING = "This scan no longer exists. Go back to Scans and jobs.";

/** "Retry failed jobs": puts a scan's failed jobs back in the queue. */
export async function retryJobs(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const parsed = scanSchema.safeParse({ scanId: formData.get("scanId") });
  if (!parsed.success) return { ok: false, message: MISSING };
  const owner = await getScanOwner(parsed.data.scanId);
  if (!owner) return { ok: false, message: MISSING };

  let retried: number;
  try {
    ({ retried } = await retryFailedJobs(owner.scanId));
  } catch (error) {
    return actionError(error);
  }

  const db = await getDb();
  await db.insert(auditLog).values({
    organizationId: owner.organizationId,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: `Retried ${plural(retried, "failed job")} in the ${SCAN_TYPES[owner.type].label.toLowerCase()} scan of ${formatDate(owner.createdAt)}`,
    target: owner.scanId,
  });
  // The sidebar counts live in the admin layout; refresh them too.
  revalidatePath("/admin", "layout");
  redirect(`/admin/scans/${owner.scanId}?${new URLSearchParams({ done: "retried", count: String(retried) })}`);
}

/** "Cancel scan": stops a scan that is still queued, asking or checking. */
export async function cancelScanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const parsed = scanSchema.safeParse({ scanId: formData.get("scanId") });
  if (!parsed.success) return { ok: false, message: MISSING };
  const owner = await getScanOwner(parsed.data.scanId);
  if (!owner) return { ok: false, message: MISSING };
  if (!(ACTIVE_SCAN_STATUSES as readonly string[]).includes(owner.status)) {
    return { ok: false, message: "This scan has already stopped, so there is nothing to cancel." };
  }

  try {
    await cancelScan(owner.scanId);
  } catch (error) {
    return actionError(error);
  }

  const db = await getDb();
  await db.insert(auditLog).values({
    organizationId: owner.organizationId,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: `Cancelled the ${SCAN_TYPES[owner.type].label.toLowerCase()} scan of ${formatDate(owner.createdAt)}`,
    target: owner.scanId,
  });
  // The sidebar counts live in the admin layout; refresh them too.
  revalidatePath("/admin", "layout");
  redirect(`/admin/scans/${owner.scanId}?done=cancelled`);
}
