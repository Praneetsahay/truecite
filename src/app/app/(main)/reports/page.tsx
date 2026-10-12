import type { Metadata } from "next";
import { TextLink } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireClient } from "@/lib/auth/dal";
import { REPORT_TYPES } from "@/lib/domain/constants";
import { formatDate } from "@/lib/domain/format";
import { lastMonthPeriod, listReports, shareStatus, type ShareStatus } from "@/lib/queries/account";
import { CreateReportButton } from "./create-report-button";

export const metadata: Metadata = { title: "Reports" };

function ShareCell({ status }: { status: ShareStatus }) {
  if (status.state === "active") {
    return <span className="text-ink">{status.expiresAt ? `Shared until ${formatDate(status.expiresAt)}` : "Shared"}</span>;
  }
  if (status.state === "expired") return <span className="text-graphite">Expired {formatDate(status.expiresAt)}</span>;
  return <span className="text-graphite">Not shared</span>;
}

function nextMonthStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export default async function ReportsPage() {
  const ctx = await requireClient();
  const list = await listReports(ctx);
  const month = lastMonthPeriod(ctx.now);
  const hasLastMonth = list.some((report) => report.type === "monthly" && report.period === month.period);
  const canCreate = ctx.canEdit && !hasLastMonth;

  return (
    <>
      <PageHeader
        title="Reports"
        description="The Accuracy Score, top risks, fixes and next steps in one document for leadership. Open one to download it as a PDF or share a private link."
        actions={
          list.length > 0 && canCreate ? (
            <CreateReportButton hint={`Covers ${month.label}.`} />
          ) : list.length > 0 && ctx.canEdit ? (
            <p className="max-w-64 text-sm text-graphite">
              The report for {month.label} is ready. The next one can be created from {formatDate(nextMonthStart(ctx.now))}.
            </p>
          ) : null
        }
      />

      {list.length === 0 ? (
        <EmptyState
          title="No reports yet."
          action={canCreate ? <CreateReportButton className="sm:justify-items-start" hint={`Covers ${month.label}.`} /> : null}
        >
          {ctx.canEdit
            ? "Create last month's report to give leadership the Accuracy Score, the top open risks and what was fixed, in one document."
            : "Reports appear here when a member or owner creates one. You can read, download and print every report."}
        </EmptyState>
      ) : (
        <Table className="relative" caption="Reports, newest first">
          <THead>
            <TR>
              <TH>Report</TH>
              <TH className="hidden sm:table-cell">Type</TH>
              <TH className="hidden md:table-cell">Period</TH>
              <TH>Created</TH>
              <TH>Share link</TH>
            </TR>
          </THead>
          <TBody>
            {list.map((report) => (
              <TR key={report.id}>
                <RowHead className="min-w-48">
                  <TextLink href={`/app/reports/${report.id}`} className="font-medium text-ink">
                    {report.title}
                  </TextLink>
                </RowHead>
                <TD className="hidden whitespace-nowrap text-graphite sm:table-cell">{REPORT_TYPES[report.type].label}</TD>
                <TD className="hidden whitespace-nowrap text-graphite md:table-cell">{report.periodLabel}</TD>
                <TD className="whitespace-nowrap text-graphite">{formatDate(report.createdAt)}</TD>
                <TD className="whitespace-nowrap">
                  <ShareCell status={shareStatus(report, ctx.now)} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}

export const instant = false;
