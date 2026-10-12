"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actionError, fieldErrors, type ActionState } from "@/lib/actions";
import { requireAdmin } from "@/lib/auth/dal";
import { getDb, issues } from "@/lib/db";
import { SEVERITY_ORDER } from "@/lib/domain/constants";
import { approveIssue, rejectIssue } from "@/lib/engine";
import { nextPendingIssueId } from "@/lib/queries/admin-ops";

/** ActionState plus what was typed, so a failed submission keeps the note. */
export type ReviewFormState = ActionState & { values?: { note: string; severity: string } };

const reviewSchema = z
  .object({
    issueId: z.uuid(),
    decision: z.enum(["approve", "reject"], { error: "Choose Approve or Reject." }),
    severity: z.enum(SEVERITY_ORDER, { error: "Choose a severity from the list." }).optional(),
    note: z.string().trim().max(2000, "Keep the note under 2,000 characters."),
  })
  .superRefine((value, context) => {
    if (value.decision === "reject" && value.note.length < 5) {
      context.addIssue({
        code: "custom",
        path: ["note"],
        message: "Say why this is not an error. The note is kept and helps tune the checker.",
      });
    }
  });

/**
 * Approve or reject an issue waiting for review. Approving shows it to the client
 * and sends alerts by their rules; rejecting keeps it hidden. Both are recorded on
 * the issue's history by the engine. Afterwards, go to the next waiting item.
 */
export async function reviewIssue(_prev: ReviewFormState, formData: FormData): Promise<ReviewFormState> {
  const ctx = await requireAdmin();
  const values = { note: String(formData.get("note") ?? ""), severity: String(formData.get("severity") ?? "") };
  const parsed = reviewSchema.safeParse({
    issueId: formData.get("issueId"),
    decision: formData.get("decision"),
    severity: values.severity || undefined,
    note: values.note,
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrors(parsed.error), values };
  }
  const { issueId, decision, severity, note } = parsed.data;

  const db = await getDb();
  const [issue] = await db
    .select({ id: issues.id, reviewState: issues.reviewState, severity: issues.severity })
    .from(issues)
    .where(eq(issues.id, issueId))
    .limit(1);
  if (!issue) return { ok: false, message: "This issue no longer exists. Go back to the queue for the next one." };
  if (issue.reviewState !== "pending") {
    return { ok: false, message: "Someone already reviewed this issue. Reload the page to see their decision." };
  }

  const reviewer = { id: ctx.user.id, name: ctx.user.name };
  try {
    if (decision === "approve") {
      await approveIssue({
        issueId,
        reviewer,
        note: note || undefined,
        severity: severity && severity !== issue.severity ? severity : undefined,
      });
    } else {
      await rejectIssue({ issueId, reviewer, note });
    }
  } catch (error) {
    return { ...actionError(error), values };
  }

  const outcome = new URLSearchParams({ reviewed: issueId });
  const next = await nextPendingIssueId(issueId);
  // The sidebar counts live in the admin layout; refresh them too.
  revalidatePath("/admin", "layout");
  redirect(next ? `/admin/review/${next}?${outcome}` : `/admin/review?${outcome}`);
}
