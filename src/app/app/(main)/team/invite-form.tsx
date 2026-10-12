"use client";

import { PendingButton, useFormAction } from "@/components/account/use-form-action";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { ROLES, type Role } from "@/lib/domain/constants";
import { inviteMember, type InviteFormState } from "./actions";

export function InviteForm() {
  const { state, pending, onSubmit, formRef } = useFormAction(inviteMember);
  const errors = state.fieldErrors ?? {};
  const values = !state.ok ? state.values : undefined;
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <Field label="Work email" htmlFor="invite-email" error={errors.email}>
          <Input
            id="invite-email"
            name="email"
            type="email"
            autoComplete="off"
            placeholder="name@company.com"
            defaultValue={values?.email}
            aria-invalid={Boolean(errors.email) || undefined}
            aria-describedby={errors.email ? "invite-email-error" : undefined}
          />
        </Field>
        <Field label="Role" htmlFor="invite-role" error={errors.role}>
          <Select id="invite-role" name="role" defaultValue={values?.role ?? "member"}>
            {(Object.keys(ROLES) as Role[]).map((role) => (
              <option key={role} value={role}>
                {ROLES[role].label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <PendingButton pending={pending}>Send invitation</PendingButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
