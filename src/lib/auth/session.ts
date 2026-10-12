import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb, sessions, users } from "@/lib/db";

export const SESSION_COOKIE = "tc_session";
const SESSION_DAYS = 30;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Call from a Server Action or Route Handler after verifying the password. */
export async function createSession(userId: string): Promise<void> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const db = await getDb();
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  }
  jar.delete(SESSION_COOKIE);
}

export type SessionRecord = {
  sessionId: string;
  viewAsOrganizationId: string | null;
  user: {
    id: string;
    name: string;
    email: string;
    title: string | null;
    isAdmin: boolean;
  };
};

/** Reads the session cookie and returns the signed-in user, or null. */
export async function readSession(): Promise<SessionRecord | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const [row] = await db
    .select({
      sessionId: sessions.id,
      viewAsOrganizationId: sessions.viewAsOrganizationId,
      id: users.id,
      name: users.name,
      email: users.email,
      title: users.title,
      isAdmin: users.isAdmin,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  return {
    sessionId: row.sessionId,
    viewAsOrganizationId: row.viewAsOrganizationId,
    user: { id: row.id, name: row.name, email: row.email, title: row.title, isAdmin: row.isAdmin },
  };
}

/** Admin support: view a client's account. Every start and stop is written to the audit log by the caller. */
export async function setViewAs(sessionId: string, organizationId: string | null): Promise<void> {
  const db = await getDb();
  await db.update(sessions).set({ viewAsOrganizationId: organizationId }).where(eq(sessions.id, sessionId));
}
