"use client";

import { useActionState } from "react";
import type { ButtonSize, ButtonVariant } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { cx } from "@/lib/cx";
import { ContentMessage } from "./form-message";
import type { ContentAction } from "./form-state";

/**
 * One button that runs one Server Action, with hidden fields and the result
 * shown next to it. For approve, delete, archive and similar row actions.
 */
export function ActionButton({
  action,
  fields,
  children,
  variant = "secondary",
  size = "sm",
  className,
  label,
}: {
  action: ContentAction;
  fields: Record<string, string>;
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** Context for screen readers when the visible text is short, such as which fact. */
  label?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={cx("inline-flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton variant={variant} size={size}>
        {children}
        {label ? <span className="sr-only">: {label}</span> : null}
      </SubmitButton>
      <ContentMessage state={state} />
    </form>
  );
}
