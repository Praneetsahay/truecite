"use client";

import { useActionState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { IMPORTANCE, SEVERITY_ORDER, type Importance } from "@/lib/domain/constants";
import { ContentMessage } from "./form-message";
import type { ContentAction, ContentFormState } from "./form-state";

/**
 * "No longer true": the fact gets today as its last day and moves to past
 * facts. The fact that replaces it can be added in the same step.
 */
export function RetireForm({
  action,
  id,
  importance,
  todayLabel,
}: {
  action: ContentAction;
  id: string;
  importance: Importance;
  todayLabel: string;
}) {
  const [state, formAction] = useActionState<ContentFormState, FormData>(action, {});
  const values = state.values ?? {};
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="grid max-w-3xl gap-5" noValidate>
      <input type="hidden" name="id" value={id} />

      <Field
        label="What is true now?"
        htmlFor="retire-replacement"
        optional
        hint={`The new fact is approved and valid from today, ${todayLabel}. Leave this empty if nothing replaces the old fact.`}
        error={errors.replacement}
      >
        <Textarea
          id="retire-replacement"
          name="replacement"
          rows={2}
          maxLength={500}
          defaultValue={values.replacement ?? ""}
          aria-invalid={Boolean(errors.replacement) || undefined}
          aria-describedby={errors.replacement ? "retire-replacement-error" : "retire-replacement-hint"}
          className="min-h-16"
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Field label="Importance of the new fact" htmlFor="retire-importance" error={errors.importance}>
          <Select id="retire-importance" name="importance" defaultValue={values.importance ?? importance}>
            {SEVERITY_ORDER.map((level) => (
              <option key={level} value={level}>
                {IMPORTANCE[level].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Source page for the new fact" htmlFor="retire-source" optional error={errors.sourceUrl}>
          <Input
            id="retire-source"
            name="sourceUrl"
            type="text"
            inputMode="url"
            placeholder="acme.com/pricing"
            defaultValue={values.sourceUrl ?? ""}
            aria-invalid={Boolean(errors.sourceUrl) || undefined}
            aria-describedby={errors.sourceUrl ? "retire-source-error" : undefined}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <SubmitButton variant="secondary">Mark as no longer true</SubmitButton>
        <ContentMessage state={state} />
      </div>
    </form>
  );
}
