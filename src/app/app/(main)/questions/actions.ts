"use server";

import { and, count, eq, ne, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import type { ContentFormState } from "@/components/content/form-state";
import { actionError, fieldErrors } from "@/lib/actions";
import { requireEditor, sameBrand, type ClientContext } from "@/lib/auth/dal";
import { getDb, questions, type Question } from "@/lib/db";
import { PLANS, QUESTION_CATEGORIES, QUESTION_CATEGORY_IDS, type QuestionCategory } from "@/lib/domain/constants";
import { isUuid, questionLimit } from "@/lib/queries/content";

/*
  Changes to the Question Set. Questions are never deleted, because their
  answers are the evidence trail: a question that no longer applies is
  switched off and keeps its history.
*/

class QuestionChangeError extends Error {}

function failure(error: unknown, values?: Record<string, string>): ContentFormState {
  unstable_rethrow(error);
  if (error instanceof QuestionChangeError) return { ok: false, message: error.message, values };
  return { ...actionError(error), values };
}

const text = z
  .string()
  .trim()
  .min(8, "Write the question the way a customer would ask it, such as “How much does Acme cost?”")
  .max(300, "Keep the question under 300 characters.");

const questionSchema = z.object({
  category: z.enum(QUESTION_CATEGORY_IDS as [QuestionCategory, ...QuestionCategory[]], { error: "Choose a category." }),
  text,
  priority: z.enum(["key", "standard"], { error: "Choose Key or Standard." }),
});

function readValues(formData: FormData, names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, String(formData.get(name) ?? "")]));
}

async function loadQuestion(ctx: ClientContext, id: unknown): Promise<Question> {
  const value = String(id ?? "");
  if (!isUuid(value)) throw new QuestionChangeError("That question no longer exists. Reload the page.");
  const db = await getDb();
  const [row] = await db.select().from(questions).where(eq(questions.id, value)).limit(1);
  return sameBrand(row, ctx);
}

async function activeCount(ctx: ClientContext): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: count() })
    .from(questions)
    .where(and(eq(questions.brandId, ctx.brand.id), eq(questions.active, true)));
  return row?.n ?? 0;
}

function limitMessage(ctx: ClientContext, limit: number): string {
  return `Your ${PLANS[ctx.organization.plan].label} plan includes ${limit} questions, and all of them are in use. Switch off a question first, or ask to change plan on the Billing page.`;
}

async function findDuplicate(ctx: ClientContext, value: string, exceptId?: string) {
  const db = await getDb();
  const [row] = await db
    .select({ id: questions.id, active: questions.active })
    .from(questions)
    .where(
      and(
        eq(questions.brandId, ctx.brand.id),
        sql`lower(${questions.text}) = lower(${value})`,
        exceptId ? ne(questions.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return row;
}

/* Add ------------------------------------------------------------------ */

export async function addQuestion(_prev: ContentFormState, formData: FormData): Promise<ContentFormState> {
  const values = readValues(formData, ["category", "text", "priority"]);
  try {
    const ctx = await requireEditor();
    const parsed = questionSchema.safeParse(values);
    if (!parsed.success) {
      return { ok: false, message: "Some fields need attention.", fieldErrors: fieldErrors(parsed.error), values };
    }
    const duplicate = await findDuplicate(ctx, parsed.data.text);
    if (duplicate) {
      return {
        ok: false,
        fieldErrors: {
          text: duplicate.active
            ? "This question is already in your Question Set."
            : "This question is already in your Question Set, switched off. Switch it on instead.",
        },
        values,
      };
    }
    const { limit } = questionLimit(ctx.organization.plan);
    if ((await activeCount(ctx)) >= limit) throw new QuestionChangeError(limitMessage(ctx, limit));

    const db = await getDb();
    await db.insert(questions).values({
      brandId: ctx.brand.id,
      text: parsed.data.text,
      category: parsed.data.category,
      priority: parsed.data.priority,
      language: "en",
      active: true,
      origin: "custom",
      createdAt: ctx.now,
    });
    refresh();
    return {
      ok: true,
      message: `Added to ${QUESTION_CATEGORIES[parsed.data.category].label}. TrueCite asks it from the next scan.`,
      key: Date.now(),
    };
  } catch (error) {
    return failure(error, values);
  }
}

/* Edit ----------------------------------------------------------------- */

export async function updateQuestion(_prev: ContentFormState, formData: FormData): Promise<ContentFormState> {
  const values = readValues(formData, ["category", "text", "priority", "active"]);
  let category = "";
  let id = "";
  try {
    const ctx = await requireEditor();
    const question = await loadQuestion(ctx, formData.get("id"));
    const parsed = questionSchema.safeParse(values);
    if (!parsed.success) {
      return { ok: false, message: "Some fields need attention.", fieldErrors: fieldErrors(parsed.error), values };
    }
    if (await findDuplicate(ctx, parsed.data.text, question.id)) {
      return { ok: false, fieldErrors: { text: "Another question in your Question Set says the same." }, values };
    }
    const active = values.active === "on";
    if (active && !question.active) {
      const { limit } = questionLimit(ctx.organization.plan);
      if ((await activeCount(ctx)) >= limit) throw new QuestionChangeError(limitMessage(ctx, limit));
    }
    const db = await getDb();
    await db
      .update(questions)
      .set({ text: parsed.data.text, category: parsed.data.category, priority: parsed.data.priority, active })
      .where(and(eq(questions.id, question.id), eq(questions.brandId, ctx.brand.id)));
    category = parsed.data.category;
    id = question.id;
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/app/questions?category=${category}&saved=${id}#question-${id}`);
}

/* Row controls ----------------------------------------------------------- */

export async function setQuestionActive(_prev: ContentFormState, formData: FormData): Promise<ContentFormState> {
  // When the list hides switched-off questions, the row disappears: say so on the page, with a way back.
  const returnTo = String(formData.get("returnTo") ?? "");
  let switchedOff = "";
  try {
    const ctx = await requireEditor();
    const question = await loadQuestion(ctx, formData.get("id"));
    const active = formData.get("active") === "true";
    if (question.active === active) return { ok: true };
    if (!active && returnTo.startsWith("/app/questions")) switchedOff = question.id;
    if (active) {
      const { limit } = questionLimit(ctx.organization.plan);
      if ((await activeCount(ctx)) >= limit) throw new QuestionChangeError(limitMessage(ctx, limit));
    }
    const db = await getDb();
    await db
      .update(questions)
      .set({ active })
      .where(and(eq(questions.id, question.id), eq(questions.brandId, ctx.brand.id)));
    if (!switchedOff) {
      refresh();
      return { ok: true };
    }
  } catch (error) {
    return failure(error);
  }
  const url = new URL(returnTo, "http://local");
  url.searchParams.set("off", switchedOff);
  url.searchParams.delete("saved");
  redirect(`${url.pathname}${url.search}`);
}

export async function setQuestionPriority(_prev: ContentFormState, formData: FormData): Promise<ContentFormState> {
  try {
    const ctx = await requireEditor();
    const question = await loadQuestion(ctx, formData.get("id"));
    const priority = z.enum(["key", "standard"]).parse(formData.get("priority"));
    if (question.priority !== priority) {
      const db = await getDb();
      await db
        .update(questions)
        .set({ priority })
        .where(and(eq(questions.id, question.id), eq(questions.brandId, ctx.brand.id)));
      refresh();
    }
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
