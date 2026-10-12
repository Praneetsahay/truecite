import Link from "next/link";
import { Fragment } from "react";
import { cx } from "@/lib/cx";

/*
  The proof view, borrowed from the way editors mark corrections on a draft.
  A wrong statement inside an AI answer is struck through in correction red,
  the correct fact sits in the margin, and footnote numbers link to sources.
*/

export type AnswerMark = {
  /** Character offsets into the answer text. */
  start: number;
  end: number;
  /**
   * wrong: the statement this view is about, struck through.
   * other-wrong: another wrong statement in the same answer, underlined and linked.
   * review: needs review or appears only sometimes, on the highlighter.
   * correct: a verified statement, underlined in green (used in statement breakdowns).
   */
  kind: "wrong" | "other-wrong" | "review" | "correct";
  /** Verdict word for screen readers, such as "Incorrect" or "Outdated". */
  label?: string;
  /** Draw the strike-through once on load. Only the landing page does this. */
  draw?: boolean;
  /** For other-wrong marks: link to that issue. */
  href?: string;
};

export type Footnote = { n: number; href: string; label?: string };

type Segment = { text: string; mark?: AnswerMark };

function segment(text: string, marks: AnswerMark[]): Segment[] {
  const sorted = [...marks]
    .filter((m) => m.start >= 0 && m.end > m.start && m.end <= text.length)
    .sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const mark of sorted) {
    if (mark.start < cursor) continue; // overlapping marks: keep the first
    if (mark.start > cursor) segments.push({ text: text.slice(cursor, mark.start) });
    segments.push({ text: text.slice(mark.start, mark.end), mark });
    cursor = mark.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

function MarkedText({ segment: { text, mark } }: { segment: Segment }) {
  if (!mark) return <>{text}</>;
  switch (mark.kind) {
    case "wrong":
      return (
        <>
          <span className="sr-only">{mark.label ?? "Incorrect"} statement: </span>
          <del className={cx("strike text-ink/85", mark.draw && "strike-draw")}>{text}</del>
          <span className="sr-only"> (end of {(mark.label ?? "incorrect").toLowerCase()} statement)</span>
        </>
      );
    case "other-wrong": {
      const inner = (
        <span className="underline decoration-correction/70 decoration-dotted decoration-[1.5px] underline-offset-4">{text}</span>
      );
      return mark.href ? (
        <Link href={mark.href} title={`${mark.label ?? "Incorrect"}: open this issue`}>
          {inner}
          <span className="sr-only"> ({mark.label ?? "Incorrect"}, see issue)</span>
        </Link>
      ) : (
        inner
      );
    }
    case "review":
      return (
        <mark className="highlight text-ink">
          {text}
          <span className="sr-only"> ({mark.label ?? "needs review"})</span>
        </mark>
      );
    case "correct":
      return (
        <span className="underline decoration-verified/80 decoration-[1.5px] underline-offset-4">
          {text}
          <span className="sr-only"> (correct)</span>
        </span>
      );
  }
}

/** An AI answer set in Newsreader, with corrections marked. */
export function ProofAnswer({
  text,
  marks = [],
  footnotes = [],
  size = "md",
  className,
}: {
  text: string;
  marks?: AnswerMark[];
  footnotes?: Footnote[];
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const segments = segment(text, marks);
  return (
    <blockquote
      className={cx(
        "font-serif whitespace-pre-line text-ink [font-optical-sizing:auto]",
        size === "sm" && "text-base leading-relaxed",
        size === "md" && "text-lg leading-[1.7]",
        size === "lg" && "text-xl leading-[1.65] sm:text-[1.375rem]",
        className,
      )}
    >
      {segments.map((s, i) => (
        <MarkedText key={i} segment={s} />
      ))}
      {footnotes.length > 0 ? (
        <span className="whitespace-nowrap">
          {footnotes.map((f) => (
            <Fragment key={f.n}>
              {" "}
              <sup className="font-sans text-[0.68em] leading-none">
                <a
                  href={f.href}
                  className="figures text-graphite no-underline hover:text-ink"
                  aria-label={f.label ?? `Source ${f.n}`}
                >
                  [{f.n}]
                </a>
              </sup>
            </Fragment>
          ))}
        </span>
      ) : null}
    </blockquote>
  );
}

/** The white sheet an answer sits on, with where and when it was said. */
export function AnswerSheet({
  heading,
  meta,
  children,
  className,
}: {
  heading?: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <figure className={cx("rounded-md border border-rule bg-sheet", className)}>
      {heading ? (
        <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule px-5 py-3 text-sm sm:px-6">
          {heading}
        </figcaption>
      ) : null}
      <div className="px-5 py-5 sm:px-6 sm:py-6">{children}</div>
      {meta ? <div className="border-t border-rule px-5 py-3 text-sm text-graphite sm:px-6">{meta}</div> : null}
    </figure>
  );
}
