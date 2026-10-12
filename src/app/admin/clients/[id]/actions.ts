"use server";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/dal";
import { setViewAs } from "@/lib/auth/session";
import { auditLog, getDb } from "@/lib/db";
import { getClientOrganization } from "@/lib/queries/admin-ops";

const viewAsSchema = z.object({ organizationId: z.uuid() });

/**
 * "View as client": opens the client app as this account, read-only, for support.
 * Every use is written to the audit log.
 */
export async function viewAsClient(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const parsed = viewAsSchema.safeParse({ organizationId: formData.get("organizationId") });
  if (!parsed.success) notFound();

  const organization = await getClientOrganization(parsed.data.organizationId);
  if (!organization) notFound();

  await setViewAs(ctx.sessionId, organization.id);
  const db = await getDb();
  await db.insert(auditLog).values({
    organizationId: organization.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: `Viewed ${organization.name} as a client`,
    target: organization.name,
  });

  redirect("/app/dashboard");
}
