"use client";

import { startTransition, useActionState, type FormEvent, type ReactNode } from "react";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionState } from "@/lib/actions";
import { cx } from "@/lib/cx";

export type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * For forms people type into: submits through the action without React's
 * automatic form reset, so a validation error never wipes what was typed.
 */
export function useKeepValues(action: FormAction) {
  const [state, formAction, pending] = useActionState(action, {});
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter instanceof HTMLButtonElement ? submitter : null);
    startTransition(() => formAction(formData));
  }
  return { state, onSubmit, pending };
}

/** The submit button for useKeepValues forms. It keeps its name while the action runs. */
export function SaveButton({
  pending,
  children,
  variant = "primary",
  className,
}: {
  pending: boolean;
  children: ReactNode;
  variant?: ButtonVariant;
  className?: string;
}) {
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-busy={pending || undefined} className={className}>
      {children}
    </Button>
  );
}

/**
 * One action as a button, with hidden fields and its result beside it.
 * The button keeps its name through the flow; the message says what happened.
 */
export function ActionForm({
  action,
  fields,
  label,
  variant = "secondary",
  size,
  hint,
  className,
  stack,
}: {
  action: FormAction;
  fields: Record<string, string>;
  label: string;
  variant?: "primary" | "secondary" | "quiet";
  size?: "sm" | "md";
  hint?: ReactNode;
  className?: string;
  /** Put the message under the button instead of beside it. */
  stack?: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form
      action={formAction}
      className={cx("flex flex-col items-start gap-2", !stack && "sm:flex-row sm:items-center sm:gap-4", className)}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton variant={variant} size={size}>
        {label}
      </SubmitButton>
      {state.message ? <FormMessage state={state} /> : hint ? <div className="text-sm text-graphite">{hint}</div> : null}
    </form>
  );
}
