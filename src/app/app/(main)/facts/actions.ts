"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import type { ContentFormState } from "@/components/content/form-state";
import { actionError, fieldErrors } from "@/lib/actions";
import { requireEditor, sameBrand, type ClientContext } from "@/lib/auth/dal";
import { facts, getDb, type Fact } from "@/lib/db";
import { FACT_CATEGORIES, FACT_CATEGORY_IDS, IMPORTANCE, type FactCategory } from "@/lib/domain/constants";
import { dayOf, isPastFact, isUuid } from "@/lib/queries/content";

/*
  Changes to the Fact Sheet. Only editors change facts; only approved facts
  are used to check answers. Former facts are kept with their dates, so old
  answers can be labelled outdated instead of simply wrong.
*/

class FactChangeError extends Error {}

function failure(error: unknown, values?: Record<string, string>): ContentFormState {
  unstable_rethrow(error);
  if (error instanceof FactChangeError) return { ok: false, message: error.message, values };
  return { ...actionError(error), values };
}

const importanceIds = Object.keys(IMPORTANCE) as (keyof typeof IMPORTANCE)[];

const statement = z
  .string()
  .trim()
  .min(8, "Write the fact as one plain sentence, such as “The Basic plan costs $79 per month.”")
  .max(500, "Keep the fact under 500 characters. Split longer facts into several.");

const optionalDay = z
  .string()
  .trim()
  .refine((value) => value === "" || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))), "Enter a date, such as 1 March 2026.")
  .transform((value) => value || null);

const optionalUrl = z
  .string()
  .trim()
  .max(2000, "That address is too long. Use the page's main address.")
  .transform((value) => (value === "" ? null : /^https?:\/\//i.test(value) ? value : `https://${value}`))
  .refine((value) => {
    if (value === null) return true;
    try {
      return new URL(value).hostname.includes(".");
    } catch {
      return false;
    }
  }, "Enter the full address of the public page, such as acme.com/pricing.");

const factSchema = z.object({
  category: z.enum(FACT_CATEGORY_IDS as [FactCategory, ...FactCategory[]], { error: "Choose a category." }),
  statement,
  importance: z.enum(importanceIds, { error: "Choose how important this fact is." }),
  validFrom: optionalDay,
  sourceUrl: optionalUrl,
});

function readValues(formData: FormData, names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, String(formData.get(name) ?? "")]));
}

const factFields = ["category", "statement", "importance", "validFrom", "sourceUrl"];

