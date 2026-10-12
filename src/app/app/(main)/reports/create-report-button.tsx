"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionState } from "@/lib/actions";
import { cx } from "@/lib/cx";
import { createLastMonthReport } from "./actions";

export function CreateReportButton({ hint, className }: { hint?: string; className?: string }) {
  const [state, action] = useActionState<ActionState, FormData>(createLastMonthReport, {});
  return (
    <form action={action} className={cx("grid justify-items-start gap-2 sm:justify-items-end", className)}>
      <SubmitButton>Create last month&apos;s report</SubmitButton>
      {state.message ? (
        <div className="max-w-xs sm:text-right">
          <FormMessage state={state} />
        </div>
      ) : hint ? (
        <p className="text-sm text-graphite sm:text-right">{hint}</p>
      ) : null}
    </form>
  );
}
