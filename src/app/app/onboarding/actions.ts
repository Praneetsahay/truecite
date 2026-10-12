"use server";

import { and, eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireEditor, type ClientContext } from "@/lib/auth/dal";
import { actionError, fieldErrors, type ActionState } from "@/lib/actions";
import { auditLog, brands, competitors, facts, getDb, questions } from "@/lib/db";
import {
  FACT_CATEGORY_IDS,
  IMPORTANCE,
  MARKETS,
  ONBOARDING_STEPS,
  PLANS,
  PLATFORM_IDS,
  QUESTION_CATEGORY_IDS,
  type Importance,
  type MarketId,
  type OnboardingStep,
  type PlatformId,
} from "@/lib/domain/constants";
import { domainOf, plural } from "@/lib/domain/format";
import { draftFactSheet, EngineNotReadyError, generateQuestionSet, startScan } from "@/lib/engine";
import {
  MIN_APPROVED_FACTS,
  nextScanAt,
  planCompetitorLimit,
  planPlatformLimit,
  planQuestionLimit,
  planScanFrequency,
} from "@/components/onboarding/plan";

/*
  Onboarding: company details, Fact Sheet review, Question Set review, first scan.
  Every action checks the editor role and scopes by the current brand.
*/

export type CompanyFormState = ActionState;
export type ScanFormState = ActionState & { engineNotReady?: boolean };

async function audit(ctx: ClientContext, action: string, target?: string | null, detail?: Record<string, unknown>) {
  const db = await getDb();
  await db.insert(auditLog).values({
    organizationId: ctx.organization.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action,
    target: target ?? null,
    detail: detail ?? null,
  });
}

async function setStep(ctx: ClientContext, step: OnboardingStep, extra: Partial<typeof brands.$inferInsert> = {}) {
  const db = await getDb();
  await db
    .update(brands)
    .set({ onboardingStep: step, ...extra })
    .where(eq(brands.id, ctx.brand.id));
}

