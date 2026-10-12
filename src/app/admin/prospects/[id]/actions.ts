"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { actionError, fieldErrors, type ActionState } from "@/lib/actions";
import { requireAdmin } from "@/lib/auth/dal";
import { auditLog, getDb, prospects } from "@/lib/db";
import { PROSPECT_STATUSES, type ProspectStatus } from "@/lib/domain/constants";
import { createProspectReport, startProspectScan } from "@/lib/engine";

const MISSING = "This prospect no longer exists. Go back to Prospects.";

const idSchema = z.object({ prospectId: z.uuid() });

async function loadProspect(formData: FormData) {
  const parsed = idSchema.safeParse({ prospectId: formData.get("prospectId") });
  if (!parsed.success) return null;
  const db = await getDb();
  const [prospect] = await db.select().from(prospects).where(eq(prospects.id, parsed.data.prospectId)).limit(1);
  return prospect ?? null;
}

const statusSchema = z.object({
  status: z.enum(Object.keys(PROSPECT_STATUSES) as [ProspectStatus, ...ProspectStatus[]], { error: "Choose a status from the list." }),
  notes: z
    .string()
    .trim()
    .max(4000, "Keep notes under 4,000 characters.")
    .transform((value) => value || null),
  contactName: z
    .string()
    .trim()
    .max(120, "Keep the name under 120 characters.")
    .transform((value) => value || null),
  contactRole: z
    .string()
    .trim()
    .max(120, "Keep the role under 120 characters.")
    .transform((value) => value || null),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .refine((value) => value === "" || z.email().safeParse(value).success, "Enter an email address such as name@company.com, or leave it empty.")
    .transform((value) => value || null),
});

/** "Save changes": contact, status and notes. */
export async function updateProspect(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const prospect = await loadProspect(formData);
  if (!prospect) return { ok: false, message: MISSING };
  const parsed = statusSchema.safeParse({
    status: formData.get("status"),
    notes: formData.get("notes") ?? "",
    contactName: formData.get("contactName") ?? "",
    contactRole: formData.get("contactRole") ?? "",
    contactEmail: formData.get("contactEmail") ?? "",
  });
  if (!parsed.success) return { ok: false, message: "Some fields need attention.", fieldErrors: fieldErrors(parsed.error) };

  try {
    const db = await getDb();
    await db
      .update(prospects)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(prospects.id, prospect.id));
    if (parsed.data.status !== prospect.status) {
      await db.insert(auditLog).values({
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        action: `Moved prospect ${prospect.company} from ${PROSPECT_STATUSES[prospect.status].label} to ${PROSPECT_STATUSES[parsed.data.status].label}`,
        target: prospect.id,
      });
    }
  } catch (error) {
    return actionError(error);
  }
  refresh();
  return { ok: true, message: "Changes saved." };
}

/** "Run prospect scan" */
export async function runProspectScan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const prospect = await loadProspect(formData);
  if (!prospect) return { ok: false, message: MISSING };

  try {
    await startProspectScan({ prospectId: prospect.id, triggeredBy: ctx.user.id });
    const db = await getDb();
    await db.insert(auditLog).values({
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      action: `Started a prospect scan for ${prospect.company}`,
      target: prospect.id,
    });
  } catch (error) {
    return actionError(error);
  }
  refresh();
  return { ok: true, message: "Prospect scan started. Findings appear below and in the review queue as answers are checked." };
}

/** "Create report" */
export async function createReportAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const prospect = await loadProspect(formData);
  if (!prospect) return { ok: false, message: MISSING };

  try {
    const { reportId } = await createProspectReport(prospect.id);
    const db = await getDb();
    await db.insert(auditLog).values({
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      action: `${prospect.reportId ? "Refreshed" : "Created"} the prospect report for ${prospect.company}`,
      target: prospect.id,
      detail: { reportId },
    });
  } catch (error) {
    return actionError(error);
  }
  refresh();
  return { ok: true, message: "Report created. The private link is below." };
}
