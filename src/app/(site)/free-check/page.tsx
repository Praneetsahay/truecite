import type { Metadata } from "next";
import Link from "next/link";
import { PageIntro, siteContainer } from "@/components/site-pages/site-page";
import { PROSPECT_LINK_DAYS } from "@/lib/domain/constants";
import { FreeCheckForm } from "./free-check-form";

export const metadata: Metadata = {
  title: "Request a free check",
  description:
    "Find out what ChatGPT, Gemini, Perplexity and Claude say about your company. A free mini-report with three to five real errors, their sources and how to fix them.",
};

const CONTENTS = [
  { what: "Three to five real errors", detail: "The exact AI answers, with the wrong statement marked." },
  { what: "The correct fact", detail: "Checked against your public website and other reliable public pages." },
  { what: "Where each error comes from", detail: "The pages the AI cited, or a note that it answers from memory." },
  { what: "How to fix it", detail: "The first steps for each error, from the TrueCite Fix Playbook." },
];

const STEPS = [
  "We read your request, then ask two AI assistants 20 to 30 questions your customers ask about you.",
  "A person reviews every finding against your public pages before anything is sent.",
  `You get the mini-report by email, as a PDF and a private link that works for ${PROSPECT_LINK_DAYS} days.`,
];

const linkClass = "text-ink underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink";

export default function FreeCheckPage() {
  return (
    <>
      <PageIntro kicker="Free check" title="See what AI says about your company">
        <p>
          Tell us your company and website. We ask AI assistants the questions your customers ask, check the answers and
          send you a short mini-report. It is free, and there is nothing to install or connect.
        </p>
      </PageIntro>

      <section aria-label="Request form" className="border-t border-rule">
        <div className={`${siteContainer} grid gap-16 pt-14 sm:pt-16 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-20`}>
          <div className="max-w-2xl">
            <FreeCheckForm />
          </div>

          <aside className="grid content-start gap-12">
            <div>
              <h2 className="border-b border-rule-strong pb-2 text-sm text-graphite">What the mini-report contains</h2>
              <dl>
                {CONTENTS.map((item) => (
                  <div key={item.what} className="border-b border-rule py-3">
                    <dt className="font-medium text-ink">{item.what}</dt>
                    <dd className="mt-0.5 text-graphite">{item.detail}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div>
              <h2 className="border-b border-rule-strong pb-2 text-sm text-graphite">What happens next</h2>
              <ol>
                {STEPS.map((step, index) => (
                  <li key={step} className="grid grid-cols-[1.5rem_minmax(0,1fr)] border-b border-rule py-3">
                    <span className="figures text-graphite">{index + 1}</span>
                    <span className="text-ink">{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div>
              <h2 className="border-b border-rule-strong pb-2 text-sm text-graphite">What we need from your systems</h2>
              <p className="py-3 text-ink">
                Nothing. The check uses only AI answers, your public website and public pages that AI cites. We never ask
                for logins, analytics, CRM or customer data.
              </p>
              <p className="text-sm text-graphite">
                Want to see the full format first? Read the{" "}
                <Link href="/sample-report" className={linkClass}>
                  sample report
                </Link>
                .
              </p>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}
