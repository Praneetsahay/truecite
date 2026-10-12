import type { Metadata } from "next";
import Link from "next/link";
import { AnswerSourceLabel, ScanProgress, ScanStatusLabel } from "@/components/admin-ops/marks";
import { ScansTable } from "@/components/admin-ops/scans-table";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { PlatformList } from "@/components/ui/marks";
import { EmptyState, FilterLinks, PageHeader, Section } from "@/components/ui/page";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { SCAN_TYPES } from "@/lib/domain/constants";
import { formatDateTime, formatNumber, formatRelative, plural } from "@/lib/domain/format";
import { getScansOverview } from "@/lib/queries/admin-ops";

export const instant = false;

export const metadata: Metadata = { title: "Scans and jobs" };

const linkClass = "underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink";

export default async function ScansPage({ searchParams }: PageProps<"/admin/scans">) {
  const ctx = await requireAdmin();
  const { show } = await searchParams;
  const filter = show === "failed" ? "failed" : "all";
  const { running, recent, counts, nextScheduled } = await getScansOverview(filter);
  const stoppedTotal = filter === "failed" ? counts.failed : counts.all;

  return (
    <>
      <PageHeader
        title="Scans and jobs"
        description="Every scan across clients, with failed jobs and retries. Running scans come first."
      />

      {running.length > 0 ? <AutoRefresh seconds={10} /> : null}
      <Section
        rule={false}
        title="Running now"
        description={
          running.length > 0
            ? `${plural(running.length, "scan")} asking AI assistants or checking answers.`
            : undefined
        }
      >
        {running.length === 0 ? (
          <EmptyState title="No scans are running.">
            Scheduled scans start on their own.
            {nextScheduled
              ? ` The next one is for ${nextScheduled.organizationName}, ${formatRelative(nextScheduled.at, ctx.now)} (${formatDateTime(nextScheduled.at)}).`
              : " None is scheduled right now."}
          </EmptyState>
        ) : (
          <Table caption="Scans running now">
            <THead>
              <tr>
                <TH>Client</TH>
                <TH>Status</TH>
                <TH>Progress</TH>
                <TH>Platforms</TH>
                <TH numeric>Failed jobs</TH>
                <TH>Started</TH>
                <TH>Answers</TH>
              </tr>
            </THead>
            <TBody>
              {running.map((scan) => (
                <TR key={scan.id}>
                  <RowHead className="min-w-36">
                    <Link href={`/admin/scans/${scan.id}`} className={`font-medium text-ink ${linkClass}`}>
                      {scan.internal ? scan.brandName : scan.organizationName}
                    </Link>
                    <span className="mt-0.5 block text-sm text-graphite">{SCAN_TYPES[scan.type].label}</span>
                  </RowHead>
                  <TD>
                    <ScanStatusLabel status={scan.status} />
                  </TD>
                  <TD className="min-w-44">
                    <ScanProgress done={scan.jobsDone} total={scan.jobsTotal} />
                  </TD>
                  <TD className="min-w-40">
                    <PlatformList platforms={scan.platforms} />
                  </TD>
                  <TD numeric>
                    {scan.failedJobs > 0 ? (
                      <span className="font-medium text-ink">{formatNumber(scan.failedJobs)}</span>
                    ) : (
                      <span className="text-graphite">0</span>
                    )}
                  </TD>
                  <TD className="whitespace-nowrap">
                    {scan.startedAt ? (
                      <span title={formatDateTime(scan.startedAt)}>{formatRelative(scan.startedAt, ctx.now)}</span>
                    ) : (
                      <span className="text-graphite">Waiting to start</span>
                    )}
                  </TD>
                  <TD>
                    <AnswerSourceLabel simulated={scan.simulated} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      <Section
        title="Recent scans"
        description={
          stoppedTotal > recent.length
            ? `The latest ${recent.length} of ${formatNumber(stoppedTotal)} scans that have stopped, newest first.`
            : "Scans that have stopped, newest first."
        }
      >
        <FilterLinks
          label="Show"
          className="mb-2"
          items={[
            { label: "All", href: "/admin/scans", active: filter === "all", count: counts.all },
            { label: "With failed jobs", href: "/admin/scans?show=failed", active: filter === "failed", count: counts.failed },
          ]}
        />
        {recent.length === 0 ? (
          <EmptyState title={filter === "failed" ? "No scan has failed jobs." : "No scans have finished yet."} className="border-t-0">
            {filter === "failed"
              ? "Every job in the recent scans got an answer. Jobs that fail are retried on their own a few times before they show up here."
              : "Scans appear here once they finish, fail or are cancelled."}
          </EmptyState>
        ) : (
          <ScansTable scans={recent} now={ctx.now} caption="Recent scans across clients" />
        )}
      </Section>
    </>
  );
}
