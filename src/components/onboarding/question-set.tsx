"use client";

import { useState, type ReactNode } from "react";
import type { ActionState } from "@/lib/actions";
import { QUESTION_CATEGORIES, QUESTION_CATEGORY_IDS, type QuestionCategory } from "@/lib/domain/constants";
import { plural } from "@/lib/domain/format";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { cx } from "@/lib/cx";
import { useFormAction } from "./use-form-action";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

export type QuestionItem = {
  id: string;
  text: string;
  category: QuestionCategory;
  priority: "key" | "standard";
  active: boolean;
  origin: "generated" | "custom";
};

/** The whole Question Set as one form: edit text, priority and the on switch, then save or continue. */
export function QuestionSetForm({
  questions,
  limit,
  planLabel,
  readOnly,
  action,
  children,
}: {
  questions: QuestionItem[];
  limit: number;
  planLabel: string;
  readOnly: boolean;
  action: Action;
  /** Rendered between the list and the buttons, outside this form (the "Add your own question" form). */
  children?: ReactNode;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const isActive = (q: QuestionItem) => overrides[q.id] ?? q.active;
  const activeCount = questions.filter(isActive).length;
  const over = activeCount - limit;
  const errors = state.fieldErrors ?? {};

  return (
    <>
    <form id="question-set" onSubmit={onSubmit} noValidate>
      <p className={cx("text-graphite", over > 0 && "text-correction")} aria-live="polite">
        <span className={cx("figures font-medium", over > 0 ? "text-correction" : "text-ink")}>{activeCount}</span> of{" "}
        <span className="figures">{limit}</span> questions switched on.{" "}
        {over > 0
          ? `Your ${planLabel} plan checks up to ${limit}, so switch off ${plural(over, "question")}.`
          : `Your ${planLabel} plan checks up to ${limit}.`}
      </p>
      <p className="mt-1 text-sm text-graphite">
        Key questions are checked on every scan. Standard questions can be checked less often to control costs.
      </p>

      <fieldset disabled={readOnly} className="mt-2">
        <legend className="sr-only">Questions</legend>
        {QUESTION_CATEGORY_IDS.map((category) => {
          const group = questions.filter((q) => q.category === category);
          if (group.length === 0) return null;
          return (
            <section key={category} aria-labelledby={`questions-${category}`} className="mt-10">
              <div className="mb-2 flex items-baseline justify-between gap-4">
                <h2 id={`questions-${category}`} className="text-base font-semibold text-ink">
                  {QUESTION_CATEGORIES[category].label}
                </h2>
                <span className="text-sm text-graphite">{plural(group.length, "question")}</span>
              </div>
              <div aria-hidden="true" className="hidden border-b border-rule-strong pb-2 text-sm text-graphite sm:grid sm:grid-cols-[minmax(0,1fr)_8.5rem_4.5rem] sm:gap-4">
                <span>Question</span>
                <span>Priority</span>
                <span>On</span>
              </div>
              <ul>
                {group.map((q, index) => {
                  const active = isActive(q);
                  const error = errors[`text-${q.id}`];
                  return (
                    <li
                      key={q.id}
                      className="grid gap-2 border-b border-rule py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_8.5rem_4.5rem] sm:items-start sm:gap-4"
                    >
                      <div className="grid gap-1">
                        <label htmlFor={`text-${q.id}`} className="sr-only">
                          {QUESTION_CATEGORIES[category].label}, question {index + 1}
                        </label>
                        <Input
                          id={`text-${q.id}`}
                          name={`text-${q.id}`}
                          defaultValue={q.text}
                          className={cx(!active && "text-graphite")}
                          aria-invalid={Boolean(error) || undefined}
                          aria-describedby={error ? `text-${q.id}-error` : undefined}
                        />
                        {error ? (
                          <p id={`text-${q.id}-error`} className="text-sm text-correction">
                            {error}
                          </p>
                        ) : null}
                        {q.origin === "custom" ? <span className="text-sm text-graphite">Added by your team</span> : null}
                      </div>
                      <div className="flex items-center gap-5 sm:contents">
                        <div>
                          <label htmlFor={`priority-${q.id}`} className="sr-only">
                            Priority
                          </label>
                          <Select id={`priority-${q.id}`} name={`priority-${q.id}`} defaultValue={q.priority} className="w-36 sm:w-full">
                            <option value="key">Key</option>
                            <option value="standard">Standard</option>
                          </Select>
                        </div>
                        <label className="flex h-9 cursor-pointer items-center gap-2 text-base text-ink">
                          <input
                            type="checkbox"
                            role="switch"
                            name={`active-${q.id}`}
                            defaultChecked={q.active}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setOverrides((current) => ({ ...current, [q.id]: checked }));
                            }}
                            className="size-4 accent-ink"
                          />
                          <span>{active ? "On" : "Off"}</span>
                          <span className="sr-only">, checked in scans</span>
                        </label>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </fieldset>
    </form>

    {children}

    <div className="mt-12 grid gap-3 border-t border-rule pt-6">
      <FormMessage state={state.ok && !state.message ? null : state} />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          form="question-set"
          variant="primary"
          name="intent"
          value="continue"
          disabled={readOnly || pending || over > 0 || activeCount === 0}
        >
          Save and continue
        </Button>
        <Button type="submit" form="question-set" name="intent" value="save" disabled={readOnly || pending}>
          Save changes
        </Button>
      </div>
      {activeCount === 0 ? <p className="text-sm text-graphite">Switch on at least one question to continue.</p> : null}
    </div>
    </>
  );
}

export function AddQuestionForm({ action, readOnly, brandName }: { action: Action; readOnly: boolean; brandName: string }) {
  const { state, pending, formRef, onSubmit } = useFormAction(action, { resetOnSuccess: true });
  const errors = state.fieldErrors ?? {};
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate>
      <fieldset disabled={readOnly} className="grid gap-4">
        <Field label="Question" htmlFor="new-question" hint="Write it the way a customer would ask an AI assistant." error={errors.text}>
          <Input
            id="new-question"
            name="text"
            placeholder={`Does ${brandName} work for teams in more than one country?`}
            aria-invalid={Boolean(errors.text) || undefined}
            aria-describedby={errors.text ? "new-question-error" : undefined}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" htmlFor="new-question-category" error={errors.category}>
            <Select id="new-question-category" name="category" defaultValue="products">
              {QUESTION_CATEGORY_IDS.map((id) => (
                <option key={id} value={id}>
                  {QUESTION_CATEGORIES[id].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="new-question-priority">
            <Select id="new-question-priority" name="priority" defaultValue="key">
              <option value="key">Key, checked on every scan</option>
              <option value="standard">Standard</option>
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
            Add question
          </Button>
          <FormMessage state={state} />
        </div>
      </fieldset>
    </form>
  );
}
