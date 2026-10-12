"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { brands, getDb, memberships, organizations, subscriptions, users } from "@/lib/db";

export type AuthFormState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Partial<Record<string, string>>;
  values?: Record<string, string>;
};

function safeNext(value: FormDataEntryValue | null): string | null {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/app") || next.startsWith("/admin") ? next : null;
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter the email address you signed up with."),
  password: z.string().min(1, "Enter your password."),
});

export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  const values = { email: String(formData.get("email") ?? "") };
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { fieldErrors, values };
  }

  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
  const valid = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
  if (!user || !valid) {
    return { message: "That email and password don't match an account. Check both and try again.", values };
  }

  await createSession(user.id);
  redirect(safeNext(formData.get("next")) ?? (user.isAdmin ? "/admin" : "/app/dashboard"));
}

const signupSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name."),
  email: z.string().trim().toLowerCase().email("Enter your work email address."),
  password: z.string().min(10, "Use at least 10 characters."),
  company: z.string().trim().min(2, "Enter your company's name."),
  website: z
    .string()
    .trim()
    .min(4, "Enter your company's website.")
    .transform((value) => (/^https?:\/\//i.test(value) ? value : `https://${value}`))
    .refine((value) => {
      try {
        return Boolean(new URL(value).hostname.includes("."));
      } catch {
        return false;
      }
    }, "Enter a full website address, such as acme.com."),
  country: z.enum(["IN", "OTHER"]),
});

export async function signup(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const raw = {
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    company: formData.get("company"),
    website: formData.get("website"),
    country: formData.get("country") ?? "IN",
  };
  const values = Object.fromEntries(
    Object.entries(raw)
      .filter(([key]) => key !== "password")
      .map(([key, value]) => [key, String(value ?? "")]),
  );
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { fieldErrors, values };
  }

  const db = await getDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email)).limit(1);
  if (existing) {
    return {
      fieldErrors: { email: "An account already uses this email. Log in instead, or use another address." },
      values,
    };
  }

  const india = parsed.data.country === "IN";
  const passwordHash = await hashPassword(parsed.data.password);
  const userId = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ name: parsed.data.name, email: parsed.data.email, passwordHash })
      .returning({ id: users.id });
    const [organization] = await tx
      .insert(organizations)
      .values({
        name: parsed.data.company,
        plan: "trial",
        country: india ? "IN" : "US",
        currency: india ? "INR" : "USD",
      })
      .returning({ id: organizations.id });
    await tx.insert(memberships).values({ userId: user.id, organizationId: organization.id, role: "owner" });
    await tx.insert(brands).values({
      organizationId: organization.id,
      name: parsed.data.company,
      website: parsed.data.website,
      markets: india ? ["IN"] : ["US"],
      onboardingStep: "company",
    });
    await tx.insert(subscriptions).values({
      organizationId: organization.id,
      plan: "trial",
      status: "trialing",
      amount: 0,
      currency: india ? "INR" : "USD",
    });
    return user.id;
  });

  await createSession(userId);
  redirect("/app/onboarding");
}
