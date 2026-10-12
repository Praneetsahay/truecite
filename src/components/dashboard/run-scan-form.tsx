"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionState } from "@/lib/actions";

/** "Run a scan now": starts a manual scan of the whole Question Set. */
export function RunScanForm({
  action,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="grid justify-items-start gap-2 sm:justify-items-end">
      <SubmitButton>Run a scan now</SubmitButton>
      <div className="max-w-xs sm:text-right">
        <FormMessage state={state} />
      </div>
    </form>
  );
}
