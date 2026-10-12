"use server";

import { z } from "zod";
import { requireOwner } from "@/lib/auth/dal";
import { actionError, fieldErrors, type ActionState } from "@/lib/actions";
import { getDb, outbox } from "@/lib/db";
import { PLANS, ROLES } from "@/lib/domain/constants";
import { sendEmail } from "@/lib/engine";
import { recordAudit } from "@/lib/queries/account";

export type PlanChangeState = ActionState & { values?: { plan: string; note: string } };

const REQUESTABLE = ["starter", "professional", "enterprise"] as const;

const planChangeSchema = z.object({
  plan: z.enum(REQUESTABLE, { error: "Choose the plan you want." }),
  note: z.string().trim().max(1000, "Keep the note under 1,000 characters."),
});

/** Asks the TrueCite team to change the plan. Nothing changes until they confirm by email. */
export async function requestPlanChange(_prev: PlanChangeState, formData: FormData): Promise<PlanChangeState> {
  const values = { plan: String(formData.get("plan") ?? ""), note: String(formData.get("note") ?? "") };
  try {
    const ctx = await requireOwner();
    const parsed = planChangeSchema.safeParse(values);
    if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error), values };
    const current = PLANS[ctx.organization.plan];
    const wanted = PLANS[parsed.data.plan];
    if (parsed.data.plan === ctx.organization.plan) {
      return { ok: false, fieldErrors: { plan: `You are already on the ${current.label} plan. Choose another plan.` }, values };
    }

    const subject = `Plan change request: ${ctx.organization.name}, ${current.label} to ${wanted.label}`;
    const body = [
      `${ctx.user.name} (${ctx.user.email}, ${ROLES[ctx.role].label.toLowerCase()}) asked to change ${ctx.organization.name}'s plan.`,
      "",
      `Current plan: ${current.label}`,
      `Requested plan: ${wanted.label}`,
      `Brand: ${ctx.brand.name} (${ctx.brand.website})`,
      `Billing currency: ${ctx.organization.currency}`,
      "",
      parsed.data.note ? `Note: ${parsed.data.note}` : "No note added.",
      "",
      `Reply to ${ctx.user.email} to confirm the new price and start date.`,
    ].join("\n");

    const teamEmail = process.env.TRUECITE_TEAM_EMAIL?.trim();
    if (teamEmail) {
      const { status } = await sendEmail({ organizationId: ctx.organization.id, to: teamEmail, subject, body });
      if (status === "failed") {
        return {
          ok: false,
          values,
          message: "The request did not go through. Try again in a few minutes.",
        };
      }
    } else {
      // No team address configured: keep the request in the outbox, where the TrueCite team reads it.
      const db = await getDb();
      await db.insert(outbox).values({
        organizationId: ctx.organization.id,
        channel: "email",
        recipient: "TrueCite team",
        subject,
        body,
        status: "logged",
      });
    }

    await recordAudit(ctx, "Asked to change plan", wanted.label, { from: ctx.organization.plan, to: parsed.data.plan });
    return {
      ok: true,
      message: `TrueCite will reply to ${ctx.user.email} to confirm the price and start date of the ${wanted.label} plan. Your current plan stays as it is until then.`,
    };
  } catch (error) {
    return { ...actionError(error), values };
  }
}
