"use client";

import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import type { ActionState } from "@/lib/actions";
import { PROSPECT_STATUSES, type ProspectStatus } from "@/lib/domain/constants";
import { SaveButton, useKeepValues, type FormAction } from "./action-form";

function errorProps(state: ActionState, name: string) {
  const error = state.fieldErrors?.[name];
  return {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${name}-error` : undefined,
  } as const;
}

/** Add a prospect: the company, and the person to write to once you know who it is. */
export function ProspectForm({ action }: { action: FormAction }) {
  const { state, onSubmit, pending } = useKeepValues(action);
  const err = (name: string) => state.fieldErrors?.[name];
  return (
    <form onSubmit={onSubmit} className="grid max-w-xl gap-8" noValidate>
      <fieldset className="grid gap-4">
        <legend className="mb-4 text-base font-semibold text-ink">Company</legend>
        <Field label="Company name" htmlFor="company" error={err("company")}>
          <Input id="company" name="company" autoComplete="organization" required {...errorProps(state, "company")} />
        </Field>
        <Field label="Website" htmlFor="website" hint="Its pages are read to draft the facts the scan checks against." error={err("website")}>
          <Input id="website" name="website" inputMode="url" placeholder="treyresearch.com" required {...errorProps(state, "website")} />
        </Field>
        <Field label="Industry" htmlFor="industry" optional error={err("industry")}>
          <Input id="industry" name="industry" placeholder="Payroll software" {...errorProps(state, "industry")} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 border-t border-rule pt-6">
        <legend className="sr-only">Contact</legend>
        <div>
          <p className="text-base font-semibold text-ink">Contact</p>
          <p className="mt-1 text-sm text-graphite">
            The head of PR or corporate communications, the brand head or CMO, or the founder at a smaller company. Add them
            later if you have not found the right person yet.
          </p>
        </div>
        <Field label="Name" htmlFor="contactName" optional error={err("contactName")}>
          <Input id="contactName" name="contactName" autoComplete="off" {...errorProps(state, "contactName")} />
        </Field>
        <Field label="Email" htmlFor="contactEmail" optional error={err("contactEmail")}>
          <Input id="contactEmail" name="contactEmail" type="email" autoComplete="off" {...errorProps(state, "contactEmail")} />
        </Field>
        <Field label="Role" htmlFor="contactRole" optional error={err("contactRole")}>
          <Input id="contactRole" name="contactRole" placeholder="Head of corporate communications" {...errorProps(state, "contactRole")} />
        </Field>
      </fieldset>

      <div className="grid gap-3">
        <SaveButton pending={pending} className="justify-self-start">
          Add prospect
        </SaveButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

/** Where the prospect is in the pipeline, who to write to, and notes for the next conversation. */
export function ProspectStatusForm({
  action,
  prospectId,
  status,
  notes,
  contactName,
  contactEmail,
  contactRole,
}: {
  action: FormAction;
  prospectId: string;
  status: ProspectStatus;
  notes: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactRole: string | null;
}) {
  const { state, onSubmit, pending } = useKeepValues(action);
  const err = (name: string) => state.fieldErrors?.[name];
  return (
    <form onSubmit={onSubmit} className="grid max-w-xl gap-4" noValidate>
      <input type="hidden" name="prospectId" value={prospectId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact name" htmlFor="contactName" optional error={err("contactName")}>
          <Input id="contactName" name="contactName" defaultValue={contactName ?? ""} autoComplete="off" {...errorProps(state, "contactName")} />
        </Field>
        <Field label="Contact role" htmlFor="contactRole" optional error={err("contactRole")}>
          <Input id="contactRole" name="contactRole" defaultValue={contactRole ?? ""} {...errorProps(state, "contactRole")} />
        </Field>
      </div>
      <Field label="Contact email" htmlFor="contactEmail" optional error={err("contactEmail")}>
        <Input
          id="contactEmail"
          name="contactEmail"
          type="email"
          defaultValue={contactEmail ?? ""}
          autoComplete="off"
          {...errorProps(state, "contactEmail")}
        />
      </Field>
      <Field label="Status" htmlFor="status" error={state.fieldErrors?.status}>
        <Select id="status" name="status" defaultValue={status} className="sm:w-64">
          {(Object.keys(PROSPECT_STATUSES) as ProspectStatus[]).map((id) => (
            <option key={id} value={id}>
              {PROSPECT_STATUSES[id].label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Notes" htmlFor="notes" optional error={state.fieldErrors?.notes}>
        <Textarea id="notes" name="notes" defaultValue={notes ?? ""} rows={4} placeholder="Who you spoke to, what they asked, when to follow up" />
      </Field>
      <div className="flex flex-wrap items-center gap-4">
        <SaveButton pending={pending} variant="secondary">
          Save changes
        </SaveButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
