"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionState } from "@/lib/actions";
import { cx } from "@/lib/cx";

type ScanAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/** One scan action as a button, with its result beside it. The name stays the same through the flow. */
export function ScanActionForm({
  action,
  scanId,
  label,
  variant = "secondary",
  hint,
  className,
}: {
  action: ScanAction;
  scanId: string;
  label: string;
  variant?: "primary" | "secondary";
  hint?: string;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={cx("flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4", className)}>
      <input type="hidden" name="scanId" value={scanId} />
      <SubmitButton variant={variant} className="self-start">
        {label}
      </SubmitButton>
      {state.message ? <FormMessage state={state} /> : hint ? <p className="text-sm text-graphite">{hint}</p> : null}
    </form>
  );
}
