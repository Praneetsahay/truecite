"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonSize, type ButtonVariant } from "./button";

/**
 * A form's submit button. It keeps its name while the action runs (the same
 * action keeps the same name through the whole flow) and is disabled to
 * prevent a second submission.
 */
export function SubmitButton({
  children,
  variant = "primary",
  size,
  className,
  name,
  value,
  formAction,
}: {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  name?: string;
  value?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      className={className}
      name={name}
      value={value}
      formAction={formAction}
      disabled={pending}
      aria-busy={pending || undefined}
    >
      {children}
    </Button>
  );
}
