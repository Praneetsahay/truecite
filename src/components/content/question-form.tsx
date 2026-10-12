"use client";

import { useActionState } from "react";
import type { ButtonVariant } from "@/components/ui/button";
import { Choice, Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { QUESTION_CATEGORIES, QUESTION_CATEGORY_IDS, type QuestionCategory } from "@/lib/domain/constants";
import { ContentMessage } from "./form-message";
import type { ContentAction, ContentFormState } from "./form-state";

export type QuestionFormDefaults = {
  category?: QuestionCategory | "";
  text?: string;
  priority?: "key" | "standard";
  active?: boolean;
};

/** Adds a question, or edits one. */
export function QuestionForm({
  action,
  id,
  idPrefix,
  defaults = {},
  submitLabel,
  submitVariant = "primary",
  showActive = false,
  brandName,
  disabled = false,
  children,
}: {
  action: ContentAction;
  id?: string;
  idPrefix: string;
  defaults?: QuestionFormDefaults;
  submitLabel: string;
  submitVariant?: ButtonVariant;
  showActive?: boolean;
  brandName: string;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const [state, formAction] = useActionState<ContentFormState, FormData>(action, {});
  const values = state.values ?? {};
  const errors = state.fieldErrors ?? {};
  const fieldId = (name: string) => `${idPrefix}-${name}`;
  const priority = values.priority || defaults.priority || "standard";
  const active = values.active !== undefined ? values.active === "on" : (defaults.active ?? true);

  return (
    <form key={state.key} action={formAction} className="grid max-w-3xl gap-5" noValidate>
      {id ? <input type="hidden" name="id" value={id} /> : null}

      <Field
        label="Question"
        htmlFor={fieldId("text")}
        hint="Write it the way a customer would type it into an AI assistant."
        error={errors.text}
      >
        <Input
          id={fieldId("text")}
          name="text"
          maxLength={300}
          required
          disabled={disabled}
          placeholder={`Does ${brandName} work for companies with staff in two countries?`}
          defaultValue={values.text ?? defaults.text ?? ""}
          aria-invalid={Boolean(errors.text) || undefined}
          aria-describedby={errors.text ? `${fieldId("text")}-error` : `${fieldId("text")}-hint`}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-start">
        <Field label="Category" htmlFor={fieldId("category")} error={errors.category}>
          <Select
            id={fieldId("category")}
            name="category"
            required
            disabled={disabled}
            defaultValue={values.category ?? defaults.category ?? ""}
            aria-invalid={Boolean(errors.category) || undefined}
            aria-describedby={errors.category ? `${fieldId("category")}-error` : undefined}
          >
            <option value="" disabled>
              Choose
            </option>
            {QUESTION_CATEGORY_IDS.map((category) => (
              <option key={category} value={category}>
                {QUESTION_CATEGORIES[category].label}
              </option>
            ))}
          </Select>
        </Field>

        <fieldset className="grid gap-2" disabled={disabled}>
          <legend className="mb-1.5 text-sm font-medium text-ink">Priority</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Choice
              type="radio"
              name="priority"
              value="key"
              label="Key"
              description="Checked on every scan"
              defaultChecked={priority === "key"}
            />
            <Choice
              type="radio"
              name="priority"
              value="standard"
              label="Standard"
              description="Can be checked less often"
              defaultChecked={priority === "standard"}
            />
          </div>
          {errors.priority ? <p className="text-sm text-correction">{errors.priority}</p> : null}
        </fieldset>
      </div>

      {showActive ? (
        <Choice
          name="active"
          label="Ask this question in scans"
          description="Switched-off questions keep their history and can be switched on again."
          defaultChecked={active}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {disabled ? null : <SubmitButton variant={submitVariant}>{submitLabel}</SubmitButton>}
        {children}
        <ContentMessage state={state} />
      </div>
    </form>
  );
}
