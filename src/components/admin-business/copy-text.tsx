"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { cx } from "@/lib/cx";

function useCopy(value: string, select: () => void) {
  const [copied, setCopied] = useState<"yes" | "select" | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied("yes");
    } catch {
      // Without clipboard access, select the text so the person can copy it themselves.
      select();
      setCopied("select");
    }
  }
  return { copied, copy };
}

function CopyStatus({ copied, what }: { copied: "yes" | "select" | null; what: string }) {
  return (
    <>
      <p role="status" className="sr-only">
        {copied === "yes" ? `${what} copied` : copied === "select" ? `${what} selected. Press Control and C to copy it.` : ""}
      </p>
      {copied === "select" ? <p className="text-sm text-graphite">The text is selected. Press Ctrl+C or Cmd+C to copy it.</p> : null}
    </>
  );
}

/** A read-only link with a Copy button. */
export function CopyLink({ id, label, value, hint }: { id: string; label: string; value: string; hint?: React.ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  const { copied, copy } = useCopy(value, () => input.current?.select());
  return (
    <div className="grid max-w-2xl gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div className="flex min-w-0 gap-2">
        <input
          ref={input}
          id={id}
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={cx(inputClass, "min-w-0 flex-1 truncate")}
        />
        <Button onClick={copy} className="shrink-0">
          {copied === "yes" ? "Copied" : "Copy"}
        </Button>
      </div>
      <CopyStatus copied={copied} what="Link" />
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-graphite">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A block of plain text, such as an email, set as a document with a Copy button. */
export function CopyBlock({ id, label, value }: { id: string; label: string; value: string }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const { copied, copy } = useCopy(value, () => area.current?.select());
  // Room for wrapped lines at the block's width, so the whole email shows without scrolling.
  const rows = Math.min(40, value.split("\n").reduce((total, line) => total + Math.max(1, Math.ceil(line.length / 64)), 1));
  return (
    <div className="grid max-w-2xl gap-2">
      <div className="flex items-end justify-between gap-4">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        <Button size="sm" onClick={copy}>
          {copied === "yes" ? "Copied" : "Copy email"}
        </Button>
      </div>
      <textarea
        ref={area}
        id={id}
        readOnly
        rows={rows}
        value={value}
        className="w-full resize-y rounded-md border border-rule-strong bg-sheet px-4 py-3 text-base leading-relaxed text-ink"
      />
      <CopyStatus copied={copied} what="Email" />
    </div>
  );
}
