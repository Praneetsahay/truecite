import type { Metadata } from "next";
import Link from "next/link";
import { HeroProof } from "@/components/site/hero-proof";
import { ButtonLink } from "@/components/ui/button";
import { StatusMark } from "@/components/ui/marks";
import { PRICES } from "@/lib/domain/constants";
import { formatMoney } from "@/lib/domain/format";

export const metadata: Metadata = {
  title: { absolute: "TrueCite: know what AI tells your customers about you" },
  description:
    "Media monitoring for the AI era. TrueCite shows PR, brand and legal teams what AI assistants say about their company, what is wrong, where it came from and how to fix it.",
};

const container = "mx-auto max-w-6xl px-4 sm:px-6 lg:px-8";

const ERRORS = [
  { kind: "Old prices", example: "“The Basic plan costs $49 a month.” The price changed in March." },
  { kind: "Retired products", example: "“Acme Expense is available as an add-on.” It was retired last year." },
  { kind: "Former leaders", example: "“Rahul Mehta is the CEO.” He stepped down in 2024." },
  {
    kind: "Another company's news",
    example: "“Acme had a data breach in 2024.” The breach happened at a different firm with a similar name.",
  },
  { kind: "Old rumors as fact", example: "“Acme faced a wage lawsuit.” The lawsuit was against a construction company." },
];

const JOBS = [
  {
    n: "1",
    name: "Find",
    what: "Asks AI assistants hundreds of real customer questions on a schedule, and checks every answer against your approved facts.",
    value: "You finally know what AI tells your customers.",
  },
  {
    n: "2",
    name: "Explain",
    what: "Traces each wrong answer to its most likely sources: an outdated article, an old page on your own site, a forum thread.",
    value: "You understand why the error exists.",
  },
  {
    n: "3",
    name: "Fix",
    what: "Gives step-by-step guidance for each type of error from a built-in Fix Playbook. Your team carries out the fix.",
    value: "Your team knows exactly what to do next.",
  },
  {
    n: "4",
    name: "Track",
    what: "Re-checks fixed issues on every scan and shows progress per AI platform over time.",
    value: "You can show leadership what changed.",
  },
];

const TRAIL = [
  { when: "12 Aug, 09:14", who: "TrueCite", what: "Detected. Seen in 3 of 3 runs on ChatGPT and 2 of 3 on Perplexity.", status: "open" as const },
  { when: "12 Aug, 16:40", who: "TrueCite review", what: "Approved. The answer contradicts the current pricing page.", status: "open" as const },
  { when: "14 Aug, 11:02", who: "Karan Shah", what: "Started work. Asked TechBench to update its 2023 review.", status: "in_progress" as const },
  { when: "9 Oct, 18:25", who: "Karan Shah", what: "Marked as fixed. The old pricing page now redirects to /pricing.", status: "fixed_rechecking" as const },
  { when: "11 Oct, 06:00", who: "TrueCite", what: "Re-checked. Perplexity now answers correctly. ChatGPT still says $49 in 2 of 3 runs.", status: "fixed_rechecking" as const },
];

const BUYERS = [
  {
    who: "Head of PR or Corporate Communications",
    cares: "Reputation, misinformation, crisis prevention",
    helps: "Alerts for new errors, fix plans and a monthly report for leadership",
  },
  {
    who: "Brand or Marketing Head",
    cares: "Correct product and pricing information, standing against competitors",
    helps: "Accuracy by product and category, and a comparison with competitors",
  },
  {
    who: "Legal and Compliance",
    cares: "False claims, regulatory exposure, evidence",
    helps: "Instant alerts for critical issues and a dated record of every AI answer",
  },
];

function SectionHeading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="max-w-2xl">
      <h2 className="text-3xl font-semibold tracking-[-0.02em] text-ink">{title}</h2>
      {children ? <div className="mt-4 text-lg leading-relaxed text-graphite">{children}</div> : null}
    </div>
  );
}

