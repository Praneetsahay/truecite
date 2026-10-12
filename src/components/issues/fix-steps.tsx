"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Choice } from "@/components/ui/field";
import type { ActionState } from "@/lib/actions";

type SetFixStep = (input: { number: number; step: number; done: boolean }) => Promise<ActionState>;

function DoneBox({ done }: { done: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="mt-[5px] shrink-0 text-ink">
      <rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="none" stroke="currentColor" strokeOpacity={done ? 1 : 0.45} strokeWidth="1.5" />
      {done ? (
        <path d="M3.6 7.2 6 9.4 10.4 4.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
    </svg>
  );
}

/**
 * The Fix Playbook steps for this kind of error. Editors tick them off and each
 * tick is saved to the history; everyone else sees the same list, read-only.
 */
export function FixSteps({
  number,
  steps,
  done,
  canEdit,
  setFixStep,
}: {
  number: number;
  steps: readonly string[];
  done: number[];
  canEdit: boolean;
  setFixStep: SetFixStep;
}) {
  const [optimisticDone, applyOptimistic] = useOptimistic(done, (current: number[], change: { step: number; done: boolean }) =>
    change.done ? [...new Set([...current, change.step])] : current.filter((step) => step !== change.step),
  );
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const doneCount = steps.filter((_, index) => optimisticDone.includes(index)).length;

  function toggle(step: number, checked: boolean) {
    setError(null);
    startTransition(async () => {
      applyOptimistic({ step, done: checked });
      const result = await setFixStep({ number, step, done: checked });
      if (!result.ok) setError(result.message ?? "That didn't save. Try again.");
    });
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-medium text-ink">Fix steps</h2>
        <p className="text-sm text-graphite" aria-live="polite">
          {doneCount} of {steps.length} done
        </p>
      </div>
      {canEdit ? (
        <ul className="mt-3 grid gap-3">
          {steps.map((step, index) => (
            <li key={index}>
              <Choice
                label={<span className="text-md leading-snug">{step}</span>}
                checked={optimisticDone.includes(index)}
                onChange={(event) => toggle(index, event.currentTarget.checked)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-3 grid gap-3">
          {steps.map((step, index) => {
            const isDone = optimisticDone.includes(index);
            return (
              <li key={index} className="flex gap-3">
                <DoneBox done={isDone} />
                <span className="text-md leading-snug text-ink">
                  {step}
                  <span className="sr-only">{isDone ? " (done)" : " (not done yet)"}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-correction">
          {error}
        </p>
      ) : null}
    </div>
  );
}
