"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { requireEditor } from "@/lib/auth/dal";
import { actionError, fieldErrors, type ActionState } from "@/lib/actions";
import { competitors, getDb } from "@/lib/db";
import { PLANS } from "@/lib/domain/constants";
import { domainOf } from "@/lib/domain/format";
import { countCompetitors, isUuid, recordAudit } from "@/lib/queries/account";

export type CompetitorFormState = ActionState & { values?: { name: string; website: string } };

const competitorSchema = z.object({
  name: z.string().trim().min(2, "Enter the competitor's name.").max(80, "Use a shorter name, up to 80 characters."),
  website: z
    .string()
    .trim()
    .min(4, "Enter the competitor's website.")
    .transform((value) => (/^https?:\/\//i.test(value) ? value : `https://${value}`))
    .refine((value) => {
      try {
        return new URL(value).hostname.includes(".");
      } catch {
        return false;
      }
    }, "Enter a full website address, such as northwind.example."),
});

export async function addCompetitor(_prev: CompetitorFormState, formData: FormData): Promise<CompetitorFormState> {
  const values = { name: String(formData.get("name") ?? ""), website: String(formData.get("website") ?? "") };
  try {
    const ctx = await requireEditor();
    const parsed = competitorSchema.safeParse(values);
    if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error), values };

    const plan = PLANS[ctx.organization.plan];
    const tracked = await countCompetitors(ctx.brand.id);
    if (typeof plan.competitors === "number" && tracked >= plan.competitors) {
      return {
        ok: false,
        values,
        message: `The ${plan.label} plan includes ${plan.competitors} competitors. Remove one to add another, or ask to change plan on the Billing page.`,
      };
    }

    const db = await getDb();
    const existing = await db
      .select({ name: competitors.name, website: competitors.website })
      .from(competitors)
      .where(eq(competitors.brandId, ctx.brand.id));
    const domain = domainOf(parsed.data.website);
    const duplicate = existing.find(
      (row) => row.name.toLowerCase() === parsed.data.name.toLowerCase() || domainOf(row.website) === domain,
    );
    if (duplicate) {
      return { ok: false, values, message: `You already track ${duplicate.name}.` };
    }
    if (domain === domainOf(ctx.brand.website)) {
      return { ok: false, values, fieldErrors: { website: "That is your own website. Enter a competitor's website." } };
    }

    await db.insert(competitors).values({ brandId: ctx.brand.id, name: parsed.data.name, website: parsed.data.website });
    await recordAudit(ctx, "Added a competitor", parsed.data.name, { website: parsed.data.website });
    refresh();
    return { ok: true, message: `${parsed.data.name} added. Its estimated score appears after the next scan.` };
  } catch (error) {
    return { ...actionError(error), values };
  }
}

export async function removeCompetitor(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireEditor();
    const id = String(formData.get("id") ?? "");
    if (!isUuid(id)) return { ok: false, message: "That competitor no longer exists. Reload the page." };
    const db = await getDb();
    const [removed] = await db
      .delete(competitors)
      .where(and(eq(competitors.id, id), eq(competitors.brandId, ctx.brand.id)))
      .returning({ name: competitors.name });
    if (!removed) return { ok: false, message: "That competitor no longer exists. Reload the page." };
    await recordAudit(ctx, "Removed a competitor", removed.name);
    refresh();
    return { ok: true, message: `${removed.name} removed.` };
  } catch (error) {
    return actionError(error);
  }
}
