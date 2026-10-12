import { and, count, eq, isNull, ne } from "drizzle-orm";
import { AppShell } from "@/components/shell/app-shell";
import { requireClient } from "@/lib/auth/dal";
import { getDb, issues } from "@/lib/db";
import { ROLES } from "@/lib/domain/constants";

export default async function ClientAppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireClient();
  const db = await getDb();
  const [{ value: openIssues }] = await db
    .select({ value: count() })
    .from(issues)
    .where(
      and(
        eq(issues.brandId, ctx.brand.id),
        eq(issues.reviewState, "approved"),
        ne(issues.status, "resolved"),
        isNull(issues.dismissedAt),
      ),
    );

  return (
    <AppShell
      brand={{ name: ctx.brand.name, website: ctx.brand.website }}
      user={{ name: ctx.user.name, email: ctx.user.email }}
      roleLabel={ctx.viewingAs ? "Support view" : ROLES[ctx.role].label}
      viewingAs={ctx.viewingAs ? ctx.organization.name : null}
      openIssues={openIssues}
    >
      {children}
    </AppShell>
  );
}
