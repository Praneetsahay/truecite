import { logout, stopViewingAs } from "@/lib/auth/actions";
import { ONBOARDING_STEPS, type OnboardingStep } from "@/lib/domain/constants";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/shell/wordmark";

/** Onboarding sits outside the app shell: the wordmark, where you are, and a way out. */
export function OnboardingHeader({
  step,
  viewingAs,
}: {
  step: Exclude<OnboardingStep, "done">;
  /** The organization name when an admin is viewing this account for support. */
  viewingAs: string | null;
}) {
  const { label, step: number } = ONBOARDING_STEPS[step];
  return (
    <>
      <header className="border-b border-rule">
        <div className="mx-auto flex h-14 w-full max-w-[880px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-baseline gap-3 sm:gap-5">
            <Wordmark href="/app/onboarding" />
            <p className="truncate text-sm text-graphite">
              Step {number} of 4: {label}
            </p>
          </div>
          <form action={logout} className="shrink-0">
            <button
              type="submit"
              className="text-sm text-graphite underline decoration-rule-strong underline-offset-[3px] hover:text-ink hover:decoration-ink"
            >
              Log out
            </button>
          </form>
        </div>
      </header>
      {viewingAs ? (
        <div className="border-b border-rule bg-highlighter/45">
          <div className="mx-auto flex w-full max-w-[880px] flex-col gap-2 px-4 py-2.5 text-sm text-ink sm:flex-row sm:items-center sm:justify-between sm:px-6">
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
        </div>
      ) : null}
    </>
  );
}
