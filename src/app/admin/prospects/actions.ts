"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actionError, fieldErrors, type ActionState } from "@/lib/actions";
import { requireAdmin } from "@/lib/auth/dal";
import { auditLog, checkRequests, getDb, prospects } from "@/lib/db";

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .transform((value) => value || null);

const prospectSchema = z.object({
  company: z.string().trim().min(2, "Enter the company's name.").max(120, "Keep the name under 120 characters."),
  website: z
    .string()
    .trim()
    .min(4, "Enter the company's website.")
    .transform((value) => (/^https?:\/\//i.test(value) ? value : `https://${value}`))
    .refine((value) => {
      try {
        return new URL(value).hostname.includes(".");
      } catch {
        return false;
      }
    }, "Enter a full website address, such as treyresearch.com."),
  industry: optional(80),
  contactName: optional(120),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .refine((value) => value === "" || z.email().safeParse(value).success, "Enter an email address such as name@company.com, or leave it empty.")
    .transform((value) => value || null),
  contactRole: optional(120),
});

/** "Add prospect": a company to run a prospect scan for. */
export async function addProspect(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const parsed = prospectSchema.safeParse({
    company: formData.get("company") ?? "",
    website: formData.get("website") ?? "",
    industry: formData.get("industry") ?? "",
    contactName: formData.get("contactName") ?? "",
    contactEmail: formData.get("contactEmail") ?? "",
    contactRole: formData.get("contactRole") ?? "",
  });
  if (!parsed.success) return { ok: false, message: "Some fields need attention.", fieldErrors: fieldErrors(parsed.error) };

  let id: string;
  try {
    const db = await getDb();
    const [created] = await db
      .insert(prospects)
      .values({ ...parsed.data, website: new URL(parsed.data.website).origin, source: "outbound", status: "new" })
      .returning({ id: prospects.id });
    id = created.id;
    await db.insert(auditLog).values({
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      action: `Added prospect ${parsed.data.company}`,
      target: id,
    });
  } catch (error) {
    return actionError(error);
  }
  redirect(`/admin/prospects/${id}?done=added`);
}

const requestSchema = z.object({ requestId: z.uuid() });
const GONE = "This request was already handled. Reload the page to see the current list.";

/** "Accept": turns a free check request into a prospect, linked back to the request. */
export async function acceptRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const parsed = requestSchema.safeParse({ requestId: formData.get("requestId") });
  if (!parsed.success) return { ok: false, message: GONE };

  let prospectId: string;
  try {
    const db = await getDb();
    const [request] = await db
      .select()
      .from(checkRequests)
      .where(and(eq(checkRequests.id, parsed.data.requestId), eq(checkRequests.status, "new")))
      .limit(1);
    if (!request) return { ok: false, message: GONE };

    const [created] = await db
      .insert(prospects)
      .values({
        company: request.company,
        website: request.website,
        contactName: request.name,
        contactEmail: request.email,
        contactRole: request.role,
        notes: request.message ? `From the free check request: ${request.message}` : null,
        source: "free_check",
        status: "new",
      })
      .returning({ id: prospects.id });
    prospectId = created.id;
    await db.update(checkRequests).set({ status: "accepted", prospectId }).where(eq(checkRequests.id, request.id));
    await db.insert(auditLog).values({
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      action: `Accepted the free check request from ${request.company}`,
      target: prospectId,
    });
  } catch (error) {
    return actionError(error);
  }
  redirect(`/admin/prospects/${prospectId}?done=accepted`);
}

/** "Decline": the request stays on record but leaves the queue. */
export async function declineRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const parsed = requestSchema.safeParse({ requestId: formData.get("requestId") });
  if (!parsed.success) return { ok: false, message: GONE };

  try {
    const db = await getDb();
    const [request] = await db
      .update(checkRequests)
      .set({ status: "declined" })
      .where(and(eq(checkRequests.id, parsed.data.requestId), eq(checkRequests.status, "new")))
      .returning({ company: checkRequests.company });
    if (!request) return { ok: false, message: GONE };
    await db.insert(auditLog).values({
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      action: `Declined the free check request from ${request.company}`,
      target: parsed.data.requestId,
    });
  } catch (error) {
    return actionError(error);
  }
  refresh();
  return { ok: true, message: "Request declined." };
}
