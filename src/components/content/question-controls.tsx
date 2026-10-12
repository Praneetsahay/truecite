"use client";

import { useActionState } from "react";
import { cx } from "@/lib/cx";
import { ContentMessage } from "./form-message";
import type { ContentAction, ContentFormState } from "./form-state";

/**
 * Whether TrueCite asks this question in scans. A real switch for assistive
 * technology, with the word next to it so the state never depends on color.
 */
export function ActiveSwitch({
  action,
  id,
  active,
  question,
  returnTo,
}: {
  action: ContentAction;
  id: string;
  active: boolean;
  question: string;
  /** The list to come back to when switching off hides the row. */
  returnTo?: string;
}) {
  const [state, formAction, pending] = useActionState<ContentFormState, FormData>(action, {});
  // While the change saves, show where it is going.
  const shown = pending ? !active : active;
  return (
    <form action={formAction} className="grid justify-items-start gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={String(!active)} />
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <button
        type="submit"
        role="switch"
        aria-checked={active}
        aria-label={`Ask in scans: ${question}`}
        disabled={pending}
        className="group inline-flex items-center gap-2 rounded-sm py-0.5 text-sm text-ink disabled:cursor-wait"
      >
        <span
          aria-hidden="true"
          className={cx(
            "relative inline-block h-4 w-7 shrink-0 rounded-sm border transition-colors",
            shown ? "border-ink bg-ink" : "border-rule-strong bg-sheet group-hover:border-ink/50",
          )}
        >
          <span
            className={cx(
              "absolute top-[1px] size-3 rounded-xs transition-transform",
              shown ? "left-[1px] translate-x-3 bg-sheet" : "left-[1px] translate-x-0 bg-rule-strong",
            )}
          />
        </span>
        <span aria-hidden="true" className={shown ? "text-ink" : "text-graphite"}>
          {shown ? "On" : "Off"}
        </span>
      </button>
      {state.ok ? null : <ContentMessage state={state} className="max-w-[16rem]" />}
    </form>
  );
}

/** Key questions are checked on every scan; standard ones can be checked less often. */
export function PrioritySwitch({
  action,
  id,
  priority,
  question,
}: {
  action: ContentAction;
  id: string;
  priority: "key" | "standard";
  question: string;
}) {
  const [state, formAction, pending] = useActionState<ContentFormState, FormData>(action, {});
  return (
    <form action={formAction} className="grid justify-items-start gap-1">
      <input type="hidden" name="id" value={id} />
      <div role="group" aria-label={`Priority: ${question}`} className="inline-flex rounded-md border border-rule-strong bg-sheet p-0.5">
        {(["key", "standard"] as const).map((value) => {
          const current = priority === value;
          return (
            <button
              key={value}
              type="submit"
              name="priority"
              value={value}
              aria-pressed={current}
              disabled={pending}
              className={cx(
                "h-6 rounded-sm px-2 text-sm transition-colors disabled:cursor-wait",
                current ? "bg-ink/10 font-medium text-ink" : "text-graphite hover:bg-wash hover:text-ink",
              )}
            >
              {value === "key" ? "Key" : "Standard"}
            </button>
          );
        })}
      </div>
      {state.ok ? null : <ContentMessage state={state} />}
    </form>
  );
}
