"use client";

import { useActionState, type ReactNode } from "react";
import { Notice } from "@/components/ui/page";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionState } from "@/lib/actions";
import type { IssueStatus } from "@/lib/domain/constants";
import { ActionMessage } from "./action-message";

type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

export type StatusBandTransition = { to: IssueStatus; label: string; variant: "primary" | "secondary" | "quiet" };

/**
 * The full-width band under the proof: where the issue stands, when TrueCite
 * checks it next, and what the team can do about it. Not sticky, not a card.
 */
export function StatusBand({
  number,
  items,
  canEdit,
  transitions,
  recheckVariant,
  recheckNext,
  changeStatus,
  recheck,
}: {
  number: number;
  items: { label: string; value: ReactNode }[];
  canEdit: boolean;
  transitions: StatusBandTransition[];
  recheckVariant: "primary" | "secondary";
  /** What happens after "Re-check now", shown in the "Re-check started" notice. */
  recheckNext: string;
  changeStatus: FormAction;
  recheck: FormAction;
}) {
  const [statusState, statusAction] = useActionState(changeStatus, {});
  const [recheckState, recheckAction] = useActionState(recheck, {});

  // Primary last, so the main action sits at the end of the row as in the proof view sketch.
  const order = { quiet: 0, secondary: 1, primary: 2 } as const;
  const buttons = [
    ...transitions.map((t) => ({ key: t.to, label: t.label, variant: t.variant, to: t.to as IssueStatus | null })),
    { key: "recheck", label: "Re-check now", variant: recheckVariant, to: null },
  ].sort((a, b) => order[a.variant] - order[b.variant]);

  return (
    <section aria-labelledby="status-band-title" className="border-t border-rule-strong pt-5">
      <h2 id="status-band-title" className="sr-only">
        Status and next steps
      </h2>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <dl className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
          {items.map((item) => (
            <div key={item.label} className="flex items-baseline gap-2">
              <dt className="text-graphite">{item.label}</dt>
              <dd className="text-ink">{item.value}</dd>
            </div>
          ))}
        </dl>
        {canEdit ? (
          <form action={statusAction} className="flex flex-wrap items-center gap-x-3 gap-y-3">
            <input type="hidden" name="number" value={number} />
            {buttons.map((button) =>
              button.to ? (
                <SubmitButton key={button.key} name="to" value={button.to} variant={button.variant}>
                  {button.label}
                </SubmitButton>
              ) : (
                <SubmitButton key={button.key} variant={button.variant} formAction={recheckAction}>
                  {button.label}
                </SubmitButton>
              ),
            )}
          </form>
        ) : null}
      </div>
      {statusState.message ? <ActionMessage state={statusState} className="mt-4" /> : null}
      {recheckState.ok ? (
        <Notice title="Re-check started" className="mt-4">
          {recheckNext}
        </Notice>
      ) : recheckState.message ? (
        <ActionMessage state={recheckState} className="mt-4" />
      ) : null}
    </section>
  );
}
