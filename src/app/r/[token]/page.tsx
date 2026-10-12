import type { Metadata } from "next";
import { PrintButton } from "@/components/account/print";
import { ReportSheet } from "@/components/account/report-sheet";
import { ReportDocument } from "@/components/report/report-document";
import { Wordmark } from "@/components/shell/wordmark";
import { requestNow } from "@/lib/auth/dal";
import { formatDate } from "@/lib/domain/format";
import { getSharedReport } from "@/lib/queries/account";

/*
  A report opened through its private share link. Anyone with the link can read
  it until the link expires; nobody needs an account. Never indexed.
*/

export const metadata: Metadata = {
  title: "Shared report",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="no-print border-b border-rule">
      <div className="mx-auto flex min-h-16 max-w-4xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3 sm:px-6">
        <Wordmark />
        {children}
      </div>
    </header>
  );
}

export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const now = await requestNow();
  const report = await getSharedReport(token, now);

  if (!report) {
    return (
      <>
        <Header />
        <main id="main" className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-24">
          <h1 className="text-2xl font-semibold tracking-[-0.012em] text-ink">This link has expired.</h1>
          <p className="mt-2 max-w-prose text-graphite">Ask the person who shared it for a new one.</p>
        </main>
      </>
    );
  }

  return (
    <>
      <Header>
        <p className="text-sm text-graphite">
          Shared report{report.shareExpiresAt ? ` · Link works until ${formatDate(report.shareExpiresAt)}` : ""}
        </p>
      </Header>
      <main id="main" className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12 print:p-0">
        <ReportSheet>
          <ReportDocument data={report.data} />
        </ReportSheet>
        <div className="no-print mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-prose text-sm text-graphite">
            This is a private link. Anyone who has it can read this report
            {report.shareExpiresAt ? ` until ${formatDate(report.shareExpiresAt)}` : ""}.
          </p>
          <PrintButton className="shrink-0" />
        </div>
      </main>
    </>
  );
}

export const instant = false;