/** A fact with the same wording already on the sheet (archived facts do not count). */
async function findDuplicate(ctx: ClientContext, text: string, exceptId?: string): Promise<Fact | undefined> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(facts)
    .where(
      and(
        eq(facts.brandId, ctx.brand.id),
        ne(facts.status, "archived"),
        sql`lower(${facts.statement}) = lower(${text})`,
        exceptId ? ne(facts.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return row;
}

async function loadFact(ctx: ClientContext, id: unknown): Promise<Fact> {
  const value = String(id ?? "");
  if (!isUuid(value)) throw new FactChangeError("That fact no longer exists. Reload the Fact Sheet.");
  const db = await getDb();
  const [row] = await db.select().from(facts).where(eq(facts.id, value)).limit(1);
  return sameBrand(row, ctx);
}

/* Add ------------------------------------------------------------------ */

export async function addFact(_prev: ContentFormState, formData: FormData): Promise<ContentFormState> {
  const values = readValues(formData, factFields);
  try {
    const ctx = await requireEditor();
    const parsed = factSchema.safeParse(values);
    if (!parsed.success) {
      return { ok: false, message: "Some fields need attention.", fieldErrors: fieldErrors(parsed.error), values };
    }
    if (await findDuplicate(ctx, parsed.data.statement)) {
      return { ok: false, fieldErrors: { statement: "This fact is already on your Fact Sheet." }, values };
    }
    const db = await getDb();
    await db.insert(facts).values({
      brandId: ctx.brand.id,
      ...parsed.data,
      // The team writes it, so it is approved as written.
      status: "approved",
      origin: "manual",
      approvedBy: ctx.user.id,
      approvedAt: ctx.now,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    refresh();
    return {
      ok: true,
      message: `Added to ${FACT_CATEGORIES[parsed.data.category].label}. It is used from the next scan.`,
      key: Date.now(),
    };
  } catch (error) {
    return failure(error, values);
  }
}

/* Edit ----------------------------------------------------------------- */

export async function updateFact(_prev: ContentFormState, formData: FormData): Promise<ContentFormState> {
  const values = readValues(formData, factFields);
  let done = "";
  try {
    const ctx = await requireEditor();
    const fact = await loadFact(ctx, formData.get("id"));
    const parsed = factSchema.safeParse(values);
    if (!parsed.success) {
      return { ok: false, message: "Some fields need attention.", fieldErrors: fieldErrors(parsed.error), values };
    }
    if (await findDuplicate(ctx, parsed.data.statement, fact.id)) {
      return { ok: false, fieldErrors: { statement: "Another fact on your Fact Sheet says the same." }, values };
    }
    const db = await getDb();
    await db
      .update(facts)
      .set({ ...parsed.data, updatedAt: ctx.now })
      .where(and(eq(facts.id, fact.id), eq(facts.brandId, ctx.brand.id)));
    done = fact.status === "draft" ? "draft-updated" : "updated";
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/app/facts?done=${done}`);
}

/* Approve -------------------------------------------------------------- */

export async function approveFact(_prev: ContentFormState, formData: FormData): Promise<ContentFormState> {
  try {
    const ctx = await requireEditor();
    const fact = await loadFact(ctx, formData.get("id"));
    if (fact.status !== "draft") return { ok: true, message: "Already approved." };
    const db = await getDb();
    await db
      .update(facts)
      .set({ status: "approved", approvedBy: ctx.user.id, approvedAt: ctx.now, updatedAt: ctx.now })
      .where(and(eq(facts.id, fact.id), eq(facts.brandId, ctx.brand.id), eq(facts.status, "draft")));
    refresh();
    return { ok: true, message: "Approved." };
  } catch (error) {
    return failure(error);
  }
}

export async function approveAllFacts(_prev: ContentFormState, _formData: FormData): Promise<ContentFormState> {
  try {
    const ctx = await requireEditor();
    const db = await getDb();
    const approved = await db
      .update(facts)
      .set({ status: "approved", approvedBy: ctx.user.id, approvedAt: ctx.now, updatedAt: ctx.now })
      .where(and(eq(facts.brandId, ctx.brand.id), eq(facts.status, "draft")))
      .returning({ id: facts.id });
    refresh();
    if (approved.length === 0) return { ok: true, message: "There are no drafts left to approve." };
    return { ok: true, message: `Approved ${approved.length} ${approved.length === 1 ? "fact" : "facts"}.` };
  } catch (error) {
    return failure(error);
  }
}

/* Delete a draft ------------------------------------------------------- */

export async function deleteDraftFact(_prev: ContentFormState, formData: FormData): Promise<ContentFormState> {
  try {
    const ctx = await requireEditor();
    const fact = await loadFact(ctx, formData.get("id"));
    if (fact.status !== "draft") {
      throw new FactChangeError("Approved facts are kept for the record. Archive it instead, or mark it as no longer true.");
    }
    const db = await getDb();
    await db.delete(facts).where(and(eq(facts.id, fact.id), eq(facts.brandId, ctx.brand.id), eq(facts.status, "draft")));
    refresh();
    return { ok: true, message: "Draft deleted." };
  } catch (error) {
    return failure(error);
  }
}

/* No longer true -------------------------------------------------------- */

const retireSchema = z.object({
  replacement: z
    .string()
    .trim()
    .max(500, "Keep the fact under 500 characters. Split longer facts into several.")
    .refine((value) => value === "" || value.length >= 8, "Write the new fact as one plain sentence."),
  importance: z.enum(importanceIds, { error: "Choose how important this fact is." }),
  sourceUrl: optionalUrl,
});

const retireFields = ["replacement", "importance", "sourceUrl"];

export async function retireFact(_prev: ContentFormState, formData: FormData): Promise<ContentFormState> {
  const values = readValues(formData, retireFields);
  let done = "";
  try {
    const ctx = await requireEditor();
    const fact = await loadFact(ctx, formData.get("id"));
    const today = dayOf(ctx.now);
    if (fact.status !== "approved") {
      throw new FactChangeError("Only approved facts can be marked as no longer true. Approve it first, or delete the draft.");
    }
    if (isPastFact(fact, today)) throw new FactChangeError("This fact is already a past fact.");
    if (fact.validFrom && fact.validFrom > today) {
      throw new FactChangeError("This fact only starts on its valid-from date. Change that date instead.");
    }

    const parsed = retireSchema.safeParse(values);
    if (!parsed.success) {
      return { ok: false, message: "Some fields need attention.", fieldErrors: fieldErrors(parsed.error), values };
    }
    const replacement = parsed.data.replacement;
    if (replacement && (await findDuplicate(ctx, replacement, fact.id))) {
      return { ok: false, fieldErrors: { replacement: "This fact is already on your Fact Sheet." }, values };
    }

    const db = await getDb();
    await db.transaction(async (tx) => {
      // The old fact stays, with the day it stopped being true.
      await tx
        .update(facts)
        .set({ validTo: today, updatedAt: ctx.now })
        .where(and(eq(facts.id, fact.id), eq(facts.brandId, ctx.brand.id)));
      if (replacement) {
        await tx.insert(facts).values({
          brandId: ctx.brand.id,
          category: fact.category,
          statement: replacement,
          importance: parsed.data.importance,
          sourceUrl: parsed.data.sourceUrl,
          validFrom: today,
          status: "approved",
          origin: "manual",
          approvedBy: ctx.user.id,
          approvedAt: ctx.now,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        });
      }
    });
    done = replacement ? "replaced" : "retired";
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/app/facts?done=${done}`);
}

/* Archive and restore --------------------------------------------------- */

export async function archiveFact(_prev: ContentFormState, formData: FormData): Promise<ContentFormState> {
  try {
    const ctx = await requireEditor();
    const fact = await loadFact(ctx, formData.get("id"));
    if (fact.status === "draft") throw new FactChangeError("Drafts are not used yet. Delete the draft instead.");
    const db = await getDb();
    await db
      .update(facts)
      .set({ status: "archived", updatedAt: ctx.now })
      .where(and(eq(facts.id, fact.id), eq(facts.brandId, ctx.brand.id)));
  } catch (error) {
    return failure(error);
  }
  redirect("/app/facts?done=archived");
}

export async function restoreFact(_prev: ContentFormState, formData: FormData): Promise<ContentFormState> {
  try {
    const ctx = await requireEditor();
    const fact = await loadFact(ctx, formData.get("id"));
    if (fact.status !== "archived") return { ok: true, message: "Already on the Fact Sheet." };
    if (await findDuplicate(ctx, fact.statement, fact.id)) {
      throw new FactChangeError("Another fact on your Fact Sheet says the same, so this one stays archived.");
    }
    const db = await getDb();
    await db
      .update(facts)
      .set({ status: "approved", approvedBy: ctx.user.id, approvedAt: ctx.now, updatedAt: ctx.now })
      .where(and(eq(facts.id, fact.id), eq(facts.brandId, ctx.brand.id)));
    refresh();
    return { ok: true, message: "Restored to the Fact Sheet." };
  } catch (error) {
    return failure(error);
  }
}
