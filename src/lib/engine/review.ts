import "server-only";
import { eq } from "drizzle-orm";
import { getDb, issueEvents, issues } from "@/lib/db";
import { IMPORTANCE, type Severity } from "@/lib/domain/constants";
import { sendInstantAlerts } from "./alerts";
import { EngineError } from "./errors";

/*
  The admin review queue. Approving an issue makes it visible to the client and
  sends alerts by the client's alert rules; rejecting keeps a false alarm away
  from the client. Both are written to the issue's evidence trail.
*/

export type Reviewer = { id: string; name: string };

export async function approveIssue(input: {
  issueId: string;
  reviewer: Reviewer;
  note?: string;
  /** Optional severity correction made during review. */
  severity?: Severity;
}): Promise<void> {
  const db = await getDb();
  const [issue] = await db.select().from(issues).where(eq(issues.id, input.issueId)).limit(1);
  if (!issue) throw new EngineError("That issue no longer exists. Refresh the review queue.");

  const note = input.note?.trim() || null;
  const severityChanged = input.severity && input.severity !== issue.severity ? input.severity : null;
  const wasApproved = issue.reviewState === "approved";
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(issues)
      .set({
        reviewState: "approved",
        reviewNote: note ?? issue.reviewNote,
        ...(severityChanged ? { severity: severityChanged } : {}),
        updatedAt: now,
      })
      .where(eq(issues.id, issue.id));
    if (severityChanged) {
      await tx.insert(issueEvents).values({
        issueId: issue.id,
        kind: "severity",
        actorId: input.reviewer.id,
        actorName: input.reviewer.name,
        note: `Severity changed from ${IMPORTANCE[issue.severity].label} to ${IMPORTANCE[severityChanged].label} in review.`,
      });
    }
    if (!wasApproved) {
      await tx.insert(issueEvents).values({
        issueId: issue.id,
        kind: "approved",
        actorId: input.reviewer.id,
        actorName: input.reviewer.name,
        note: note ?? "Approved in review.",
      });
    }
  });

  // Alerts go out once, when the issue first becomes visible to the client.
  if (!wasApproved && !issue.dismissedAt) await sendInstantAlerts(issue.id);
}

export async function rejectIssue(input: { issueId: string; reviewer: Reviewer; note: string }): Promise<void> {
  const db = await getDb();
  const [issue] = await db.select().from(issues).where(eq(issues.id, input.issueId)).limit(1);
  if (!issue) throw new EngineError("That issue no longer exists. Refresh the review queue.");
  const note = input.note.trim();
  if (!note) throw new EngineError("Add a short reason, so the checker's mistake can be reviewed later.");
  if (issue.reviewState === "rejected" && issue.reviewNote === note) return;

  await db.transaction(async (tx) => {
    await tx.update(issues).set({ reviewState: "rejected", reviewNote: note, updatedAt: new Date() }).where(eq(issues.id, issue.id));
    await tx.insert(issueEvents).values({
      issueId: issue.id,
      kind: "rejected",
      actorId: input.reviewer.id,
      actorName: input.reviewer.name,
      note,
    });
  });
}
