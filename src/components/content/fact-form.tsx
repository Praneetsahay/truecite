"use client";

import { useActionState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ButtonVariant } from "@/components/ui/button";
import { FACT_CATEGORIES, FACT_CATEGORY_IDS, IMPORTANCE, SEVERITY_ORDER, type FactCategory, type Importance } from "@/lib/domain/constants";
import { ContentMessage } from "./form-message";
import type { ContentAction, ContentFormState } from "./form-state";

export type FactFormDefaults = {
  category?: FactCategory | "";
  statement?: string;
  importance?: Importance;
  validFrom?: string | null;
  sourceUrl?: string | null;
};

/** Adds a fact, or corrects one. The same fields in the same order everywhere. */
export function FactForm({
  action,
  id,
  defaults = {},
  submitLabel,
  submitVariant = "primary",
  idPrefix,
  children,
}: {
  action: ContentAction;
  /** The fact being edited. */
  id?: string;
  defaults?: FactFormDefaults;
  submitLabel: string;
  submitVariant?: ButtonVariant;
  idPrefix: string;
  /** Extra controls next to the submit button, such as a cancel link. */
  children?: React.ReactNode;
}) {
  const [state, formAction] = useActionState<ContentFormState, FormData>(action, {});
  const values = state.values ?? {};
  const errors = state.fieldErrors ?? {};
  const value = (name: keyof FactFormDefaults) => values[name] ?? String(defaults[name] ?? "");
  const fieldId = (name: string) => `${idPrefix}-${name}`;
  const describe = (name: string, hint = false) =>
    errors[name] ? `${fieldId(name)}-error` : hint ? `${fieldId(name)}-hint` : undefined;

  return (
    <form key={state.key} action={formAction} className="grid max-w-3xl gap-5" noValidate>
      {id ? <input type="hidden" name="id" value={id} /> : null}

      <Field
        label="Fact"
        htmlFor={fieldId("statement")}
        hint="One plain sentence a customer could check, such as “The Basic plan costs $79 per month.”"
        error={errors.statement}
      >
        <Textarea
          id={fieldId("statement")}
          name="statement"
          rows={2}
          maxLength={500}
          required
          defaultValue={value("statement")}
          aria-invalid={Boolean(errors.statement) || undefined}
          aria-describedby={describe("statement", true)}
          className="min-h-16"
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Category" htmlFor={fieldId("category")} error={errors.category}>
          <Select
            id={fieldId("category")}
            name="category"
            required
            defaultValue={value("category")}
            aria-invalid={Boolean(errors.category) || undefined}
            aria-describedby={describe("category")}
          >
            <option value="" disabled>
              Choose
            </option>
            {FACT_CATEGORY_IDS.map((category) => (
              <option key={category} value={category}>
                {FACT_CATEGORIES[category].label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Importance" htmlFor={fieldId("importance")} error={errors.importance}>
          <Select
            id={fieldId("importance")}
            name="importance"
            defaultValue={value("importance") || "medium"}
            aria-invalid={Boolean(errors.importance) || undefined}
            aria-describedby={describe("importance")}
          >
            {SEVERITY_ORDER.map((importance) => (
              <option key={importance} value={importance}>
                {IMPORTANCE[importance].label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Valid from" htmlFor={fieldId("validFrom")} optional error={errors.validFrom}>
          <Input
            id={fieldId("validFrom")}
            name="validFrom"
            type="date"
            defaultValue={value("validFrom")}
            aria-invalid={Boolean(errors.validFrom) || undefined}
            aria-describedby={describe("validFrom")}
          />
        </Field>
      </div>

      <Field
        label="Source page"
        htmlFor={fieldId("sourceUrl")}
        optional
        hint="The public page that states this fact."
        error={errors.sourceUrl}
      >
        <Input
          id={fieldId("sourceUrl")}
          name="sourceUrl"
          type="text"
          inputMode="url"
          autoComplete="url"
          placeholder="acme.com/pricing"
          defaultValue={value("sourceUrl")}
          aria-invalid={Boolean(errors.sourceUrl) || undefined}
          aria-describedby={describe("sourceUrl", true)}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <SubmitButton variant={submitVariant}>{submitLabel}</SubmitButton>
        {children}
        <ContentMessage state={state} />
      </div>
    </form>
  );
}
