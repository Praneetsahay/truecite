"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { actionError, type ActionState } from "@/lib/actions";
import { requireAdmin } from "@/lib/auth/dal";
import { auditLog, getDb } from "@/lib/db";
import { PLATFORM_IDS } from "@/lib/domain/constants";
import { listJoin } from "@/lib/domain/format";
import { getSettings, updateSetting, type Settings } from "@/lib/engine";

const PROVIDERS = ["openai", "google", "perplexity", "anthropic"] as const;
const EFFORTS = ["low", "medium", "high"] as const;

const modelName = z.string().trim().min(1, "Enter a model name.").max(80, "Keep the model name under 80 characters.");
const price = (label: string) =>
  z.coerce
    .number({ error: `Enter the ${label} as a number, such as 0.25.` })
    .min(0, `The ${label} cannot be negative.`)
    .max(1000, `Check the ${label}: it should be under $1,000.`);

const answerModel = z.object({
  provider: z.enum(PROVIDERS, { error: "Choose a provider." }),
  model: modelName,
  webSearch: z.boolean(),
  effort: z.enum(EFFORTS).optional(),
});

const schema = z.object({
  models: z.object({
    answer: z.object({
      chatgpt: answerModel,
      gemini: answerModel,
      perplexity: answerModel,
      claude: answerModel,
    }),
    checker: z.object({
      provider: z.enum(PROVIDERS, { error: "Choose a provider." }),
      model: modelName,
      effort: z.enum(EFFORTS).optional(),
    }),
  }),
  prices: z
    .array(
      z.object({
        provider: z.enum(PROVIDERS, { error: "Choose a provider." }),
        model: modelName,
        inputPerMTok: price("input price"),
        outputPerMTok: price("output price"),
        perSearchCall: price("search price"),
      }),
    )
    .min(1, "Keep at least one row in the price table."),
  features: z.object({
    reviewQueue: z.boolean(),
    competitorScans: z.boolean(),
    sourceTracing: z.boolean(),
    instantAlerts: z.boolean(),
    simulateWithoutKeys: z.boolean(),
    crisisMode: z.boolean(),
    indianLanguages: z.boolean(),
  }),
  limits: z.object({
    maxConcurrentRequests: z.coerce
      .number({ error: "Enter a whole number." })
      .int("Enter a whole number.")
      .min(1, "Allow at least 1 request at a time.")
      .max(32, "Keep it at 32 or fewer, or providers start rate-limiting."),
    requestTimeoutMs: z.coerce
      .number({ error: "Enter a number of seconds." })
      .min(5, "Allow at least 5 seconds.")
      .max(300, "Keep it at 300 seconds or less.")
      .transform((seconds) => Math.round(seconds * 1000)),
    maxAttempts: z.coerce
      .number({ error: "Enter a whole number." })
      .int("Enter a whole number.")
      .min(1, "Allow at least 1 attempt.")
      .max(10, "Keep it at 10 attempts or fewer."),
  }),
});

