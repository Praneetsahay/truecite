import type { ReactNode } from "react";
import { logout } from "@/lib/auth/actions";
import { MobileMenu } from "./mobile-menu";
import { NavLink } from "./nav-link";
import { Wordmark } from "./wordmark";

function AdminNav({ pendingReview, failedJobs }: { pendingReview: number; failedJobs: number }) {
  return (
    <nav aria-label="Admin" className="grid gap-0.5">
      <NavLink href="/admin" exact>
        Clients
      </NavLink>
      <NavLink href="/admin/review" count={pendingReview}>
        Review queue
      </NavLink>
      <NavLink href="/admin/scans" count={failedJobs}>
        Scans and jobs
      </NavLink>
      <NavLink href="/admin/costs">Costs</NavLink>
      <NavLink href="/admin/prospects">Prospects</NavLink>
      <NavLink href="/admin/settings">Settings</NavLink>
    </nav>
  );
}

function Account({ name }: { name: string }) {
  return (
    <div className="grid gap-1 border-t border-rule pt-4">
      <p className="truncate font-medium text-ink">{name}</p>
      <form action={logout}>
        <button type="submit" className="text-sm text-graphite underline decoration-rule-strong underline-offset-[3px] hover:text-ink">
          Log out
        </button>
      </form>
    </div>
  );
}

/** The internal admin panel. Same quiet layout as the client app, its own navigation. */
export function AdminShell({
  user,
  pendingReview,
  failedJobs,
  children,
}: {
  user: { name: string };
  pendingReview: number;
  failedJobs: number;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-8 overflow-y-auto border-r border-rule px-4 py-5 lg:flex">
        <Wordmark href="/admin" suffix="Admin" className="px-2.5" />
        <AdminNav pendingReview={pendingReview} failedJobs={failedJobs} />
        <div className="mt-auto px-2.5">
          <Account name={user.name} />
        </div>
      </aside>
      <div className="min-w-0">
        <header className="relative flex h-14 items-center justify-between border-b border-rule px-4 sm:px-6 lg:hidden">
          <Wordmark href="/admin" suffix="Admin" />
          <MobileMenu>
            <div className="grid gap-6">
              <AdminNav pendingReview={pendingReview} failedJobs={failedJobs} />
              <Account name={user.name} />
            </div>
          </MobileMenu>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6 lg:px-12 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