const websiteSchema = (missing: string, example: string) =>
  z
    .string()
    .trim()
    .min(4, missing)
    .transform((value) => (/^https?:\/\//i.test(value) ? value : `https://${value}`))
    .refine((value) => {
      try {
        return new URL(value).hostname.includes(".");
      } catch {
        return false;
      }
    }, `Enter a full website address, such as ${example}.`);

const uuid = z.string().uuid();

/* Step 1: company details */

const companySchema = z.object({
  name: z.string().trim().min(2, "Enter your company's name.").max(120, "Use a shorter name, up to 120 characters."),
  website: websiteSchema("Enter your company's website.", "acme.com"),
  industry: z.string().trim().max(120, "Use up to 120 characters.").optional(),
  markets: z
    .array(z.enum(Object.keys(MARKETS) as [MarketId, ...MarketId[]]))
    .min(1, "Choose at least one market, so questions match where your customers are."),
});

export async function saveCompany(_prev: CompanyFormState, formData: FormData): Promise<CompanyFormState> {
  try {
    const ctx = await requireEditor();
    const parsed = companySchema.safeParse({
      name: formData.get("name"),
      website: formData.get("website"),
      industry: formData.get("industry") ?? undefined,
      markets: formData.getAll("markets"),
    });
    const errors: Record<string, string> = parsed.success ? {} : (fieldErrors(parsed.error) as Record<string, string>);

    // Competitor rows: ignore empty rows; a row needs both a name and a website.
    const ids = formData.getAll("competitorId").map(String);
    const names = formData.getAll("competitorName").map((v) => String(v).trim());
    const sites = formData.getAll("competitorWebsite").map((v) => String(v).trim());
    const rows: { id: string | null; name: string; website: string }[] = [];
    const siteSchema = websiteSchema("Enter the competitor's website.", "northwind.example");
    names.forEach((name, index) => {
      const site = sites[index] ?? "";
      if (!name && !site) return;
      if (name.length < 2) errors[`competitor-${index}-name`] = "Enter the competitor's name.";
      const parsedSite = siteSchema.safeParse(site);
      if (!parsedSite.success) errors[`competitor-${index}-website`] = parsedSite.error.issues[0].message;
      else if (parsed.success && domainOf(parsedSite.data) === domainOf(parsed.data.website)) {
        errors[`competitor-${index}-website`] = "That is your own website. Enter the competitor's website.";
      }
      const id = uuid.safeParse(ids[index]).success ? ids[index] : null;
      rows.push({ id, name, website: parsedSite.success ? parsedSite.data : site });
    });

    const limit = planCompetitorLimit(ctx.organization.plan);
    if (rows.length > limit) {
      return {
        ok: false,
        message: `The ${PLANS[ctx.organization.plan].label} plan includes ${plural(limit, "competitor")}. Remove one to continue.`,
      };
    }
    if (!parsed.success || Object.keys(errors).length > 0) {
      return { ok: false, fieldErrors: errors, message: "Some fields need attention." };
    }

    const db = await getDb();
    await db.transaction(async (tx) => {
      await tx
        .update(brands)
        .set({
          name: parsed.data.name,
          website: parsed.data.website,
          industry: parsed.data.industry || null,
          markets: parsed.data.markets,
          languages: ["en"],
          onboardingStep: "facts",
        })
        .where(eq(brands.id, ctx.brand.id));

      const existing = await tx.select({ id: competitors.id }).from(competitors).where(eq(competitors.brandId, ctx.brand.id));
      const kept = new Set(rows.map((row) => row.id).filter(Boolean));
      const removed = existing.filter((row) => !kept.has(row.id)).map((row) => row.id);
      if (removed.length > 0) {
        await tx.delete(competitors).where(and(eq(competitors.brandId, ctx.brand.id), inArray(competitors.id, removed)));
      }
      for (const row of rows) {
        if (row.id && existing.some((e) => e.id === row.id)) {
          await tx
            .update(competitors)
            .set({ name: row.name, website: row.website })
            .where(and(eq(competitors.id, row.id), eq(competitors.brandId, ctx.brand.id)));
        } else {
          await tx.insert(competitors).values({ brandId: ctx.brand.id, name: row.name, website: row.website });
        }
      }
    });
    await audit(ctx, "Saved company details", parsed.data.name, {
      competitors: rows.map((row) => row.name),
      markets: parsed.data.markets,
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

/** Moves back to an earlier step. Nothing entered so far is lost. */
export async function goToStep(formData: FormData): Promise<void> {
  const ctx = await requireEditor();
  const step = String(formData.get("step") ?? "") as OnboardingStep;
  const current = ONBOARDING_STEPS[ctx.brand.onboardingStep]?.step ?? 1;
  if (!(step in ONBOARDING_STEPS) || step === "done" || ONBOARDING_STEPS[step].step >= current) return;
  await setStep(ctx, step);
  refresh();
}

/* Step 2: Fact Sheet */

export async function draftFacts(): Promise<ActionState> {
  try {
    const ctx = await requireEditor();
    const result = await draftFactSheet(ctx.brand.id);
    await audit(ctx, "Drafted the Fact Sheet from the website", ctx.brand.name, { created: result.created, pages: result.pagesRead.length });
    refresh();
    const pages = result.pagesRead.length;
    const from = pages > 0 ? ` from ${plural(pages, "page")} of ${domainOf(ctx.brand.website)}` : "";
    if (result.created === 0) {
      return {
        ok: true,
        message:
          pages === 0
            ? `TrueCite could not read ${domainOf(ctx.brand.website)}. Check the website address on the first step, or add facts by hand below.`
            : `No new facts found${from}. Add any missing facts by hand below.`,
      };
    }
    return {
      ok: true,
      message: `Drafted ${plural(result.created, "fact")}${from}.${
        result.simulated ? " Without an AI key, the draft covers only what the pages state directly, so check it for gaps." : ""
      } Approve the ones that are right.`,
    };
  } catch (error) {
    return actionError(error);
  }
}

const dateSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || null)
  .refine((value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value), "Enter a date, or leave it empty.");

const factSchema = z.object({
  category: z.enum(FACT_CATEGORY_IDS as [string, ...string[]], { message: "Choose a category." }),
  statement: z
    .string()
    .trim()
    .min(8, "Write the fact as a full sentence, such as “The Basic plan costs $79 per month.”")
    .max(500, "Keep a fact under 500 characters. Split longer ones into two facts."),
  importance: z.enum(Object.keys(IMPORTANCE) as [Importance, ...Importance[]]),
  validFrom: dateSchema,
  sourceUrl: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? (/^https?:\/\//i.test(value) ? value : `https://${value}`) : null))
    .refine((value) => {
      if (value === null) return true;
      try {
        return new URL(value).hostname.includes(".");
      } catch {
        return false;
      }
    }, "Enter the full address of the page, or leave it empty."),
});

function readFact(formData: FormData) {
  return factSchema.safeParse({
    category: formData.get("category"),
    statement: formData.get("statement"),
    importance: formData.get("importance"),
    validFrom: formData.get("validFrom") ?? undefined,
    sourceUrl: formData.get("sourceUrl") ?? undefined,
  });
}

export async function addFact(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireEditor();
    const parsed = readFact(formData);
    if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
    const db = await getDb();
    const now = new Date();
    await db.insert(facts).values({
      brandId: ctx.brand.id,
      category: parsed.data.category as (typeof FACT_CATEGORY_IDS)[number],
      statement: parsed.data.statement,
      importance: parsed.data.importance,
      validFrom: parsed.data.validFrom,
      sourceUrl: parsed.data.sourceUrl,
      status: "approved",
      origin: "manual",
      approvedBy: ctx.user.id,
      approvedAt: now,
      updatedAt: now,
    });
    await audit(ctx, "Added a fact", parsed.data.statement);
    refresh();
    return { ok: true, message: "Fact added and approved." };
  } catch (error) {
    return actionError(error);
  }
}

export async function updateFact(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireEditor();
    const id = String(formData.get("id") ?? "");
    if (!uuid.safeParse(id).success) return { ok: false, message: "That fact no longer exists. Reload the page." };
    const parsed = readFact(formData);
    if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
    const db = await getDb();
    const now = new Date();
    const [updated] = await db
      .update(facts)
      .set({
        category: parsed.data.category as (typeof FACT_CATEGORY_IDS)[number],
        statement: parsed.data.statement,
        importance: parsed.data.importance,
        validFrom: parsed.data.validFrom,
        sourceUrl: parsed.data.sourceUrl,
        status: "approved",
        approvedBy: ctx.user.id,
        approvedAt: now,
        updatedAt: now,
      })
      .where(and(eq(facts.id, id), eq(facts.brandId, ctx.brand.id)))
      .returning({ id: facts.id });
    if (!updated) return { ok: false, message: "That fact no longer exists. Reload the page." };
    await audit(ctx, "Edited and approved a fact", parsed.data.statement);
    refresh();
    return { ok: true, message: "Saved and approved." };
  } catch (error) {
    return actionError(error);
  }
}

export async function approveFact(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireEditor();
    const id = String(formData.get("id") ?? "");
    if (!uuid.safeParse(id).success) return { ok: false, message: "That fact no longer exists. Reload the page." };
    const db = await getDb();
    const now = new Date();
    const [approved] = await db
      .update(facts)
      .set({ status: "approved", approvedBy: ctx.user.id, approvedAt: now, updatedAt: now })
      .where(and(eq(facts.id, id), eq(facts.brandId, ctx.brand.id)))
      .returning({ statement: facts.statement });
    if (!approved) return { ok: false, message: "That fact no longer exists. Reload the page." };
    await audit(ctx, "Approved a fact", approved.statement);
    refresh();
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function approveAllFacts(): Promise<ActionState> {
  try {
    const ctx = await requireEditor();
    const db = await getDb();
    const now = new Date();
    const approved = await db
      .update(facts)
      .set({ status: "approved", approvedBy: ctx.user.id, approvedAt: now, updatedAt: now })
      .where(and(eq(facts.brandId, ctx.brand.id), eq(facts.status, "draft")))
      .returning({ id: facts.id });
    await audit(ctx, "Approved all draft facts", ctx.brand.name, { count: approved.length });
    refresh();
    return { ok: true, message: approved.length > 0 ? `Approved ${plural(approved.length, "fact")}.` : "Every fact is already approved." };
  } catch (error) {
    return actionError(error);
  }
}

export async function deleteFact(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireEditor();
    const id = String(formData.get("id") ?? "");
    if (!uuid.safeParse(id).success) return { ok: false, message: "That fact no longer exists. Reload the page." };
    const db = await getDb();
    const [removed] = await db
      .delete(facts)
      .where(and(eq(facts.id, id), eq(facts.brandId, ctx.brand.id)))
      .returning({ statement: facts.statement });
    if (!removed) return { ok: false, message: "That fact no longer exists. Reload the page." };
    await audit(ctx, "Deleted a fact", removed.statement);
    refresh();
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function finishFacts(): Promise<ActionState> {
  try {
    const ctx = await requireEditor();
    const db = await getDb();
    const approved = await db
      .select({ id: facts.id })
      .from(facts)
      .where(and(eq(facts.brandId, ctx.brand.id), eq(facts.status, "approved")));
    if (approved.length < MIN_APPROVED_FACTS) {
      return {
        ok: false,
        message: `Approve at least ${MIN_APPROVED_FACTS} facts to continue. You have ${approved.length}.`,
      };
    }
    await setStep(ctx, "questions");
    await audit(ctx, "Finished the Fact Sheet review", ctx.brand.name, { approved: approved.length });
    refresh();
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

/* Step 3: Question Set */

export async function generateQuestions(): Promise<ActionState> {
  try {
    const ctx = await requireEditor();
    const result = await generateQuestionSet(ctx.brand.id);
    await audit(ctx, "Generated the Question Set", ctx.brand.name, { created: result.created });
    refresh();
    return {
      ok: true,
      message:
        result.created > 0
          ? `Added ${plural(result.created, "question")}. Edit any that don't sound like your customers.`
          : "No questions added. The set is already at your plan's limit, or every suggested question is already in it.",
    };
  } catch (error) {
    return actionError(error);
  }
}

const questionSchema = z.object({
  category: z.enum(QUESTION_CATEGORY_IDS as [string, ...string[]], { message: "Choose a category." }),
  text: z.string().trim().min(8, "Write the question the way a customer would ask it.").max(300, "Keep a question under 300 characters."),
  priority: z.enum(["key", "standard"]),
});

export async function addQuestion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireEditor();
    const parsed = questionSchema.safeParse({
      category: formData.get("category"),
      text: formData.get("text"),
      priority: formData.get("priority") ?? "standard",
    });
    if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
    const db = await getDb();
    const existing = await db
      .select({ text: questions.text, active: questions.active })
      .from(questions)
      .where(eq(questions.brandId, ctx.brand.id));
    if (existing.some((q) => q.text.trim().toLowerCase() === parsed.data.text.toLowerCase())) {
      return { ok: false, fieldErrors: { text: "This question is already in your set." } };
    }
    const limit = planQuestionLimit(ctx.organization.plan);
    const active = existing.filter((q) => q.active).length < limit;
    await db.insert(questions).values({
      brandId: ctx.brand.id,
      text: parsed.data.text,
      category: parsed.data.category as (typeof QUESTION_CATEGORY_IDS)[number],
      priority: parsed.data.priority,
      active,
      origin: "custom",
    });
    await audit(ctx, "Added a question", parsed.data.text);
    refresh();
    return {
      ok: true,
      message: active
        ? "Question added."
        : `Question added but switched off: your plan checks up to ${limit} questions. Switch another off to use it.`,
    };
  } catch (error) {
    return actionError(error);
  }
}

/** Saves edits to the whole Question Set. With intent "continue", also moves on to the first scan. */
export async function saveQuestions(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireEditor();
    const db = await getDb();
    const rows = await db
      .select({ id: questions.id, text: questions.text, priority: questions.priority, active: questions.active })
      .from(questions)
      .where(eq(questions.brandId, ctx.brand.id));

    const errors: Record<string, string> = {};
    const changes: { id: string; text: string; priority: "key" | "standard"; active: boolean }[] = [];
    for (const row of rows) {
      if (!formData.has(`text-${row.id}`)) continue;
      const text = String(formData.get(`text-${row.id}`) ?? "").trim();
      const priority = formData.get(`priority-${row.id}`) === "key" ? "key" : "standard";
      const active = formData.get(`active-${row.id}`) === "on";
      if (text.length < 8) errors[`text-${row.id}`] = "Write the full question, or switch it off.";
      if (text !== row.text || priority !== row.priority || active !== row.active) {
        changes.push({ id: row.id, text, priority, active });
      }
    }
    if (Object.keys(errors).length > 0) {
      return { ok: false, fieldErrors: errors, message: "Some questions need attention." };
    }

    const finalActive = rows.filter((row) => changes.find((c) => c.id === row.id)?.active ?? row.active).length;
    const limit = planQuestionLimit(ctx.organization.plan);
    if (finalActive > limit) {
      return {
        ok: false,
        message: `Your plan checks up to ${limit} questions and ${finalActive} are switched on. Switch off ${finalActive - limit} to save.`,
      };
    }

    for (const change of changes) {
      await db
        .update(questions)
        .set({ text: change.text, priority: change.priority, active: change.active })
        .where(and(eq(questions.id, change.id), eq(questions.brandId, ctx.brand.id)));
    }
    if (changes.length > 0) await audit(ctx, "Edited the Question Set", ctx.brand.name, { changed: changes.length });

    if (formData.get("intent") === "continue") {
      if (finalActive === 0) {
        return { ok: false, message: "Switch on at least one question, or generate the Question Set, to continue." };
      }
      await setStep(ctx, "scan");
      refresh();
      return { ok: true };
    }
    refresh();
    return { ok: true, message: changes.length > 0 ? `Saved ${plural(changes.length, "change")}.` : "No changes to save." };
  } catch (error) {
    return actionError(error);
  }
}

/* Step 4: first scan */

function readPlatforms(formData: FormData, ctx: ClientContext): PlatformId[] | string {
  const chosen = formData
    .getAll("platforms")
    .map(String)
    .filter((id): id is PlatformId => (PLATFORM_IDS as readonly string[]).includes(id));
  const unique = [...new Set(chosen)];
  const limit = planPlatformLimit(ctx.organization.plan);
  if (unique.length === 0) return "Choose at least one AI assistant to ask.";
  if (unique.length > limit) return `Your plan includes ${plural(limit, "AI assistant")}. Choose up to ${limit}.`;
  return unique;
}

async function finish(ctx: ClientContext, platforms: PlatformId[]) {
  const plan = PLANS[ctx.organization.plan];
  const frequency = planScanFrequency(ctx.organization.plan);
  await setStep(ctx, "done", {
    platforms,
    runsPerQuestion: plan.runsPerQuestion,
    scanFrequency: frequency,
    nextScanAt: nextScanAt(frequency, new Date()),
  });
}

/** "Start first scan", or with intent "finish", "Finish without scanning" when scanning is not available. */
export async function startFirstScan(prev: ScanFormState, formData: FormData): Promise<ScanFormState> {
  if (formData.get("intent") === "finish") return finishWithoutScan(prev, formData);
  try {
    const ctx = await requireEditor();
    const platforms = readPlatforms(formData, ctx);
    if (typeof platforms === "string") return { ok: false, fieldErrors: { platforms }, message: platforms };

    const db = await getDb();
    const plan = PLANS[ctx.organization.plan];
    // The scan reads the brand's platforms and runs, so save them first.
    await db
      .update(brands)
      .set({ platforms, runsPerQuestion: plan.runsPerQuestion, scanFrequency: planScanFrequency(ctx.organization.plan) })
      .where(eq(brands.id, ctx.brand.id));

    try {
      await startScan({ brandId: ctx.brand.id, type: "manual", triggeredBy: ctx.user.id });
    } catch (error) {
      if (error instanceof EngineNotReadyError) {
        return {
          ok: false,
          engineNotReady: true,
          message: `${error.message} Your setup is saved. Finish without scanning, and start the first scan from the dashboard later.`,
        };
      }
      throw error;
    }
    await finish(ctx, platforms);
    await audit(ctx, "Finished onboarding and started the first scan", ctx.brand.name, { platforms });
  } catch (error) {
    return actionError(error);
  }
  redirect("/app/dashboard");
}

async function finishWithoutScan(_prev: ScanFormState, formData: FormData): Promise<ScanFormState> {
  try {
    const ctx = await requireEditor();
    const platforms = readPlatforms(formData, ctx);
    if (typeof platforms === "string") return { ok: false, message: platforms };
    await finish(ctx, platforms);
    await audit(ctx, "Finished onboarding without a first scan", ctx.brand.name, { platforms });
  } catch (error) {
    return actionError(error);
  }
  redirect("/app/dashboard");
}
