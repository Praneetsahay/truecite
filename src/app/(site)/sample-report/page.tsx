import type { Metadata } from "next";
import { ReportDocument } from "@/components/report/report-document";
import { ClosingCall, PageIntro, siteContainer } from "@/components/site-pages/site-page";
import { ButtonLink } from "@/components/ui/button";
import { SAMPLE_REPORT } from "@/lib/content/sample-report";

export const metadata: Metadata = {
  title: "Sample report",
  description:
    "An anonymized TrueCite monthly report: the Accuracy Score, the top risks with the exact AI answers, what was fixed, what comes next and how competitors compare.",
};

export default function SampleReportPage() {
  return (
    <>
      <PageIntro kicker="Sample report" title="What leadership receives every month">
        <p>
          A monthly report for an anonymized client. The company, people and web addresses are replaced; the structure and
          level of detail are exactly what clients get, as a web page and a PDF, at the start of each month. The one-time
          full audit follows the same structure, in more depth.
        </p>
      </PageIntro>

      <section aria-label="Sample monthly report" className="border-t border-rule">
        <div className={`${siteContainer} py-12 sm:py-16`}>
          <div className="rounded-md border border-rule bg-sheet px-5 py-10 sm:px-10 sm:py-14 lg:px-16">
            <ReportDocument data={SAMPLE_REPORT} />
          </div>
        </div>
      </section>

      <ClosingCall
        title="See what AI says about your company."
        actions={
          <>
            <ButtonLink href="/free-check" variant="primary">
              Request a free check
            </ButtonLink>
            <ButtonLink href="/pricing">See pricing</ButtonLink>
          </>
        }
      >
        <p>
          Start with a free mini-report: three to five real errors about your company, each with its sources and a fix.
          We review every finding by hand and send it within three working days.
        </p>
      </ClosingCall>
    </>
  );
}
