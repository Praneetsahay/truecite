import type { ComponentProps, ReactNode } from "react";
import { cx } from "@/lib/cx";

/*
  Form controls. Labels sit above controls, hints and errors below.
  Errors say what happened and what to do next.
*/

const controlBase =
  "w-full rounded-md border border-rule-strong bg-sheet text-base text-ink placeholder:text-graphite/70 transition-colors hover:border-ink/40 disabled:cursor-not-allowed disabled:bg-paper disabled:text-graphite aria-[invalid=true]:border-correction";

export const inputClass = cx(controlBase, "h-9 px-3");
export const textareaClass = cx(controlBase, "min-h-24 px-3 py-2 leading-relaxed");
export const selectClass = cx(controlBase, "select-chevron h-9 pl-3");

export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("grid gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
        {optional ? <span className="font-normal text-graphite"> (optional)</span> : null}
      </label>
      {children}
      {hint ? (
        <p id={`${htmlFor}-hint`} className="text-sm text-graphite">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-sm text-correction">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(inputClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(textareaClass, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(selectClass, className)} {...props} />;
}

/** A checkbox or radio with its label to the right. */
export function Choice({
  type = "checkbox",
  label,
  description,
  className,
  ...props
}: Omit<ComponentProps<"input">, "type"> & {
  type?: "checkbox" | "radio";
  label: ReactNode;
  description?: ReactNode;
}) {
  return (
    <label className={cx("flex cursor-pointer items-start gap-3", props.disabled && "cursor-not-allowed opacity-60", className)}>
      <input type={type} className="mt-1 size-4 shrink-0 accent-ink" {...props} />
      <span className="grid gap-0.5">
        <span className="text-base text-ink">{label}</span>
        {description ? <span className="text-sm text-graphite">{description}</span> : null}
      </span>
    </label>
  );
}

/** A group of related fields with a legend, for longer forms. */
export function Fieldset({
  legend,
  description,
  children,
  className,
}: {
  legend: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cx("grid gap-4", className)}>
      <div>
        <legend className="text-base font-semibold text-ink">{legend}</legend>
        {description ? <p className="mt-1 text-sm text-graphite">{description}</p> : null}
      </div>
      {children}
    </fieldset>
  );
}

/** The message a form shows after its action runs. */
export function FormMessage({ state }: { state: { ok?: boolean; message?: string } | null | undefined }) {
  if (!state?.message) return null;
  return (
    <p role="status" className={cx("text-sm", state.ok ? "text-verified" : "text-correction")}>
      {state.message}
    </p>
  );
}
