"use client";

import { useActionState } from "react";
import { Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionState } from "@/lib/actions";
import { ROLES, type Role } from "@/lib/domain/constants";
import { cx } from "@/lib/cx";
import { changeRole } from "./actions";

/** An owner's control for one person's role: choose, then save. */
export function RoleForm({ membershipId, role, name }: { membershipId: string; role: Role; name: string }) {
  const [state, action] = useActionState<ActionState, FormData>(changeRole, {});
  const id = `role-${membershipId}`;
  return (
    <div className="grid gap-1">
      <form action={action} className="flex items-center gap-2">
        <input type="hidden" name="membershipId" value={membershipId} />
        <label htmlFor={id} className="sr-only">
          Role for {name}
        </label>
        <Select id={id} name="role" defaultValue={role} className="h-8 w-32 text-md">
          {(Object.keys(ROLES) as Role[]).map((option) => (
            <option key={option} value={option}>
              {ROLES[option].label}
            </option>
          ))}
        </Select>
        <SubmitButton variant="quiet" size="sm">
          Save<span className="sr-only"> role for {name}</span>
        </SubmitButton>
      </form>
      {state.message ? (
        <p role="status" className={cx("max-w-56 text-sm whitespace-normal", state.ok ? "text-graphite" : "text-correction")}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
