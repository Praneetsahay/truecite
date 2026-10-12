"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionState } from "@/lib/actions";
import { shareReportLink } from "../actions";

export function ShareButton({ reportId }: { reportId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(shareReportLink, {});
  return (
    <form action={action} className="grid justify-items-start gap-2 sm:justify-items-end">
      <input type="hidden" name="id" value={reportId} />
      <SubmitButton variant="secondary">Share link</SubmitButton>
      {state.message && !state.ok ? (
        <div className="max-w-xs sm:text-right">
          <FormMessage state={state} />
        </div>
      ) : null}
    </form>
  );
}
