"use server";

import { and, eq, gte } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { requireEditor, sameBrand, type ClientContext } from "@/lib/auth/dal";
import { actionError, type ActionState } from "@/lib/actions";
import { getDb, issueEvents, issues, memberships, users, type Issue, type IssueEvent } from "@/lib/db";
import { ISSUE_STATUSES, ISSUE_STATUS_ORDER } from "@/lib/domain/constants";
import { PLAYBOOK } from "@/lib/domain/playbook";
import { canTransition } from "@/lib/domain/workflow";
import { startRecheck } from "@/lib/engine";

/*
  Changes a client's team makes to an issue. Every change writes an
  issue_events row with who made it: legal teams rely on that trail.
*/

const issueNumber = z.coerce.number().int().positive();

type EventInput = Pick<IssueEvent, "kind"> & Partial<Pick<IssueEvent, "fromStatus" | "toStatus" | "note">>;

function event(ctx: ClientContext, issue: Issue, input: EventInput) {
  return {
    issueId: issue.id,
    kind: input.kind,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    note: input.note ?? null,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    createdAt: ctx.now,
  };
}

/** Loads an issue the team may change: this brand's, approved by review, not marked "Not an error". */
async function loadEditable(ctx: ClientContext, number: number): Promise<Issue> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.brandId, ctx.brand.id), eq(issues.number, number)))
    .limit(1);
  const issue = sameBrand(row, ctx);
  if (issue.reviewState !== "approved") throw new IssueChangeError("This issue is not available. Go back to the list of issues.");
  if (issue.dismissedAt) {
    throw new IssueChangeError("This issue is marked as not an error, so it can no longer be changed.");
  }
  return issue;
}

class IssueChangeError extends Error {}

function failure(error: unknown): ActionState {
  // notFound() and redirect() work by throwing; let Next.js handle them.
  unstable_rethrow(error);
  if (error instanceof IssueChangeError) return { ok: false, message: error.message };
  return actionError(error);
}

/* Status --------------------------------------------------------------- */

const statusSchema = z.object({
  number: issueNumber,
  to: z.enum(ISSUE_STATUS_ORDER),
});

export async function changeStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireEditor();
    const input = statusSchema.parse({ number: formData.get("number"), to: formData.get("to") });
    const issue = await loadEditable(ctx, input.number);
    if (issue.status === input.to) {
      return { ok: true, message: `Already ${ISSUE_STATUSES[input.to].label.toLowerCase()}.` };
    }
    if (!canTransition(issue.status, input.to)) {
      return {
        ok: false,
        message: `An issue that is ${ISSUE_STATUSES[issue.status].label.toLowerCase()} can't move to ${ISSUE_STATUSES[input.to].label.toLowerCase()} by hand. Reload the page to see its current status.`,
      };
    }

    const db = await getDb();
    await db.transaction(async (tx) => {
      await tx
        .update(issues)
        .set({
          status: input.to,
          updatedAt: ctx.now,
          // Resolving needs clean scans after the fix, so the count starts again.
          ...(input.to === "fixed_rechecking"
            ? { cleanScanStreak: 0, nextCheckAt: issue.nextCheckAt ?? ctx.brand.nextScanAt }
            : {}),
        })
        .where(eq(issues.id, issue.id));
      await tx.insert(issueEvents).values(event(ctx, issue, { kind: "status", fromStatus: issue.status, toStatus: input.to }));
    });
    refresh();
    return {
      ok: true,
      message:
        input.to === "fixed_rechecking"
          ? "Marked as fixed. TrueCite re-checks it on the next scan, and it moves to Resolved after two clean scans in a row."
          : `Moved to ${ISSUE_STATUSES[input.to].label.toLowerCase()}.`,
    };
  } catch (error) {
    return failure(error);
  }
}

/* Re-check ------------------------------------------------------------- */

export async function recheckIssue(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireEditor();
    const number = issueNumber.parse(formData.get("number"));
    const issue = await loadEditable(ctx, number);
    const startedAt = ctx.now;
    await startRecheck({ issueId: issue.id, triggeredBy: ctx.user.id });

    // The engine may record the re-check itself; write it here only if it did not.
    const db = await getDb();
    const [recorded] = await db
      .select({ id: issueEvents.id })
      .from(issueEvents)
      .where(and(eq(issueEvents.issueId, issue.id), eq(issueEvents.kind, "recheck"), gte(issueEvents.createdAt, startedAt)))
      .limit(1);
    if (!recorded) await db.insert(issueEvents).values(event(ctx, issue, { kind: "recheck" }));

    refresh();
    return { ok: true, message: "Re-check started" };
  } catch (error) {
    return failure(error);
  }
}

/* Assignee ------------------------------------------------------------- */

const assignSchema = z.object({
  number: issueNumber,
  assigneeId: z.union([z.literal(""), z.guid("Choose someone from your team.")]),
});

