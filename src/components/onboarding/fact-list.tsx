"use client";

import { useCallback, useState } from "react";
import type { ActionState } from "@/lib/actions";
import { IMPORTANCE, type FactStatus } from "@/lib/domain/constants";
import { displayUrl, formatDate } from "@/lib/domain/format";
import { Button, ExternalLink } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { SeverityMark } from "@/components/ui/marks";
import { ActionForm } from "./action-form";
import { FactFields, type FactValues } from "./fact-fields";
import { useFormAction } from "./use-form-action";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

export type FactItem = FactValues & { id: string; status: FactStatus; origin: "website" | "manual" };

export type FactActions = { approve: Action; update: Action; remove: Action };

function FactEditor({ fact, update, onClose }: { fact: FactItem; update: Action; onClose: () => void }) {
  const { state, pending, onSubmit } = useFormAction(update, { onSuccess: onClose });
  return (
    <form onSubmit={onSubmit} className="grid gap-4 border border-rule-strong bg-sheet p-4 sm:p-5" noValidate>
      <input type="hidden" name="id" value={fact.id} />
      <FactFields prefix={`fact-${fact.id}`} values={fact} errors={state.fieldErrors ?? {}} />
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="sm" disabled={pending} aria-busy={pending || undefined}>
          Save and approve
        </Button>
        <Button variant="quiet" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {!state.ok ? <FormMessage state={state} /> : null}
    </form>
  );
}

function FactRow({ fact, actions, readOnly }: { fact: FactItem; actions: FactActions; readOnly: boolean }) {
  const [editing, setEditing] = useState(false);
  const close = useCallback(() => setEditing(false), []);
  const approved = fact.status === "approved";

  if (editing) {
    return (
      <li className="border-b border-rule py-4 last:border-b-0">
        <FactEditor fact={fact} update={actions.update} onClose={close} />
      </li>
    );
  }

  return (
    <li className="grid gap-3 border-b border-rule py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-8">
      <div className="min-w-0">
        <p className="text-base text-ink">{fact.statement}</p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-graphite">
          <span className="inline-flex items-center gap-2">
            <SeverityMark severity={fact.importance} showLabel={false} />
            <span>{IMPORTANCE[fact.importance].label} importance</span>
          </span>
          {fact.validFrom ? <span>Valid from {formatDate(fact.validFrom)}</span> : null}
          {fact.sourceUrl ? (
            <span className="min-w-0 break-all">
              Source: <ExternalLink href={fact.sourceUrl}>{displayUrl(fact.sourceUrl)}</ExternalLink>
            </span>
          ) : (
            <span>{fact.origin === "manual" ? "Added by hand" : "No source page"}</span>
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 sm:justify-end">
        {approved ? (
          <span className="pt-1.5 text-sm text-verified">Approved</span>
        ) : (
          <span className="mt-1.5 text-sm">
            <span className="highlight">Needs review</span>
          </span>
        )}
        {!readOnly ? (
          <>
            {!approved ? (
              <ActionForm action={actions.approve} fields={{ id: fact.id }} label="Approve" size="sm" showSuccess={false} inline />
            ) : null}
            <Button variant="quiet" size="sm" className="h-8" onClick={() => setEditing(true)}>
              Edit<span className="sr-only">: {fact.statement}</span>
            </Button>
            <ActionForm
              action={actions.remove}
              fields={{ id: fact.id }}
              label={
                <>
                  Delete<span className="sr-only">: {fact.statement}</span>
                </>
              }
              variant="quiet"
              size="sm"
              className="[&_button]:h-8"
              showSuccess={false}
              inline
            />
          </>
        ) : null}
      </div>
    </li>
  );
}

export function FactList({ facts, actions, readOnly }: { facts: FactItem[]; actions: FactActions; readOnly: boolean }) {
  return (
    <ul className="border-t border-rule">
      {facts.map((fact) => (
        <FactRow key={fact.id} fact={fact} actions={actions} readOnly={readOnly} />
      ))}
    </ul>
  );
}

export function AddFactForm({ action, readOnly }: { action: Action; readOnly: boolean }) {
  const { state, pending, formRef, onSubmit } = useFormAction(action, { resetOnSuccess: true });
  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-5" noValidate>
      <fieldset disabled={readOnly} className="grid gap-5">
        <FactFields prefix="new-fact" errors={state.fieldErrors ?? {}} />
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
            Add fact
          </Button>
          <FormMessage state={state} />
        </div>
      </fieldset>
    </form>
  );
}
