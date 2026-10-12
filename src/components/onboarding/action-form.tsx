"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/actions";
import type { ButtonSize, ButtonVariant } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { cx } from "@/lib/cx";

/** Shown next to the button while a slow action runs, such as reading a website. */
function PendingNote({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <p role="status" className="text-sm text-graphite">
      {children}
    </p>
  );
}

/**
 * One button that runs one Server Action, with hidden fields and the action's
 * message underneath. Used for Approve, Delete, Draft and similar actions.
 */
export function ActionForm({
  action,
  label,
  fields,
  variant = "secondary",
  size,
  pendingNote,
  showSuccess = true,
  disabled,
  className,
  onDone,
  inline,
}: {
  /** Lay the button out in the parent's flex row; the message takes a line of its own below. */
  inline?: boolean;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  label: ReactNode;
  fields?: Record<string, string>;
  variant?: ButtonVariant;
  size?: ButtonSize;
  pendingNote?: ReactNode;
  /** Show the success message, not only errors. */
  showSuccess?: boolean;
  disabled?: boolean;
  className?: string;
  onDone?: () => void;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});
  useEffect(() => {
    if (state.ok && onDone) onDone();
  }, [state, onDone]);
  const visible = state.message && (showSuccess || !state.ok) ? state : null;
  return (
    <form action={formAction} className={cx(inline ? "contents" : "grid justify-items-start gap-2", className)}>
      {fields
        ? Object.entries(fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)
        : null}
      <fieldset disabled={disabled} className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SubmitButton variant={variant} size={size}>
          {label}
        </SubmitButton>
        {pendingNote ? <PendingNote>{pendingNote}</PendingNote> : null}
      </fieldset>
      {visible ? (
        <div className={cx(inline && "basis-full")}>
          <FormMessage state={visible} />
        </div>
      ) : null}
    </form>
  );
}
