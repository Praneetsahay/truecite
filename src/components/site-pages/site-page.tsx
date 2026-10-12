import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/*
  Building blocks for the public pages beyond the landing page. They repeat the
  landing page's measurements: the same container, hairline sections and type
  sizes, so every public page reads as part of one site.
*/

export const siteContainer = "mx-auto max-w-6xl px-4 sm:px-6 lg:px-8";

/** The opening of a public page: a one-line context, the title and what the page is for. */
export function PageIntro({
  kicker,
  title,
  children,
  aside,
}: {
  kicker: string;
  title: string;
  children?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className={cx(siteContainer, "pt-14 pb-14 sm:pt-20 sm:pb-16")}>
      <div className="max-w-3xl">
        <p className="text-base text-graphite">{kicker}</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-ink sm:text-4xl">{title}</h1>
        {children ? <div className="mt-5 max-w-2xl text-lg leading-relaxed text-graphite">{children}</div> : null}
      </div>
      {aside ? <div className="mt-8">{aside}</div> : null}
    </section>
  );
}

/** A full-width band separated from the one above by a single hairline. */
export function SiteSection({
  children,
  id,
  split,
  last,
  className,
  labelledBy,
}: {
  children: ReactNode;
  id?: string;
  /** Heading on the left, content on the right on wide screens, as on the landing page. */
  split?: boolean;
  /** The last section on a page: the footer adds the space below it. */
  last?: boolean;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className="scroll-mt-8 border-t border-rule">
      <div
        className={cx(
          siteContainer,
          last ? "pt-20 lg:pt-24" : "py-20 lg:py-24",
          split && "grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16",
          className,
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function SectionHeading({ title, id, children }: { title: string; id?: string; children?: ReactNode }) {
  return (
    <div className="max-w-2xl">
      <h2 id={id} className="text-3xl font-semibold tracking-[-0.02em] text-ink">
        {title}
      </h2>
      {children ? <div className="mt-4 grid gap-4 text-lg leading-relaxed text-graphite">{children}</div> : null}
    </div>
  );
}

/** The closing invitation at the end of a public page. */
export function ClosingCall({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <SiteSection last>
      <div className="max-w-2xl">
        <h2 className="text-3xl font-semibold tracking-[-0.02em] text-ink sm:text-4xl">{title}</h2>
        <div className="mt-4 text-lg leading-relaxed text-graphite">{children}</div>
        <div className="mt-8 flex flex-wrap items-center gap-3">{actions}</div>
      </div>
    </SiteSection>
  );
}
