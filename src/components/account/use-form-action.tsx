"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { Button, type ButtonVariant } from "@/components/ui/button";
import type { ActionState } from "@/lib/actions";

/**
 * For forms people type into. React resets a <form action> form after every
 * action, which would wipe what was typed when validation fails. This submits
 * through the action from onSubmit instead, and clears the form only when the
 * action succeeded.
 */
export function useFormAction<S extends ActionState>(action: (state: S, formData: FormData) => Promise<S>) {
  const [state, formAction, pending] = useActionState<S, FormData>(action, {} as Awaited<S>);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter instanceof HTMLButtonElement ? submitter : null);
    startTransition(() => formAction(formData));
  }

  return { state, pending, onSubmit, formRef };
}

/** The submit button for useFormAction forms. It keeps its name while the action runs. */
export function PendingButton({
  pending,
  children,
  variant = "primary",
}: {
  pending: boolean;
  children: ReactNode;
  variant?: ButtonVariant;
}) {
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-busy={pending || undefined}>
      {children}
    </Button>
  );
}
