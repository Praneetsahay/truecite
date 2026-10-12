"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { checkRequests, getDb } from "@/lib/db";
import type { ActionState } from "@/lib/actions";
import { COMPANY } from "@/lib/content/company";

/** The free check form's state: the action's result plus what was typed, so a failed submit keeps it. */
export type FreeCheckState = ActionState & { values?: Record<string, string> };

/** Name of the hidden field people never see. Anything typed into it comes from a bot. */
const HONEYPOT = "fax";

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => (value === "" ? null : value));

const schema = z.object({
  company: z.string().trim().min(2, "Enter your company's name.").max(200, "Use a shorter company name."),
  website: z
    .string()
    .trim()
    .min(4, "Enter your company's website.")
    .max(300, "Enter just the website address, such as acme.com.")
    .transform((value) => (/^https?:\/\//i.test(value) ? value : `https://${value}`))
    .refine((value) => {
      try {
        return Boolean(new URL(value).hostname.includes("."));
      } catch {
        return false;
      }
    }, "Enter a full website address, such as acme.com."),
  name: z.string().trim().min(2, "Enter your name.").max(120, "Use a shorter name."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter your work email address, such as priya@acme.com.").max(254, "Use a shorter email address.")),
  role: optionalText(120, "Keep your role under 120 characters."),
  message: optionalText(2000, "Keep this under 2,000 characters, or email us the rest."),
});

const FIELDS = ["company", "website", "name", "email", "role", "message"] as const;

export async function requestFreeCheck(_prev: FreeCheckState, formData: FormData): Promise<FreeCheckState> {
  const raw = Object.fromEntries(FIELDS.map((field) => [field, String(formData.get(field) ?? "")]));

  // Bots fill every field they find. Act as if it worked and store nothing.
  if (String(formData.get(HONEYPOT) ?? "").trim() !== "") {
    return { ok: true };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, message: "Some fields need attention.", fieldErrors, values: raw };
  }

  try {
    const db = await getDb();
    const data = parsed.data;
    // A second submit of the same request (a double click, a reload) is not a new request.
    const [existing] = await db
      .select({ id: checkRequests.id })
      .from(checkRequests)
      .where(
        and(eq(checkRequests.email, data.email), eq(checkRequests.website, data.website), eq(checkRequests.status, "new")),
      )
      .limit(1);
    if (!existing) {
      await db.insert(checkRequests).values({
        company: data.company,
        website: data.website,
        name: data.name,
        email: data.email,
        role: data.role,
        message: data.message,
        status: "new",
      });
    }
  } catch (error) {
    console.error(error);
    return {
      ok: false,
      message: `Your request didn't reach us. Try again in a minute, or email ${COMPANY.email}.`,
      values: raw,
    };
  }

  return { ok: true };
}