export async function assignIssue(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireEditor();
    const input = assignSchema.parse({ number: formData.get("number"), assigneeId: formData.get("assigneeId") ?? "" });
    const issue = await loadEditable(ctx, input.number);
    const assigneeId = input.assigneeId || null;
    if (assigneeId === issue.assigneeId) return { ok: true, message: "No change." };

    const db = await getDb();
    let assigneeName: string | null = null;
    if (assigneeId) {
      const [member] = await db
        .select({ name: users.name, role: memberships.role })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.organizationId, ctx.organization.id), eq(memberships.userId, assigneeId)))
        .limit(1);
      if (!member) return { ok: false, fieldErrors: { assigneeId: "Choose someone from your team." } };
      if (member.role === "viewer") {
        return { ok: false, fieldErrors: { assigneeId: `${member.name} is a viewer. Ask an owner to give them member access first.` } };
      }
      assigneeName = member.name;
    }

    await db.transaction(async (tx) => {
      await tx.update(issues).set({ assigneeId, updatedAt: ctx.now }).where(eq(issues.id, issue.id));
      await tx
        .insert(issueEvents)
        .values(event(ctx, issue, { kind: "assigned", note: assigneeName ? `Assigned to ${assigneeName}` : "Removed the assignee" }));
    });
    refresh();
    return { ok: true, message: assigneeName ? `Assigned to ${assigneeName}.` : "Nobody is assigned now." };
  } catch (error) {
    return failure(error);
  }
}

/* Notes ---------------------------------------------------------------- */

const noteSchema = z.object({
  number: issueNumber,
  note: z
    .string()
    .trim()
    .min(1, "Write the note first.")
    .max(2000, "Keep the note under 2,000 characters."),
});

export async function addNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireEditor();
    const parsed = noteSchema.safeParse({ number: formData.get("number"), note: formData.get("note") ?? "" });
    if (!parsed.success) return actionError(parsed.error);
    const issue = await loadEditable(ctx, parsed.data.number);
    const db = await getDb();
    await db.insert(issueEvents).values(event(ctx, issue, { kind: "note", note: parsed.data.note }));
    await db.update(issues).set({ updatedAt: ctx.now }).where(eq(issues.id, issue.id));
    refresh();
    return { ok: true, message: "Note added to the history." };
  } catch (error) {
    return failure(error);
  }
}

/* Fix steps ------------------------------------------------------------ */

const fixStepSchema = z.object({
  number: issueNumber,
  step: z.number().int().min(0),
  done: z.boolean(),
});

/** Ticks or unticks one Fix Playbook step. Called directly from the checklist. */
export async function setFixStep(input: { number: number; step: number; done: boolean }): Promise<ActionState> {
  try {
    const ctx = await requireEditor();
    const { number, step, done } = fixStepSchema.parse(input);
    const issue = await loadEditable(ctx, number);
    const steps = PLAYBOOK[issue.type].steps as readonly string[];
    if (step >= steps.length) return { ok: false, message: "That fix step no longer exists. Reload the page." };

    const progress = new Set(issue.fixProgress);
    if (progress.has(step) === done) return { ok: true };
    if (done) progress.add(step);
    else progress.delete(step);

    const db = await getDb();
    await db.transaction(async (tx) => {
      await tx
        .update(issues)
        .set({ fixProgress: [...progress].sort((a, b) => a - b), updatedAt: ctx.now })
        .where(eq(issues.id, issue.id));
      await tx
        .insert(issueEvents)
        .values(event(ctx, issue, { kind: "fix_step", note: `${done ? "Done" : "Not done"}: ${steps[step]}` }));
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

/* Not an error --------------------------------------------------------- */

const dismissSchema = z.object({
  number: issueNumber,
  note: z
    .string()
    .trim()
    .min(3, "Say briefly why this is not an error, such as “This price is correct for India.”")
    .max(500, "Keep the note under 500 characters."),
});

export async function dismissIssue(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let number: number;
  try {
    const ctx = await requireEditor();
    const parsed = dismissSchema.safeParse({ number: formData.get("number"), note: formData.get("note") ?? "" });
    if (!parsed.success) return actionError(parsed.error);
    const issue = await loadEditable(ctx, parsed.data.number);
    const db = await getDb();
    await db.transaction(async (tx) => {
      await tx
        .update(issues)
        .set({ dismissedAt: ctx.now, dismissedBy: ctx.user.id, dismissNote: parsed.data.note, updatedAt: ctx.now })
        .where(eq(issues.id, issue.id));
      await tx.insert(issueEvents).values(event(ctx, issue, { kind: "not_an_error", note: parsed.data.note }));
    });
    number = issue.number;
  } catch (error) {
    return failure(error);
  }
  redirect(`/app/issues?dismissed=${number}`);
}
