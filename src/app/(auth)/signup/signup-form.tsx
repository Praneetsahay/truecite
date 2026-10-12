"use client";

import { useActionState } from "react";
import { Choice, Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { signup, type AuthFormState } from "../actions";

function errorProps(state: AuthFormState, name: string) {
  const error = state.fieldErrors?.[name];
  return {
    "aria-invalid": Boolean(error) || undefined,
    "aria-describedby": error ? `${name}-error` : undefined,
  } as const;
}

export function SignupForm() {
  const [state, action] = useActionState<AuthFormState, FormData>(signup, {});
  const country = state.values?.country ?? "IN";
  return (
    <form action={action} className="grid gap-5" noValidate>
      {state.message ? (
        <p role="alert" className="border-l-2 border-correction bg-sheet px-4 py-3 text-sm text-ink">
          {state.message}
        </p>
      ) : null}
      <Field label="Your name" htmlFor="name" error={state.fieldErrors?.name}>
        <Input id="name" name="name" autoComplete="name" required defaultValue={state.values?.name} {...errorProps(state, "name")} />
      </Field>
      <Field label="Work email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.values?.email}
          {...errorProps(state, "email")}
        />
      </Field>
      <Field label="Password" htmlFor="password" hint="At least 10 characters." error={state.fieldErrors?.password}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required {...errorProps(state, "password")} />
      </Field>
      <div className="grid gap-5 border-t border-rule pt-5">
        <Field label="Company name" htmlFor="company" error={state.fieldErrors?.company}>
          <Input
            id="company"
            name="company"
            autoComplete="organization"
            required
            defaultValue={state.values?.company}
            {...errorProps(state, "company")}
          />
        </Field>
        <Field
          label="Company website"
          htmlFor="website"
          hint="TrueCite reads its public pages to draft your Fact Sheet."
          error={state.fieldErrors?.website}
        >
          <Input
            id="website"
            name="website"
            inputMode="url"
            autoComplete="url"
            placeholder="acme.com"
            required
            defaultValue={state.values?.website}
            {...errorProps(state, "website")}
          />
        </Field>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium text-ink">Billing country</legend>
          <div className="mt-1 grid gap-2">
            <Choice type="radio" name="country" value="IN" label="India" description="Prices in INR, plus 18% GST" defaultChecked={country === "IN"} />
            <Choice type="radio" name="country" value="OTHER" label="Another country" description="Prices in USD" defaultChecked={country === "OTHER"} />
          </div>
        </fieldset>
      </div>
      <SubmitButton className="w-full">Create account</SubmitButton>
      <p className="text-sm text-graphite">
        TrueCite never asks for access to your systems, analytics or customer data. It only reads public pages and AI
        answers.
      </p>
    </form>
  );
}
