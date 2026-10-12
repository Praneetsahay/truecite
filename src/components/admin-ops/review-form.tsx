"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { IMPORTANCE, SEVERITY_ORDER, type Severity } from "@/lib/domain/constants";
import type { ActionState } from "@/lib/actions";

type ReviewFormState = ActionState & { values?: { note: string; severity: string } };
type Decision = "approve" | "reject";

/**
 * Approve (with an optional severity change and note) or reject (with a required
 * note). One form, two decisions: the button pressed decides. Submits through
 * onSubmit so a failed submission never clears the note.
 */
export function ReviewForm({
  action,
  issueId,
  severity,
  clientName,
}: {
  action: (state: ReviewFormState, formData: FormData) => Promise<ReviewFormState>;
  issueId: string;
  severity: Severity;
  clientName: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [decision, setDecision] = useState<Decision | null>(null);
  const noteError = state.fieldErrors?.note;
  const severityError = state.fieldErrors?.severity;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter instanceof HTMLButtonElement ? submitter : null);
    const chosen = formData.get("decision");
    setDecision(chosen === "reject" ? "reject" : "approve");
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={onSubmit} className="grid max-w-xl gap-5" noValidate>
      <input type="hidden" name="issueId" value={issueId} />

      {state.message ? (
        <p role="alert" className="border-l-2 border-correction bg-sheet px-4 py-3 text-sm text-ink">
          {state.message}
        </p>
      ) : null}

      <Field
        label="Severity"
        htmlFor="review-severity"
        hint="Change it if the checker over- or underrated the risk. Used when you approve."
        error={severityError}
      >
        <Select
          id="review-severity"
          name="severity"
          defaultValue={severity}
          className="max-w-72"
          aria-invalid={Boolean(severityError) || undefined}
          aria-describedby={severityError ? "review-severity-error" : "review-severity-hint"}
        >
          {SEVERITY_ORDER.map((level) => (
            <option key={level} value={level}>
              {IMPORTANCE[level].label}
              {level === severity ? ", as the checker rated it" : ""}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Note"
        htmlFor="review-note"
        hint="Optional when you approve. Required when you reject: say why it is not an error, so the checker can learn from it."
        error={noteError}
      >
        <Textarea
          id="review-note"
          name="note"
          rows={3}
          aria-invalid={Boolean(noteError) || undefined}
          aria-describedby={noteError ? "review-note-error" : "review-note-hint"}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          name="decision"
          value="approve"
          variant="primary"
          disabled={pending}
          aria-busy={(pending && decision === "approve") || undefined}
        >
          Approve
        </Button>
        <Button
          type="submit"
          name="decision"
          value="reject"
          variant="secondary"
          disabled={pending}
          aria-busy={(pending && decision === "reject") || undefined}
        >
          Reject
        </Button>
      </div>
      <p className="-mt-2 text-sm text-graphite" aria-live="polite">
        {pending
          ? decision === "reject"
            ? "Rejecting. The next waiting issue opens in a moment."
            : "Approving. The next waiting issue opens in a moment."
          : `Approve shows the issue to ${clientName}. Reject keeps it hidden. Either way, the next waiting issue opens.`}
      </p>
    </form>
  );
}
