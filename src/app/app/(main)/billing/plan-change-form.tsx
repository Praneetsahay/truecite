"use client";

import { PendingButton, useFormAction } from "@/components/account/use-form-action";
import { Field, FormMessage, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";
import { PLANS, type PlanId } from "@/lib/domain/constants";
import { requestPlanChange, type PlanChangeState } from "./actions";

const OPTIONS: PlanId[] = ["starter", "professional", "enterprise"];

export function PlanChangeForm({ current }: { current: PlanId }) {
  const { state, pending, onSubmit, formRef } = useFormAction(requestPlanChange);
  const errors = state.fieldErrors ?? {};
  const values = !state.ok ? state.values : undefined;
  const options = OPTIONS.filter((plan) => plan !== current);

  return (
    <div className="grid gap-6">
      {state.ok ? <Notice tone="done" title="Plan change request sent">{state.message}</Notice> : null}
      <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-4">
        <Field label="Plan you want" htmlFor="plan-wanted" error={errors.plan} className="max-w-xs">
          <Select
            id="plan-wanted"
            name="plan"
            defaultValue={values?.plan ?? options[0]}
            aria-invalid={Boolean(errors.plan) || undefined}
            aria-describedby={errors.plan ? "plan-wanted-error" : undefined}
          >
            {options.map((plan) => (
              <option key={plan} value={plan}>
                {PLANS[plan].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Anything we should know"
          htmlFor="plan-note"
          optional
          hint="For example, when you want the change to start, or how many competitors you need."
          error={errors.note}
        >
          <Textarea
            id="plan-note"
            name="note"
            rows={3}
            defaultValue={values?.note}
            aria-invalid={Boolean(errors.note) || undefined}
            aria-describedby={errors.note ? "plan-note-error" : "plan-note-hint"}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <PendingButton pending={pending}>Ask to change plan</PendingButton>
          {!state.ok ? <FormMessage state={state} /> : null}
        </div>
      </form>
    </div>
  );
}
