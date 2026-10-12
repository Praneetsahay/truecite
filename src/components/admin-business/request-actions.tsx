"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { FormAction } from "./action-form";

/** Accept or decline a free check request. Both buttons sit in one form so only one can run. */
export function RequestActions({
  requestId,
  company,
  accept,
  decline,
}: {
  requestId: string;
  company: string;
  accept: FormAction;
  decline: FormAction;
}) {
  const [acceptState, acceptAction] = useActionState(accept, {});
  const [declineState, declineAction] = useActionState(decline, {});
  const state = acceptState.message ? acceptState : declineState;
  return (
    <form className="grid justify-items-start gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <div className="flex items-center gap-4">
        <SubmitButton variant="secondary" size="sm" formAction={acceptAction}>
          Accept<span className="sr-only"> {company}</span>
        </SubmitButton>
        <SubmitButton variant="quiet" size="sm" formAction={declineAction}>
          Decline<span className="sr-only"> {company}</span>
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
