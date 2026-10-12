import type { ReactNode } from "react";
import { displayUrl } from "@/lib/domain/format";
import { cx } from "@/lib/cx";

export type SourceItem = {
  n: number;
  url: string;
  title?: string | null;
  /** Short facts about the source: type, year, "Still live". */
  meta?: (string | null | undefined)[];
  /** True when TrueCite found the wrong statement on the page. */
  containsStatement?: boolean;
  /** Optional extra content, such as a likelihood label. */
  extra?: ReactNode;
};

/** Numbered sources that match the footnote numbers in the answer. */
export function SourceList({ items, className }: { items: SourceItem[]; className?: string }) {
  return (
    <ol className={cx("grid gap-5", className)}>
      {items.map((item) => {
        const meta = (item.meta ?? []).filter(Boolean) as string[];
        return (
          <li key={item.n} id={`source-${item.n}`} className="grid scroll-mt-24 grid-cols-[1.75rem_minmax(0,1fr)]">
            <span className="figures pt-px text-sm text-graphite">[{item.n}]</span>
            <div className="min-w-0">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="break-words text-ink underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink"
              >
                {displayUrl(item.url)}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              {item.title ? <p className="mt-0.5 text-sm text-graphite">{item.title}</p> : null}
              {meta.length > 0 ? <p className="mt-1 text-sm text-graphite">{meta.join(" · ")}</p> : null}
              {item.containsStatement ? (
                <p className="mt-1 flex items-center gap-2 text-sm text-ink">
                  <span aria-hidden="true" className="inline-block h-[2px] w-3 shrink-0 bg-correction" />
                  Contains the wrong statement
                </p>
              ) : null}
              {item.extra ? <div className="mt-1">{item.extra}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
