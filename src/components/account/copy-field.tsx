"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { cx } from "@/lib/cx";

/** A read-only value, such as a share link, with a Copy button. */
export function CopyField({ id, label, value, hint }: { id: string; label: string; value: string; hint?: React.ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
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
      input.current?.select();
      setCopied("select");
    }
  }

  return (
    <div className="grid gap-1.5">
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
      <p role="status" className="sr-only">
        {copied === "yes" ? "Link copied" : copied === "select" ? "Link selected. Press Control and C to copy it." : ""}
      </p>
      {copied === "select" ? (
        <p className="text-sm text-graphite">The link is selected. Press Ctrl+C or Cmd+C to copy it.</p>
      ) : null}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-graphite">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
