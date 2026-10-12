"use server";

import { and, count, eq, isNull, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/dal";
import { hashToken, newToken } from "@/lib/auth/session";
import { actionError, fieldErrors, type ActionState } from "@/lib/actions";
import { getDb, invites, memberships, users } from "@/lib/db";
import { PLANS, ROLES, type Role } from "@/lib/domain/constants";
import { sendEmail } from "@/lib/engine";
import { appOrigin, isUuid, recordAudit, seatsInUse } from "@/lib/queries/account";

export type InviteFormState = ActionState & { values?: { email: string; role: string } };

const ROLE_IDS = Object.keys(ROLES) as [Role, ...Role[]];

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter the person's work email address."),
  role: z.enum(ROLE_IDS, { error: "Choose a role." }),
});

const MEMBER_MISSING = "That person is no longer on the team. Reload the page.";

function article(role: Role): string {
  return role === "owner" ? "an owner" : `a ${ROLES[role].label.toLowerCase()}`;
}

async function ownerCount(organizationId: string): Promise<number> {
  const db = await getDb();
  const [{ value }] = await db
    .select({ value: count() })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.role, "owner")));
  return value;
}

export async function inviteMember(_prev: InviteFormState, formData: FormData): Promise<InviteFormState> {
  const values = { email: String(formData.get("email") ?? ""), role: String(formData.get("role") ?? "member") };
  try {
    const ctx = await requireOwner();
    const parsed = inviteSchema.safeParse(values);
    if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error), values };
    const { email, role } = parsed.data;
    const organizationId = ctx.organization.id;
    const plan = PLANS[ctx.organization.plan];
    const db = await getDb();

    const [member] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.organizationId, organizationId), sql`lower(${users.email}) = ${email}`))
      .limit(1);
    if (member) return { ok: false, fieldErrors: { email: "This person is already on the team." }, values };

    const [pending] = await db
      .select({ id: invites.id })
      .from(invites)
      .where(and(eq(invites.organizationId, organizationId), isNull(invites.acceptedAt), sql`lower(${invites.email}) = ${email}`))
      .limit(1);
    if (pending) {
      return {
        ok: false,
        fieldErrors: { email: "This person already has an invitation. Revoke it below to send a new one." },
        values,
      };
    }

    if (typeof plan.teamMembers === "number" && (await seatsInUse(organizationId)) >= plan.teamMembers) {
      return {
        ok: false,
        values,
        message: `The ${plan.label} plan includes ${plan.teamMembers} people, counting invitations. Remove someone or revoke an invitation first, or ask to change plan on the Billing page.`,
      };
    }

    const token = newToken();
    const [invite] = await db
      .insert(invites)
      .values({ organizationId, email, role, invitedBy: ctx.user.id, tokenHash: hashToken(token) })
      .returning({ id: invites.id });

    const link = `${await appOrigin()}/invite/${token}`;
    const body = [
      `${ctx.user.name} invited you to join ${ctx.organization.name} on TrueCite as ${article(role)}.`,
      "",
      `TrueCite shows what AI assistants such as ChatGPT, Gemini, Perplexity and Claude say about ${ctx.brand.name}, what is wrong and how to fix it.`,
      `As ${article(role)}, you ${ROLES[role].description.charAt(0).toLowerCase()}${ROLES[role].description.slice(1)}.`,
      "",
      `Accept the invitation: ${link}`,
      "",
      `If you were not expecting this, you can ignore this email. Questions about it can go to ${ctx.user.name} at ${ctx.user.email}.`,
    ].join("\n");

    let delivery: "sent" | "logged" | "failed";
    try {
      ({ status: delivery } = await sendEmail({
        organizationId,
        to: email,
        subject: `${ctx.user.name} invited you to ${ctx.organization.name} on TrueCite`,
        body,
      }));
    } catch (error) {
      await db.delete(invites).where(eq(invites.id, invite.id));
      throw error;
    }
    if (delivery === "failed") {
      await db.delete(invites).where(eq(invites.id, invite.id));
      return {
        ok: false,
        values,
        message: `The invitation email to ${email} did not go through. Check the address and send it again.`,
      };
    }

    await recordAudit(ctx, "Invited a team member", email, { role });
    refresh();
    return {
      ok: true,
      message:
        delivery === "sent"
          ? `Invitation sent to ${email}. They appear under Pending invitations until they join.`
          : `Invitation created for ${email}. Email delivery is not set up yet, so the email was recorded instead of sent.`,
    };
  } catch (error) {
    return { ...actionError(error), values };
  }
}

export async function changeRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireOwner();
    const id = String(formData.get("membershipId") ?? "");
    const parsedRole = z.enum(ROLE_IDS).safeParse(formData.get("role"));
    if (!parsedRole.success) return { ok: false, message: "Choose a role." };
    if (!isUuid(id)) return { ok: false, message: MEMBER_MISSING };
    const role = parsedRole.data;
    const db = await getDb();
    const [member] = await db
      .select({ id: memberships.id, role: memberships.role, name: users.name, userId: users.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.id, id), eq(memberships.organizationId, ctx.organization.id)))
      .limit(1);
    if (!member) return { ok: false, message: MEMBER_MISSING };
    if (member.role === role) return { ok: true, message: `${member.name} is already ${article(role)}.` };
    if (member.role === "owner" && (await ownerCount(ctx.organization.id)) <= 1) {
      return {
        ok: false,
        message: `${ctx.organization.name} needs at least one owner. Make someone else an owner first.`,
      };
    }
    await db.update(memberships).set({ role }).where(eq(memberships.id, member.id));
    await recordAudit(ctx, "Changed a team member's role", member.name, { from: member.role, to: role });
    refresh();
    return {
      ok: true,
      message: member.userId === ctx.user.id ? `You are now ${article(role)}.` : `${member.name} is now ${article(role)}.`,
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function removeMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireOwner();
    const id = String(formData.get("membershipId") ?? "");
    if (!isUuid(id)) return { ok: false, message: MEMBER_MISSING };
    const db = await getDb();
    const [member] = await db
      .select({ id: memberships.id, role: memberships.role, name: users.name, userId: users.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.id, id), eq(memberships.organizationId, ctx.organization.id)))
      .limit(1);
    if (!member) return { ok: false, message: MEMBER_MISSING };
    if (member.userId === ctx.user.id) {
      return { ok: false, message: "You can't remove yourself. Ask another owner to remove you." };
    }
    if (member.role === "owner" && (await ownerCount(ctx.organization.id)) <= 1) {
      return { ok: false, message: `${ctx.organization.name} needs at least one owner.` };
    }
    await db.delete(memberships).where(eq(memberships.id, member.id));
    await recordAudit(ctx, "Removed a team member", member.name, { role: member.role });
    refresh();
    return { ok: true, message: `${member.name} removed.` };
  } catch (error) {
    return actionError(error);
  }
}

export async function revokeInvite(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireOwner();
    const id = String(formData.get("inviteId") ?? "");
    if (!isUuid(id)) return { ok: false, message: "That invitation no longer exists. Reload the page." };
    const db = await getDb();
    const [revoked] = await db
      .delete(invites)
      .where(and(eq(invites.id, id), eq(invites.organizationId, ctx.organization.id), isNull(invites.acceptedAt)))
      .returning({ email: invites.email });
    if (!revoked) return { ok: false, message: "That invitation was already accepted or revoked. Reload the page." };
    await recordAudit(ctx, "Revoked an invitation", revoked.email);
    refresh();
    return { ok: true, message: `Invitation for ${revoked.email} revoked.` };
  } catch (error) {
    return actionError(error);
  }
}
