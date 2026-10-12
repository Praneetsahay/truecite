import type { OutreachStep } from "./outreach";

function StepMark({ done }: { done: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="mt-[3px] shrink-0 text-ink">
      <rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill={done ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" />
      {done ? (
        <path d="M3.8 7.2 6 9.3 10.2 4.9" fill="none" stroke="var(--color-paper)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
    </svg>
  );
}

/** The outreach steps as a checklist. Steps tick off as the prospect's status moves forward. */
export function OutreachSteps({ steps }: { steps: OutreachStep[] }) {
  const next = steps.findIndex((step) => !step.done);
  return (
    <ol className="grid max-w-2xl gap-3">
      {steps.map((step, index) => (
        <li key={index} className="flex items-start gap-3">
          <StepMark done={step.done} />
          <span className="w-4 shrink-0 text-graphite">{index + 1}</span>
          <span className={step.done ? "text-graphite" : "text-ink"}>
            {step.text}
            <span className="ml-2 text-sm whitespace-nowrap text-graphite">
              {step.done ? "Done" : index === next ? <span className="font-medium text-ink">Next</span> : <span className="sr-only">Not done</span>}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
