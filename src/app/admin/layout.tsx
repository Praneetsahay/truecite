import { count, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { AdminShell } from "@/components/shell/admin-shell";
import { requireAdmin } from "@/lib/auth/dal";
import { getDb, issues, scanJobs } from "@/lib/db";

export const instant = false;

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin · TrueCite" },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const ctx = await requireAdmin();
  const db = await getDb();
  const [[pending], [failed]] = await Promise.all([
    db.select({ value: count() }).from(issues).where(eq(issues.reviewState, "pending")),
    db.select({ value: count() }).from(scanJobs).where(eq(scanJobs.status, "failed")),
  ]);

  return (
    <AdminShell user={{ name: ctx.user.name }} pendingReview={pending.value} failedJobs={failed.value}>
      {children}
    </AdminShell>
  );
}