const KEY_LABELS: Record<keyof Settings, string> = {
  models: "models",
  prices: "the price table",
  features: "feature switches",
  limits: "limits",
};

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function readForm(formData: FormData) {
  const answer = Object.fromEntries(
    PLATFORM_IDS.map((id) => [
      id,
      {
        provider: text(formData, `answer.${id}.provider`),
        model: text(formData, `answer.${id}.model`),
        webSearch: formData.get(`answer.${id}.webSearch`) === "on",
        effort: text(formData, `answer.${id}.effort`) || undefined,
      },
    ]),
  );
  const providers = formData.getAll("price.provider").map(String);
  const models = formData.getAll("price.model").map(String);
  const inputs = formData.getAll("price.input").map(String);
  const outputs = formData.getAll("price.output").map(String);
  const searches = formData.getAll("price.search").map(String);
  const blank = (value: string | undefined) => (value === undefined || value.trim() === "" ? undefined : value.trim());
  return {
    models: {
      answer,
      checker: {
        provider: text(formData, "checker.provider"),
        model: text(formData, "checker.model"),
        effort: text(formData, "checker.effort") || undefined,
      },
    },
    prices: providers.map((provider, index) => ({
      provider,
      model: models[index] ?? "",
      inputPerMTok: blank(inputs[index]),
      outputPerMTok: blank(outputs[index]),
      perSearchCall: blank(searches[index]),
    })),
    features: {
      reviewQueue: formData.get("features.reviewQueue") === "on",
      competitorScans: formData.get("features.competitorScans") === "on",
      sourceTracing: formData.get("features.sourceTracing") === "on",
      instantAlerts: formData.get("features.instantAlerts") === "on",
      simulateWithoutKeys: formData.get("features.simulateWithoutKeys") === "on",
      crisisMode: formData.get("features.crisisMode") === "on",
      indianLanguages: formData.get("features.indianLanguages") === "on",
    },
    limits: {
      maxConcurrentRequests: blank(text(formData, "limits.maxConcurrentRequests")),
      requestTimeoutMs: blank(text(formData, "limits.requestTimeoutSeconds")),
      maxAttempts: blank(text(formData, "limits.maxAttempts")),
    },
  };
}

/** JSON with sorted keys: jsonb stores keys in its own order, so plain JSON.stringify would see changes that are not there. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, inner) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );
}

/** Field errors keyed by the field's form name, so each message sits under its own control. */
function errorsByField(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.map(String);
    let key = path.join(".");
    if (path[0] === "models") key = path.slice(1).join(".");
    if (path[0] === "limits" && path[1] === "requestTimeoutMs") key = "limits.requestTimeoutSeconds";
    if (path[0] === "prices" && path.length === 1) key = "prices";
    result[key] ??= issue.message;
  }
  return result;
}

/** "Save settings": models, prices, feature switches and limits, with an audit log row. */
export async function saveSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const parsed = schema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { ok: false, message: "Some settings need attention. Nothing was saved.", fieldErrors: errorsByField(parsed.error) };
  }
  const next = parsed.data as Settings;

  // Effort applies to Claude models only.
  for (const id of PLATFORM_IDS) {
    if (next.models.answer[id].provider !== "anthropic") delete next.models.answer[id].effort;
  }
  if (next.models.checker.provider !== "anthropic") delete next.models.checker.effort;

  // Every model in use needs a price, or its requests would cost $0 in the cost view.
  const errors: Record<string, string> = {};
  const seen = new Set<string>();
  next.prices.forEach((row, index) => {
    const key = `${row.provider}/${row.model}`;
    if (seen.has(key)) errors[`prices.${index}.model`] = "This model already has a row. Remove one of them.";
    seen.add(key);
  });
  const priced = (provider: string, model: string) => seen.has(`${provider}/${model}`);
  for (const id of PLATFORM_IDS) {
    const choice = next.models.answer[id];
    if (!priced(choice.provider, choice.model)) {
      errors[`answer.${id}.model`] = "No price for this model. Add it to the price table below.";
    }
  }
  if (!priced(next.models.checker.provider, next.models.checker.model)) {
    errors["checker.model"] = "No price for this model. Add it to the price table below.";
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, message: "Some settings need attention. Nothing was saved.", fieldErrors: errors };
  }

  try {
    const current = await getSettings();
    const changed = (Object.keys(KEY_LABELS) as (keyof Settings)[]).filter(
      (key) => stable(current[key]) !== stable(next[key]),
    );
    if (changed.length === 0) return { ok: true, message: "Nothing changed, so nothing was saved." };

    for (const key of changed) await updateSetting(key, next[key] as never);

    const db = await getDb();
    await db.insert(auditLog).values({
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      action: `Changed ${listJoin(changed.map((key) => KEY_LABELS[key]))} in Settings`,
      target: "settings",
      detail: Object.fromEntries(changed.map((key) => [key, { before: current[key], after: next[key] }])),
    });
    refresh();
    return { ok: true, message: `Saved ${listJoin(changed.map((key) => KEY_LABELS[key]))}. New scans use them straight away.` };
  } catch (error) {
    return actionError(error);
  }
}
