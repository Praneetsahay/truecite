import type { ReactNode } from "react";
import { logout, stopViewingAs } from "@/lib/auth/actions";
import { displayUrl } from "@/lib/domain/format";
import { Button } from "@/components/ui/button";
import { MobileMenu } from "./mobile-menu";
import { NavLink } from "./nav-link";
import { Wordmark } from "./wordmark";

type ShellProps = {
  brand: { name: string; website: string };
  user: { name: string; email: string };
  roleLabel: string;
  /** Set when an admin is viewing this account for support. */
  viewingAs: string | null;
  openIssues: number;
  children: ReactNode;
};

function ClientNav({ openIssues }: { openIssues: number }) {
  return (
    <nav aria-label="Account" className="grid gap-6">
      <ul className="grid gap-0.5">
        <li>
          <NavLink href="/app/dashboard">Dashboard</NavLink>
        </li>
        <li>
          <NavLink href="/app/issues" count={openIssues}>
            Issues
          </NavLink>
        </li>
        <li>
          <NavLink href="/app/questions">Questions</NavLink>
        </li>
        <li>
          <NavLink href="/app/facts">Fact Sheet</NavLink>
        </li>
        <li>
          <NavLink href="/app/sources">Sources</NavLink>
        </li>
        <li>
          <NavLink href="/app/competitors">Competitors</NavLink>
        </li>
        <li>
          <NavLink href="/app/reports">Reports</NavLink>
        </li>
      </ul>
      <div>
        <p className="px-2.5 pb-1.5 text-sm text-graphite">Settings</p>
        <ul className="grid gap-0.5">
          <li>
            <NavLink href="/app/alerts">Alerts</NavLink>
          </li>
          <li>
            <NavLink href="/app/team">Team</NavLink>
          </li>
          <li>
            <NavLink href="/app/billing">Billing</NavLink>
          </li>
        </ul>
      </div>
    </nav>
  );
}

function Account({ user, roleLabel }: { user: ShellProps["user"]; roleLabel: string }) {
  return (
    <div className="grid gap-1 border-t border-rule pt-4">
      <p className="truncate text-base font-medium text-ink">{user.name}</p>
      <p className="truncate text-sm text-graphite">{user.email}</p>
      <div className="mt-1 flex items-center gap-3 text-sm text-graphite">
        <span>{roleLabel}</span>
        <span aria-hidden="true">·</span>
        <form action={logout}>
          <button type="submit" className="text-graphite underline decoration-rule-strong underline-offset-[3px] hover:text-ink">
            Log out
          </button>
        </form>
      </div>
    </div>
  );
}

/** The client app: a quiet left navigation, content on the right. */
export function AppShell({ brand, user, roleLabel, viewingAs, openIssues, children }: ShellProps) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-8 overflow-y-auto border-r border-rule px-4 py-5 lg:flex">
        <Wordmark href="/app/dashboard" className="px-2.5" />
        <div className="px-2.5">
          <p className="text-sm text-graphite">Monitoring</p>
          <p className="mt-0.5 font-medium text-ink">{brand.name}</p>
          <p className="truncate text-sm text-graphite">{displayUrl(brand.website)}</p>
        </div>
        <ClientNav openIssues={openIssues} />
        <div className="mt-auto px-2.5">
          <Account user={user} roleLabel={roleLabel} />
        </div>
      </aside>

      <div className="min-w-0">
        <header className="relative flex h-14 items-center justify-between gap-4 border-b border-rule px-4 sm:px-6 lg:hidden">
          <div className="flex min-w-0 items-baseline gap-3">
            <Wordmark href="/app/dashboard" />
            <span className="truncate text-sm text-graphite">{brand.name}</span>
          </div>
          <MobileMenu>
            <div className="grid gap-6">
              <ClientNav openIssues={openIssues} />
              <Account user={user} roleLabel={roleLabel} />
            </div>
          </MobileMenu>
        </header>

        {viewingAs ? (
          <div className="flex flex-col gap-2 border-b border-rule bg-highlighter/45 px-4 py-2.5 text-sm text-ink sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-12">
            <p>
              You are viewing <span className="font-medium">{viewingAs}</span> as support. It is read-only, and every view is
              logged.
            </p>
            <form action={stopViewingAs}>
              <Button type="submit" size="sm">
                Stop viewing
              </Button>
            </form>
          </div>
        ) : null}

        <main id="main" className="mx-auto w-full max-w-[1120px] px-4 py-8 sm:px-6 lg:px-12 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
