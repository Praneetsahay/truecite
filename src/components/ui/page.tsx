import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/*
  Page structure: a header with the title and the page's actions, then
  sections separated by whitespace and a single hairline.
*/

export type Crumb = { label: string; href?: string };

export function PageHeader({
  title,
  description,
  actions,
  crumbs,
  aside,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  crumbs?: Crumb[];
  /** Small context shown to the right of the title on wide screens, such as a severity. */
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("pb-6", className)}>
      {crumbs && crumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="mb-3 text-sm text-graphite">
          <ol className="flex flex-wrap items-center gap-1.5">
            {crumbs.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
                {index > 0 ? <span aria-hidden="true">/</span> : null}
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-ink hover:underline hover:underline-offset-[3px]">
                    {crumb.label}
                  </Link>
                ) : (
                  <span aria-current="page">{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-[-0.012em] text-ink">{title}</h1>
          {description ? <div className="mt-1.5 max-w-2xl text-graphite">{description}</div> : null}
        </div>
        {actions || aside ? (
          <div className="flex shrink-0 flex-wrap items-center gap-3 sm:justify-end">
            {aside}
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  id,
  className,
  rule = true,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
  /** Draw the hairline above the section title. */
  rule?: boolean;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={title ? headingId : undefined} className={cx("mt-10 first:mt-0", className)}>
      {title ? (
        <div className={cx("mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2", rule && "border-t border-rule pt-5")}>
          <div className="min-w-0">
            <h2 id={headingId} className="text-base font-semibold text-ink">
              {title}
            </h2>
            {description ? <div className="mt-0.5 max-w-2xl text-sm text-graphite">{description}</div> : null}
          </div>
          {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Empty screens invite action and say what happens next. */
export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("border-t border-rule py-10", className)}>
      <p className="font-medium text-ink">{title}</p>
      {children ? <div className="mt-1 max-w-prose text-graphite">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/**
 * A short message after an action, or a notice that applies to the whole page.
 * "progress" for something under way, "done" for completed work, "attention"
 * for something that needs review.
 */
export function Notice({
  tone = "progress",
  title,
  children,
  action,
  className,
}: {
  tone?: "progress" | "done" | "attention";
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cx(
        "flex flex-col gap-3 border-l-2 bg-sheet px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        tone === "progress" && "border-ink",
        tone === "done" && "border-ink",
        tone === "attention" && "border-highlighter",
        className,
      )}
    >
      <div className="min-w-0">
        {title ? <p className="font-medium text-ink">{title}</p> : null}
        {children ? <div className={cx("text-graphite", title ? "mt-0.5 text-sm" : "text-base")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Label and value pairs, for metadata such as dates, owners and settings. */
export function Details({
  items,
  className,
  columns = 1,
}: {
  items: { label: ReactNode; value: ReactNode }[];
  className?: string;
  columns?: 1 | 2 | 3;
}) {
  return (
    <dl
      className={cx(
        "grid gap-x-8 gap-y-3",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-3",
        className,
      )}
    >
      {items.map((item, index) => (
        <div key={index} className="min-w-0">
          <dt className="text-sm text-graphite">{item.label}</dt>
          <dd className="mt-0.5 text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Small secondary text. */
export function Meta({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("text-sm text-graphite", className)}>{children}</span>;
}

/** A row of link-based filters. The current one is marked for sighted and screen reader users. */
export function FilterLinks({
  label,
  items,
  className,
}: {
  label: string;
  items: { label: string; href: string; active: boolean; count?: number }[];
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cx("-mx-1 overflow-x-auto", className)}>
      <ul className="flex flex-wrap items-center gap-x-1 border-b border-rule">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className={cx(
                "-mb-px inline-flex items-center gap-1.5 border-b-2 px-1 pt-1 pb-2.5 text-base transition-colors mx-1",
                item.active ? "border-ink font-medium text-ink" : "border-transparent text-graphite hover:text-ink",
              )}
            >
              {item.label}
              {item.count !== undefined ? <span className="figures text-sm text-graphite">{item.count}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
