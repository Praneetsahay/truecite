"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { Field, Input, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { requestFreeCheck, type FreeCheckState } from "./actions";

function errorProps(state: FreeCheckState, name: string) {
  const error = state.fieldErrors?.[name];
  return {
    "aria-invalid": Boolean(error) || undefined,
    "aria-describedby": error ? `${name}-error` : undefined,
  } as const;
}

const linkClass = "text-ink underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink";

export function FreeCheckForm() {
  const [state, action] = useActionState<FreeCheckState, FormData>(requestFreeCheck, {});
  const doneRef = useRef<HTMLDivElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state.ok) doneRef.current?.focus();
    else if (state.message) alertRef.current?.focus();
  }, [state]);

  if (state.ok) {
    return (
      <div ref={doneRef} tabIndex={-1} role="status" className="border-t border-rule-strong pt-6 outline-none">
        <h2 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Request received.</h2>
        <p className="mt-3 max-w-xl text-lg leading-relaxed text-ink">
          We review every request by hand and send your mini-report within three working days.
        </p>
        <p className="mt-6 text-graphite">
          While you wait, read the{" "}
          <Link href="/sample-report" className={linkClass}>
            sample report
          </Link>{" "}
          or see the{" "}
          <Link href="/pricing" className={linkClass}>
            plans and prices
          </Link>
          .
        </p>
      </div>
    );
  }

  const values = state.values ?? {};
  return (
    <form action={action} className="grid gap-5" noValidate>
      {state.message ? (
        <p
          ref={alertRef}
          tabIndex={-1}
          role="alert"
          className="border-l-2 border-correction bg-sheet px-4 py-3 text-sm text-ink outline-none"
        >
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Company" htmlFor="company" error={state.fieldErrors?.company}>
          <Input
            id="company"
            name="company"
            autoComplete="organization"
            required
            maxLength={200}
            defaultValue={values.company}
            {...errorProps(state, "company")}
          />
        </Field>
        <Field label="Website" htmlFor="website" error={state.fieldErrors?.website}>
          <Input
            id="website"
            name="website"
            inputMode="url"
            autoComplete="url"
            placeholder="acme.com"
            required
            maxLength={300}
            defaultValue={values.website}
            {...errorProps(state, "website")}
          />
        </Field>
        <Field label="Your name" htmlFor="name" error={state.fieldErrors?.name}>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            required
            maxLength={120}
            defaultValue={values.name}
            {...errorProps(state, "name")}
          />
        </Field>
        <Field label="Work email" htmlFor="email" error={state.fieldErrors?.email}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            defaultValue={values.email}
            {...errorProps(state, "email")}
          />
        </Field>
      </div>

      <Field label="Your role" htmlFor="role" optional error={state.fieldErrors?.role}>
        <Input
          id="role"
          name="role"
          autoComplete="organization-title"
          placeholder="Head of Corporate Communications"
          maxLength={120}
          defaultValue={values.role}
          {...errorProps(state, "role")}
        />
      </Field>

      <Field
        label="What worries you"
        htmlFor="message"
        optional
        hint="A product, a rumor, a competitor. We add questions about it to your check."
        error={state.fieldErrors?.message}
      >
        <Textarea
          id="message"
          name="message"
          rows={4}
          maxLength={2000}
          defaultValue={values.message}
          aria-invalid={Boolean(state.fieldErrors?.message) || undefined}
          aria-describedby={state.fieldErrors?.message ? "message-error" : "message-hint"}
        />
      </Field>

      {/* Hidden from people and screen readers. Bots fill it in, and the action then stores nothing. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="fax">Leave this field empty</label>
        <input id="fax" name="fax" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <div className="flex flex-col gap-4 pt-1 sm:flex-row sm:items-center sm:gap-6">
        <SubmitButton className="sm:w-auto">Request a free check</SubmitButton>
        <p className="text-sm text-graphite">
          We use these details only to prepare and send your mini-report. See the{" "}
          <Link href="/privacy" className={linkClass}>
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </form>
  );
}
