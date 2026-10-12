import { ONBOARDING_STEPS, type OnboardingStep } from "@/lib/domain/constants";
import { cx } from "@/lib/cx";

const STEPS = ["company", "facts", "questions", "scan"] as const satisfies readonly OnboardingStep[];

/**
 * The four steps as plain text. The current one is marked with weight, an
 * underline and aria-current; earlier steps can be reopened by editors.
 */
export function StepList({
  current,
  goBack,
}: {
  current: Exclude<OnboardingStep, "done">;
  /** Server Action that reopens an earlier step; omitted when the account is read-only. */
  goBack?: (formData: FormData) => Promise<void>;
}) {
  const currentNumber = ONBOARDING_STEPS[current].step;
  return (
    <nav aria-label="Setup steps" className="mb-10">
      <ol className="flex flex-wrap gap-x-6 gap-y-2 border-b border-rule text-sm">
        {STEPS.map((step) => {
          const { label, step: number } = ONBOARDING_STEPS[step];
          const isCurrent = step === current;
          const isDone = number < currentNumber;
          const text = (
            <>
              <span className="figures">{number}</span>
              <span>{label}</span>
              {isDone ? <span className="sr-only">, done</span> : null}
            </>
          );
          return (
            <li
              key={step}
              aria-current={isCurrent ? "step" : undefined}
              className={cx(
                "-mb-px flex items-baseline border-b-2 pb-2.5",
                isCurrent ? "border-ink font-medium text-ink" : "border-transparent text-graphite",
              )}
            >
              {isDone && goBack ? (
                <form action={goBack}>
                  <input type="hidden" name="step" value={step} />
                  <button
                    type="submit"
                    className="inline-flex items-baseline gap-1.5 hover:text-ink hover:underline hover:underline-offset-[3px]"
                    title={`Go back to step ${number}`}
                  >
                    {text}
                  </button>
                </form>
              ) : (
                <span className="inline-flex items-baseline gap-1.5">{text}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
