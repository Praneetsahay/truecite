import { AnswerSheet, ProofAnswer } from "@/components/proof/proof-answer";
import { MarginNote } from "@/components/proof/margin-note";

const ANSWER =
  "Acme's Basic plan costs $49 per month and includes up to five admin users. The Growth plan adds phone support and Acme Insights, and Enterprise pricing is quoted on request.";
const WRONG = "$49 per month";
const WRONG_START = ANSWER.indexOf(WRONG);

/**
 * The landing page hero: a real-looking AI answer being corrected. The strike
 * through the wrong claim draws once as the page loads; it is the only
 * animation on the site and is skipped when reduced motion is preferred.
 */
export function HeroProof() {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-12">
      <div className="min-w-0">
        <p className="text-sm text-graphite">
          Question asked: <span className="text-ink">“How much does Acme cost?”</span>
        </p>
        <AnswerSheet
          className="mt-3"
          heading={
            <>
              <span className="font-medium text-ink">ChatGPT</span>
              <span className="text-graphite">Seen in 3 of 3 runs · 11 Oct 2026</span>
            </>
          }
          meta={
            <ol className="grid min-w-0 gap-1">
              <li className="flex min-w-0 gap-3">
                <span className="shrink-0">[1]</span>
                <span className="min-w-0 truncate">techbench.example/acme-payroll-review · review from 2023</span>
              </li>
              <li className="flex min-w-0 gap-3">
                <span className="shrink-0">[2]</span>
                <span className="min-w-0 truncate">acme.example/pricing-2024 · old pricing page, still live</span>
              </li>
            </ol>
          }
        >
          <ProofAnswer
            size="lg"
            text={ANSWER}
            marks={[{ start: WRONG_START, end: WRONG_START + WRONG.length, kind: "wrong", label: "Outdated", draw: true }]}
            footnotes={[
              { n: 1, href: "#how-it-works", label: "Source 1: a 2023 review" },
              { n: 2, href: "#how-it-works", label: "Source 2: an old pricing page" },
            ]}
          />
        </AnswerSheet>
      </div>
      <MarginNote
        className="lg:mt-[3.25rem]"
        verdictLabel="Outdated"
        detail={"price changed 1 Mar 2026"}
        correct="$79 per month"
        source={"From Acme's Fact Sheet, valid from 1 Mar 2026"}
      >
        <p className="text-sm text-graphite">Fix steps</p>
        <ol className="mt-1.5 grid list-decimal gap-1 pl-4 text-sm text-ink marker:text-graphite">
          <li>Redirect the old pricing page</li>
          <li>Ask the reviewer to update the 2023 article</li>
          <li>Add a pricing FAQ with the current price</li>
        </ol>
      </MarginNote>
    </div>
  );
}
