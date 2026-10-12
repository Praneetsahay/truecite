import type { Metadata } from "next";
import { AutoPrint, PrintButton } from "@/components/account/print";
import { ReportDocument } from "@/components/report/report-document";
import { TextLink } from "@/components/ui/button";
import { getClientContext } from "@/lib/auth/dal";
import { getReportForClient } from "@/lib/queries/account";

/*
  The print view of a report: the document alone on white paper, no app shell.
  PDFs are rendered from this page, and it falls back to the browser's print
  dialog when no PDF renderer is available.
*/

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const ctx = await getClientContext();
  const report = await getReportForClient(ctx, id);
  // The title becomes the default file name when the page is saved as a PDF.
  return { title: { absolute: `${ctx.brand.name}, ${report.title}` }, robots: { index: false, follow: false } };
}

export default async function PrintReportPage({ params, searchParams }: Props) {
  const [{ id }, { print }] = await Promise.all([params, searchParams]);
  const ctx = await getClientContext();
  const report = await getReportForClient(ctx, id);

  return (
    <div className="min-h-dvh bg-sheet">
      <style>{"@page { size: A4; margin: 16mm 15mm 18mm; } @media print { html, body { background: #ffffff; } }"}</style>
      {print === "1" ? <AutoPrint /> : null}
      <div className="no-print border-b border-rule">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-sm text-graphite">
            Print view. Choose “Save as PDF” in the print dialog to keep a copy.{" "}
            <TextLink href={`/app/reports/${report.id}`} className="text-ink">
              Back to the report
            </TextLink>
          </p>
          <PrintButton className="shrink-0" />
        </div>
      </div>
      <main className="px-5 py-10 sm:px-6 sm:py-14 print:p-0">
        <ReportDocument data={report.data} />
      </main>
    </div>
  );
}

export const instant = false;
