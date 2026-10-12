"use client";

import { useActionState, useState } from "react";
import { Field, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionState } from "@/lib/actions";
import { ActionMessage } from "./action-message";

type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/** Who on the team owns the fix. */
export function AssigneeForm({
  number,
  assigneeId,
  members,
  action,
}: {
  number: number;
  assigneeId: string | null;
  members: { id: string; name: string }[];
  action: FormAction;
}) {
  const [state, formAction] = useActionState(action, {});
  const error = state.fieldErrors?.assigneeId;
  return (
    <form action={formAction} className="grid gap-3">
      <input type="hidden" name="number" value={number} />
      <Field label="Assignee" htmlFor="issue-assignee" error={error}>
        <Select
          id="issue-assignee"
          name="assigneeId"
          defaultValue={assigneeId ?? ""}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? "issue-assignee-error" : undefined}
        >
          <option value="">Nobody</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SubmitButton variant="secondary" size="sm">
          Save assignee
        </SubmitButton>
        {!error ? <ActionMessage state={state} /> : null}
      </div>
    </form>
  );
}

/** A note for the history, visible to the whole team. */
export function NoteForm({ number, action }: { number: number; action: FormAction }) {
  const [note, setNote] = useState("");
  const [state, formAction] = useActionState(async (previous: ActionState, formData: FormData) => {
    const result = await action(previous, formData);
    if (result.ok) setNote("");
    return result;
  }, {});
  const error = state.fieldErrors?.note;
  return (
    <form action={formAction} className="grid gap-3">
      <input type="hidden" name="number" value={number} />
      <Field
        label="Add a note"
        htmlFor="issue-note"
        hint="Notes join the history with your name and the time, for your whole team to see."
        error={error}
      >
        <Textarea
          id="issue-note"
          name="note"
          rows={3}
          maxLength={2000}
          value={note}
          onChange={(event) => setNote(event.currentTarget.value)}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? "issue-note-error" : "issue-note-hint"}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SubmitButton variant="secondary">Add note</SubmitButton>
        {!error ? <ActionMessage state={state} /> : null}
      </div>
    </form>
  );
}

/**
 * "Not an error": takes the issue off the list and the score. A short note is
 * required, because the checker learns from it and the trail must say why.
 */
export function DismissForm({ number, action }: { number: number; action: FormAction }) {
  // Kept in state so a note survives a failed save (forms reset after their action runs).
  const [note, setNote] = useState("");
  const [state, formAction] = useActionState(action, {});
  const error = state.fieldErrors?.note;
  return (
    <details className="group" open={Boolean(error || state.message) || undefined}>
      <summary className="cursor-pointer list-none text-base text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink [&::-webkit-details-marker]:hidden">
        Not an error
      </summary>
      <form action={formAction} className="mt-4 grid gap-3">
        <input type="hidden" name="number" value={number} />
        <p className="text-sm text-graphite">
          Use this when the AI answer is actually correct. The issue leaves your list and the score, and TrueCite’s
          checker learns from your note. It stays in the history.
        </p>
        <Field label="Why is this not an error?" htmlFor="issue-dismiss-note" error={error}>
          <Textarea
            id="issue-dismiss-note"
            name="note"
            rows={3}
            maxLength={500}
            required
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? "issue-dismiss-note-error" : undefined}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <SubmitButton variant="secondary">Mark as not an error</SubmitButton>
          {!error ? <ActionMessage state={state} /> : null}
        </div>
      </form>
    </details>
  );
}
