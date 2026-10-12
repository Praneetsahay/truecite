"use client";

import { PendingButton, useFormAction } from "@/components/account/use-form-action";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { addCompetitor, type CompetitorFormState } from "./actions";

export function CompetitorForm() {
  const { state, pending, onSubmit, formRef } = useFormAction(addCompetitor);
  const errors = state.fieldErrors ?? {};
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company name" htmlFor="competitor-name" error={errors.name}>
          <Input
            id="competitor-name"
            name="name"
            autoComplete="off"
            required
            defaultValue={state.ok ? "" : state.values?.name}
            aria-invalid={Boolean(errors.name) || undefined}
            aria-describedby={errors.name ? "competitor-name-error" : undefined}
          />
        </Field>
        <Field label="Website" htmlFor="competitor-website" error={errors.website}>
          <Input
            id="competitor-website"
            name="website"
            inputMode="url"
            autoComplete="off"
            placeholder="northwind.example"
            required
            defaultValue={state.ok ? "" : state.values?.website}
            aria-invalid={Boolean(errors.website) || undefined}
            aria-describedby={errors.website ? "competitor-website-error" : undefined}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <PendingButton pending={pending}>Add competitor</PendingButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
