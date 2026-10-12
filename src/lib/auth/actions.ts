"use server";

import { redirect } from "next/navigation";
import { auditLog, getDb, organizations } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getViewer } from "./dal";
import { destroySession, setViewAs } from "./session";

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}

/** Ends an admin's support view of a client account. Logged. */
export async function stopViewingAs(): Promise<void> {
  const viewer = await getViewer();
  if (!viewer?.user.isAdmin) redirect("/login");
  if (viewer.viewAsOrganizationId) {
    const db = await getDb();
    const [organization] = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, viewer.viewAsOrganizationId))
      .limit(1);
    await setViewAs(viewer.sessionId, null);
    await db.insert(auditLog).values({
      organizationId: organization?.id ?? null,
      actorId: viewer.user.id,
      actorName: viewer.user.name,
      action: "Stopped viewing as a client",
      target: organization?.name ?? null,
    });
    // Back to the client's page, where support started.
    if (organization) redirect(`/admin/clients/${organization.id}`);
  }
  redirect("/admin");
}
