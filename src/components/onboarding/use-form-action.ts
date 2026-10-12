"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import type { ActionState } from "@/lib/actions";

/**
 * Runs a Server Action from a form's submit event instead of its action prop,
 * so React does not reset the fields: when the server returns an error, what
 * the person typed stays in place. The form is reset only after a success,
 * and only when `resetOnSuccess` is set.
 */
export function useFormAction<S extends ActionState>(
  action: (state: S, formData: FormData) => Promise<S>,
  options: { resetOnSuccess?: boolean; onSuccess?: () => void } = {},
) {
  const [state, dispatch, pending] = useActionState<S, FormData>(action, {} as Awaited<S>);
  const formRef = useRef<HTMLFormElement>(null);
  const { resetOnSuccess, onSuccess } = options;

  useEffect(() => {
    if (!state.ok) return;
    if (resetOnSuccess) formRef.current?.reset();
    onSuccess?.();
  }, [state, resetOnSuccess, onSuccess]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (submitter instanceof HTMLButtonElement && submitter.name) formData.set(submitter.name, submitter.value);
    startTransition(() => dispatch(formData));
  }

  return { state, pending, formRef, onSubmit };
}
