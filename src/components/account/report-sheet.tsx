import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/** A report shown as a document: a white sheet with a hairline edge on screen, plain paper in print. */
export function ReportSheet({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "rounded-md border border-rule bg-sheet px-5 py-8 sm:px-10 sm:py-12 lg:px-14 lg:py-14 print:rounded-none print:border-0 print:p-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
