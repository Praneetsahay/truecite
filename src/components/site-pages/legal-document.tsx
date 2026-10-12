import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { COMPANY, LEGAL_LAST_UPDATED } from "@/lib/content/company";
import type { LegalBlock, LegalDocumentContent } from "@/lib/content/legal";
import { PageIntro, SiteSection } from "./site-page";

/*
  The shared layout for long policy pages: a contents list on the left on wide
  screens and the text on the right at a readable measure (about 68 characters),
  with numbered headings in the sans face.
*/

const LEGAL_PAGES = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/refunds", label: "Refund and Cancellation Policy" },
  { href: "/contact", label: "Contact" },
];

const linkClass = "text-ink underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink";

/** Turns the contact address inside policy text into a mail link. */
export function withEmailLinks(text: string): ReactNode {
  const parts = text.split(COMPANY.email);
  if (parts.length === 1) return text;
  return parts.map((part, index) => (
    <Fragment key={index}>
      {part}
      {index < parts.length - 1 ? (
        <a href={`mailto:${COMPANY.email}`} className={linkClass}>
          {COMPANY.email}
        </a>
      ) : null}
    </Fragment>
  ));
}

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === "string") return <p>{withEmailLinks(block)}</p>;
  return (
    <ul className="grid list-disc gap-2 pl-5 marker:text-graphite">
      {block.list.map((item) => (
        <li key={item} className="pl-1">
          {withEmailLinks(item)}
        </li>
      ))}
    </ul>
  );
}

export function LegalDocument({ content, path }: { content: LegalDocumentContent; path: string }) {
  return (
    <>
      <PageIntro kicker="Legal" title={content.title}>
        <p>{content.intro}</p>
        <p className="mt-4 text-sm text-graphite">Last updated {LEGAL_LAST_UPDATED}</p>
      </PageIntro>

      <SiteSection last className="grid gap-12 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16">
        <nav aria-label="On this page" className="lg:sticky lg:top-8 lg:self-start">
          <h2 className="border-b border-rule-strong pb-2 text-sm text-graphite">On this page</h2>
          <ol className="mt-1">
            {content.sections.map((section, index) => (
              <li key={section.id} className="border-b border-rule">
                <a
                  href={`#${section.id}`}
                  className="grid grid-cols-[1.75rem_minmax(0,1fr)] py-2 text-base text-ink hover:bg-wash"
                >
                  <span className="figures text-graphite">{index + 1}</span>
                  <span>{section.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0">
          <div className="grid max-w-[68ch] gap-12 text-lg leading-relaxed text-ink">
            {content.sections.map((section, index) => (
              <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-8">
                <h2 id={`${section.id}-title`} className="flex gap-3 text-xl font-semibold tracking-[-0.01em] text-ink">
                  <span className="font-normal text-graphite">{index + 1}.</span>
                  <span>{section.title}</span>
                </h2>
                <div className="mt-4 grid gap-4">
                  {section.blocks.map((block, blockIndex) => (
                    <Block key={blockIndex} block={block} />
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className="mt-16 max-w-[68ch] border-t border-rule-strong pt-6">
            <h2 className="text-sm text-graphite">Other policies</h2>
            <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
              {LEGAL_PAGES.filter((page) => page.href !== path).map((page) => (
                <li key={page.href}>
                  <Link href={page.href} className={linkClass}>
                    {page.label}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm text-graphite">
              This page is written in plain language. If anything is unclear, email{" "}
              <a href={`mailto:${COMPANY.email}`} className={linkClass}>
                {COMPANY.email}
              </a>
              .
            </p>
          </div>
        </div>
      </SiteSection>
    </>
  );
}
