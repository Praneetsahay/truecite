"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionState } from "@/lib/actions";
import { cx } from "@/lib/cx";

type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * A one-button form for a single change, such as removing a competitor or
 * turning a rule off. With `confirm`, the first press asks before anything
 * changes. Errors appear next to the button.
 */
export function ActionButton({
  action,
  fields,
  label,
  target,
  variant = "quiet",
  size = "sm",
  confirm,
  className,
}: {
  action: FormAction;
  fields: Record<string, string>;
  label: string;
  /** What the button acts on, read after the label by screen readers: "Remove" + "Northwind Payroll". */
  target?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Ask before a change that cannot be undone. */
  confirm?: { question: string; confirmLabel?: string };
  className?: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});
  const [asking, setAsking] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  // Keep keyboard focus on the control that replaced the one just pressed.
  useEffect(() => {
    if (!moved.current) return;
    wrapper.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [asking]);

  const srTarget = target ? <span className="sr-only"> {target}</span> : null;

  return (
    <div ref={wrapper} className={cx("grid justify-items-start gap-1", className)}>
      {confirm && !asking ? (
        <Button
          variant={variant}
          size={size}
          onClick={() => {
            moved.current = true;
            setAsking(true);
          }}
        >
          {label}
          {srTarget}
        </Button>
      ) : (
        <form action={formAction} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {confirm ? <span className="text-sm text-ink">{confirm.question}</span> : null}
          <SubmitButton variant={confirm ? "secondary" : variant} size={size}>
            {confirm ? (confirm.confirmLabel ?? label) : label}
            {srTarget}
          </SubmitButton>
          {confirm ? (
            <Button
              variant="quiet"
              size="sm"
              onClick={() => {
                moved.current = true;
                setAsking(false);
              }}
            >
              Cancel
            </Button>
          ) : null}
        </form>
      )}
      {state.message ? (
        <p role="status" className={cx("max-w-xs text-sm whitespace-normal", state.ok ? "text-graphite" : "text-correction")}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
