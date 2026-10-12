import type { ComponentProps, ReactNode } from "react";
import { cx } from "@/lib/cx";

/*
  Plain tables: hairline rows, left-aligned text, right-aligned numbers with
  tabular figures. No zebra stripes, no cards.
*/

export function Table({ children, className, caption }: { children: ReactNode; className?: string; caption?: string }) {
  return (
    <div className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className={cx("w-full border-collapse text-left text-md", className)}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-rule-strong">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cx("border-b border-rule last:border-b-0", className)} {...props} />;
}

export function TH({
  numeric,
  className,
  ...props
}: ComponentProps<"th"> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cx(
        "py-2 pr-6 align-bottom text-sm font-normal whitespace-nowrap text-graphite last:pr-0",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  );
}

export function TD({
  numeric,
  className,
  ...props
}: ComponentProps<"td"> & { numeric?: boolean }) {
  return (
    <td
      className={cx("py-3 pr-6 align-top last:pr-0", numeric && "figures text-right whitespace-nowrap", className)}
      {...props}
    />
  );
}

/** A row header cell, for the first column when it names the row. */
export function RowHead({ className, ...props }: ComponentProps<"th">) {
  return <th scope="row" className={cx("py-3 pr-6 text-left align-top font-normal", className)} {...props} />;
}
