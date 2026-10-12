"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/dal";
import { actionError, fieldErrors, type ActionState } from "@/lib/actions";
import { alertRules, getDb } from "@/lib/db";
import { ALERT_FREQUENCIES, SEVERITY_ORDER, type AlertFrequency, type Severity } from "@/lib/domain/constants";
import { isUuid, recordAudit } from "@/lib/queries/account";

export type AlertRuleValues = {
  name: string;
  minimumSeverity: string;
  frequency: string;
  recipients: string[];
  otherRecipients: string;
  active: boolean;
};

export type AlertRuleFormState = ActionState & { values?: AlertRuleValues };

const MAX_RECIPIENTS = 25;
const MISSING = "That rule no longer exists. Reload the page.";

const email = z.string().trim().toLowerCase().email();

const ruleSchema = z.object({
  name: z.string().trim().min(2, "Give the rule a name, such as “Critical issues for legal”.").max(80, "Use up to 80 characters."),
  channel: z.literal("email", {
    error: "Only email alerts are available. Slack, Microsoft Teams and WhatsApp are planned for Enterprise.",
  }),
  minimumSeverity: z.enum(SEVERITY_ORDER, { error: "Choose the lowest severity that should trigger this rule." }),
  frequency: z.enum(Object.keys(ALERT_FREQUENCIES) as [AlertFrequency, ...AlertFrequency[]], {
    error: "Choose when to send these alerts.",
  }),
});

function splitAddresses(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function readValues(formData: FormData): AlertRuleValues {
  return {
    name: String(formData.get("name") ?? ""),
    minimumSeverity: String(formData.get("minimumSeverity") ?? ""),
    frequency: String(formData.get("frequency") ?? ""),
    recipients: formData.getAll("recipients").map(String),
    otherRecipients: String(formData.get("otherRecipients") ?? ""),
    active: formData.get("active") === "on",
  };
}

/** Adds a rule, or saves changes to one when the form carries its id. */
export async function saveAlertRule(_prev: AlertRuleFormState, formData: FormData): Promise<AlertRuleFormState> {
  const values = readValues(formData);
  const id = String(formData.get("id") ?? "");
  let edited = false;
  try {
    const ctx = await requireOwner();
    const parsed = ruleSchema.safeParse({
      name: values.name,
      channel: formData.get("channel") ?? "email",
      minimumSeverity: values.minimumSeverity,
      frequency: values.frequency,
    });
    const errors: Partial<Record<string, string>> = parsed.success ? {} : fieldErrors(parsed.error);

    const others = splitAddresses(values.otherRecipients);
    const invalid = others.filter((address) => !email.safeParse(address).success);
    if (invalid.length > 0) {
      errors.otherRecipients = `Check ${invalid.length === 1 ? "this address" : "these addresses"}: ${invalid.join(", ")}.`;
    }
    const recipients = [...new Set([...values.recipients, ...others].map((address) => address.trim().toLowerCase()))].filter(
      (address) => email.safeParse(address).success,
    );
    if (!errors.otherRecipients && recipients.length === 0) {
      errors.recipients = "Choose at least one person, or add an email address.";
    }
    if (recipients.length > MAX_RECIPIENTS) {
      errors.otherRecipients = `A rule can email up to ${MAX_RECIPIENTS} people. Use a shared team address for larger groups.`;
    }
    if (!parsed.success || Object.keys(errors).length > 0) {
      return { ok: false, fieldErrors: errors, values };
    }

    const db = await getDb();
    const rule = {
      name: parsed.data.name,
      channel: parsed.data.channel,
      minimumSeverity: parsed.data.minimumSeverity as Severity,
      frequency: parsed.data.frequency,
      recipients,
      active: values.active,
    };

    if (id) {
      if (!isUuid(id)) return { ok: false, message: MISSING, values };
      const [saved] = await db
        .update(alertRules)
        .set(rule)
        .where(and(eq(alertRules.id, id), eq(alertRules.organizationId, ctx.organization.id)))
        .returning({ id: alertRules.id });
      if (!saved) return { ok: false, message: MISSING, values };
      await recordAudit(ctx, "Changed an alert rule", rule.name, { recipients, minimumSeverity: rule.minimumSeverity, frequency: rule.frequency, active: rule.active });
      edited = true;
    } else {
      await db.insert(alertRules).values({ ...rule, organizationId: ctx.organization.id });
      await recordAudit(ctx, "Added an alert rule", rule.name, { recipients, minimumSeverity: rule.minimumSeverity, frequency: rule.frequency });
      refresh();
      return { ok: true, message: `Rule added. ${rule.active ? "It applies to the next issue TrueCite finds." : "It stays off until you turn it on."}` };
    }
  } catch (error) {
    return { ...actionError(error), values };
  }
  if (edited) redirect("/app/alerts?saved=1");
  return {};
}

export async function toggleAlertRule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireOwner();
    const id = String(formData.get("id") ?? "");
    const active = formData.get("active") === "true";
    if (!isUuid(id)) return { ok: false, message: MISSING };
    const db = await getDb();
    const [rule] = await db
      .update(alertRules)
      .set({ active })
      .where(and(eq(alertRules.id, id), eq(alertRules.organizationId, ctx.organization.id)))
      .returning({ name: alertRules.name });
    if (!rule) return { ok: false, message: MISSING };
    await recordAudit(ctx, active ? "Turned on an alert rule" : "Turned off an alert rule", rule.name);
    refresh();
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function deleteAlertRule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireOwner();
    const id = String(formData.get("id") ?? "");
    if (!isUuid(id)) return { ok: false, message: MISSING };
    const db = await getDb();
    const [rule] = await db
      .delete(alertRules)
      .where(and(eq(alertRules.id, id), eq(alertRules.organizationId, ctx.organization.id)))
      .returning({ name: alertRules.name });
    if (!rule) return { ok: false, message: MISSING };
    await recordAudit(ctx, "Deleted an alert rule", rule.name);
    refresh();
    return { ok: true, message: "Rule deleted." };
  } catch (error) {
    return actionError(error);
  }
}