export default function LandingPage() {
  return (
    <>
      <section className={`${container} pt-14 pb-20 sm:pt-20 lg:pb-24`}>
        <div className="max-w-3xl">
          <p className="text-base text-graphite">AI reputation monitoring for PR, brand and legal teams</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.03em] text-ink sm:text-5xl sm:leading-[1.06]">
            Know what AI tells your customers about you, and fix what it gets wrong.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-graphite">
            TrueCite asks ChatGPT, Gemini, Perplexity and Claude the questions your customers ask, checks every answer
            against your approved facts, and shows what is wrong, where it came from and how to fix it.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <ButtonLink href="/free-check" variant="primary">
              Request a free check
            </ButtonLink>
            <ButtonLink href="/sample-report">See a sample report</ButtonLink>
          </div>
        </div>
        <div className="mt-16 sm:mt-20">
          <HeroProof />
        </div>
      </section>

      <section className="border-t border-rule">
        <div className={`${container} grid gap-12 py-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16 lg:py-24`}>
          <SectionHeading title="AI gives one confident answer. Often, it is wrong.">
            <p>
              People ask AI assistants about a company before they buy, apply for a job or sign a contract. Unlike a page of
              search results, they get a single answer, so they believe it.
            </p>
            <p className="mt-4">
              Most companies never see these answers. In banking, insurance and healthcare, a false claim about fees,
              safety or compliance can also become a legal problem.
            </p>
          </SectionHeading>
          <dl className="border-t border-rule">
            {ERRORS.map((error) => (
              <div key={error.kind} className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
                <dt className="font-medium text-ink">{error.kind}</dt>
                <dd className="font-serif text-lg leading-snug text-ink [font-optical-sizing:auto]">{error.example}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-8 border-t border-rule">
        <div className={`${container} py-20 lg:py-24`}>
          <SectionHeading title="How TrueCite works">
            <p>Four jobs, in this order. TrueCite is a product, not an agency: your team makes the fixes, with exact guidance.</p>
          </SectionHeading>
          <ol className="mt-12 border-t border-rule-strong">
            {JOBS.map((job) => (
              <li
                key={job.name}
                className="grid gap-2 border-b border-rule py-6 md:grid-cols-[3rem_9rem_minmax(0,1.4fr)_minmax(0,1fr)] md:gap-8"
              >
                <span className="figures text-graphite">{job.n}</span>
                <span className="text-xl font-semibold tracking-[-0.01em] text-ink">{job.name}</span>
                <p className="text-ink">{job.what}</p>
                <p className="text-graphite">{job.value}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-rule">
        <div className={`${container} grid gap-12 py-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16 lg:py-24`}>
          <SectionHeading title="A dated record of what AI said, and what you did about it">
            <p>
              Every issue keeps its full history: the exact answer, when it was seen, who changed what and when. Legal and
              compliance teams use it as evidence.
            </p>
          </SectionHeading>
          <div>
            <p className="text-sm text-graphite">Wrong price for Basic plan · Acme</p>
            <ol className="mt-3 border-t border-rule">
              {TRAIL.map((entry) => (
                <li key={entry.when} className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-6">
                  <span className="text-sm text-graphite">{entry.when}</span>
                  <div>
                    <p className="text-ink">{entry.what}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-graphite">
                      <span>{entry.who}</span>
                      <span aria-hidden="true">·</span>
                      <StatusMark status={entry.status} />
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-sm text-graphite">
              The issue moves to Resolved once answers are correct and consistent for two scans in a row. If the error
              comes back, it is reopened.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-rule">
        <div className={`${container} py-20 lg:py-24`}>
          <SectionHeading title="Built for the people who own your reputation">
            <p>
              For companies of about 200 people and up with a PR, brand, marketing or legal team, in industries where wrong
              information is costly: banking and fintech, insurance, healthcare, edtech, real estate, travel, software and
              consumer brands.
            </p>
          </SectionHeading>
          <div className="-mx-4 mt-12 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[40rem] border-collapse text-left">
              <caption className="sr-only">Who TrueCite is for</caption>
              <thead className="border-b border-rule-strong">
                <tr>
                  <th scope="col" className="w-1/3 py-2 pr-8 text-sm font-normal text-graphite">
                    Buyer
                  </th>
                  <th scope="col" className="w-1/3 py-2 pr-8 text-sm font-normal text-graphite">
                    What they care about
                  </th>
                  <th scope="col" className="py-2 text-sm font-normal text-graphite">
                    How TrueCite helps
                  </th>
                </tr>
              </thead>
              <tbody>
                {BUYERS.map((buyer) => (
                  <tr key={buyer.who} className="border-b border-rule">
                    <th scope="row" className="py-4 pr-8 align-top font-medium text-ink">
                      {buyer.who}
                    </th>
                    <td className="py-4 pr-8 align-top text-graphite">{buyer.cares}</td>
                    <td className="py-4 align-top text-ink">{buyer.helps}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="border-t border-rule">
        <div className={`${container} grid gap-12 py-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16 lg:py-24`}>
          <SectionHeading title="Nothing to install, nothing to connect">
            <p>
              TrueCite needs no access to your systems. Everything it uses is public, so there is very little for your
              security team to review.
            </p>
          </SectionHeading>
          <div className="grid gap-10 sm:grid-cols-2">
            <div>
              <h3 className="border-b border-rule-strong pb-2 text-sm text-graphite">What TrueCite uses</h3>
              <ul className="mt-1">
                {["Answers from AI assistants", "Your public website", "Public web pages that AI cites"].map((item) => (
                  <li key={item} className="border-b border-rule py-3 text-ink">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="border-b border-rule-strong pb-2 text-sm text-graphite">What TrueCite never needs</h3>
              <ul className="mt-1">
                {["Your systems or website backend", "Analytics, CRM or email", "Customer data of any kind"].map((item) => (
                  <li key={item} className="border-b border-rule py-3 text-ink">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-rule">
        <div className={`${container} grid gap-12 py-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16 lg:py-24`}>
          <SectionHeading title="Start with a free check">
            <p>
              AI answers change as models update and new pages are published, so one check is never enough. Most clients
              start small and move to monitoring.
            </p>
          </SectionHeading>
          <div>
            <dl className="border-t border-rule-strong">
              <div className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6">
                <dt className="text-ink">
                  <span className="font-medium">Mini-report.</span> Three to five real errors, with sources and fixes.
                </dt>
                <dd className="text-ink">Free</dd>
              </div>
              <div className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6">
                <dt className="text-ink">
                  <span className="font-medium">Full audit.</span> One deep scan across four AI assistants, credited toward a
                  subscription.
                </dt>
                <dd className="figures text-ink">{formatMoney(PRICES.USD.audit, "USD")}</dd>
              </div>
              <div className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6">
                <dt className="text-ink">
                  <span className="font-medium">Monitoring.</span> Scans every week or two, alerts, fixes tracked, monthly
                  reports.
                </dt>
                <dd className="figures text-ink">From {formatMoney(PRICES.USD.starter, "USD")} a month</dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-graphite">
              Prices in Indian rupees are on the{" "}
              <Link href="/pricing" className="text-ink underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink">
                pricing page
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-rule">
        <div className={`${container} pt-20 lg:pt-28`}>
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-[-0.02em] text-ink sm:text-4xl">See what AI says about your company.</h2>
            <p className="mt-4 text-lg leading-relaxed text-graphite">
              Tell us your company and website. We run the check, review every finding by hand and send you a short report
              within three working days.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <ButtonLink href="/free-check" variant="primary">
                Request a free check
              </ButtonLink>
              <ButtonLink href="/sample-report">See a sample report</ButtonLink>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
