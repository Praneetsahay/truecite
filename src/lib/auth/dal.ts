import "server-only";
import { asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { brands, getDb, memberships, organizations, type Brand, type Organization } from "@/lib/db";
import type { Role } from "@/lib/domain/constants";
import { readSession, type SessionRecord } from "./session";

/*
  The data access layer. Every page and Server Action that touches client data
  starts here, so authentication, tenancy and roles are checked close to the data.

  It also marks the render as request-time (`await connection()`), which is what
  makes it safe to create dates afterwards. Read `ctx.now` instead of calling
  `new Date()` in a server component.
*/

export type SignedInUser = SessionRecord["user"];

export type Viewer = {
  user: SignedInUser;
  sessionId: string;
  viewAsOrganizationId: string | null;
  now: Date;
};

export const getViewer = cache(async (): Promise<Viewer | null> => {
  await connection();
  const session = await readSession();
  if (!session) return null;
  return {
    user: session.user,
    sessionId: session.sessionId,
    viewAsOrganizationId: session.viewAsOrganizationId,
    now: new Date(),
  };
});

export type ClientContext = {
  user: SignedInUser;
  organization: Organization;
  brand: Brand;
  role: Role;
  /** True when an admin is viewing this account for support. Viewing is read-only and logged. */
  viewingAs: boolean;
  canEdit: boolean;
  isOwner: boolean;
  now: Date;
};

/** The client account for the signed-in user, whether or not onboarding is finished. */
export const getClientContext = cache(async (): Promise<ClientContext> => {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const db = await getDb();

  let organization: Organization | undefined;
  let role: Role = "viewer";
  let viewingAs = false;

  if (viewer.user.isAdmin && viewer.viewAsOrganizationId) {
    [organization] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, viewer.viewAsOrganizationId))
      .limit(1);
    viewingAs = Boolean(organization);
  }

  if (!organization) {
    const [membership] = await db
      .select({ organization: organizations, role: memberships.role })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(eq(memberships.userId, viewer.user.id))
      .orderBy(asc(memberships.createdAt))
      .limit(1);
    if (!membership) {
      if (viewer.user.isAdmin) redirect("/admin");
      redirect("/signup");
    }
    organization = membership.organization;
    role = membership.role;
  }

  const [brand] = await db
    .select()
    .from(brands)
    .where(eq(brands.organizationId, organization.id))
    .orderBy(asc(brands.createdAt))
    .limit(1);
  if (!brand) redirect("/signup");

  return {
    user: viewer.user,
    organization,
    brand,
    role,
    viewingAs,
    canEdit: !viewingAs && role !== "viewer",
    isOwner: !viewingAs && role === "owner",
    now: viewer.now,
  };
});

/** For every client page except onboarding: sends unfinished accounts back to onboarding. */
export async function requireClient(): Promise<ClientContext> {
  const ctx = await getClientContext();
  if (ctx.brand.onboardingStep !== "done") redirect("/app/onboarding");
  return ctx;
}

export class PermissionError extends Error {
  constructor(message = "Your role can view this account but not change it. Ask an owner for member access.") {
    super(message);
    this.name = "PermissionError";
  }
}

/** Use at the top of every client Server Action that changes data. */
export async function requireEditor(): Promise<ClientContext> {
  const ctx = await getClientContext();
  if (ctx.viewingAs) throw new PermissionError("You are viewing this account as support, which is read-only.");
  if (!ctx.canEdit) throw new PermissionError();
  return ctx;
}

/** Use for team, billing and alert settings. */
export async function requireOwner(): Promise<ClientContext> {
  const ctx = await requireEditor();
  if (ctx.role !== "owner") throw new PermissionError("Only an owner can change this.");
  return ctx;
}

export type AdminContext = { user: SignedInUser; sessionId: string; now: Date };

/** Admin pages and actions. Anyone else gets a plain 404. */
export const requireAdmin = cache(async (): Promise<AdminContext> => {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.user.isAdmin) notFound();
  return { user: viewer.user, sessionId: viewer.sessionId, now: viewer.now };
});

/** Confirms a record belongs to the current brand before it is read or changed. */
export function sameBrand<T extends { brandId: string }>(record: T | undefined, ctx: ClientContext): T {
  if (!record || record.brandId !== ctx.brand.id) notFound();
  return record;
}

/**
 * For public request-time pages that read the database without a session
 * (shared report links, for example). Returns the request time.
 */
export async function requestNow(): Promise<Date> {
  await connection();
  return new Date();
}
