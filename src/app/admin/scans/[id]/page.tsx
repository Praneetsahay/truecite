import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnswerSourceLabel, ScanProgress, ScanStatusLabel } from "@/components/admin-ops/marks";
import { ScanActionForm } from "@/components/admin-ops/scan-controls";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { ButtonLink } from "@/components/ui/button";
import { PlatformList, platformName } from "@/components/ui/marks";
import { Details, EmptyState, Notice, PageHeader, Section } from "@/components/ui/page";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { SCAN_TYPES } from "@/lib/domain/constants";
import { formatCost, formatDate, formatDateTime, formatNumber, formatRelative, plural } from "@/lib/domain/format";
import {
  ACTIVE_SCAN_STATUSES,
  formatDuration,
  getScanDetail,
  getScanOwner,
  scanDuration,
  SCAN_ANSWERS_LIMIT,
} from "@/lib/queries/admin-ops";
import { cancelScanAction, retryJobs } from "./actions";

export const instant = false;

export async function generateMetadata({ params }: PageProps<"/admin/scans/[id]">): Promise<Metadata> {
  await requireAdmin();
  const { id } = await params;
  const owner = await getScanOwner(id);
  return { title: owner ? `${SCAN_TYPES[owner.type].label} scan, ${owner.brandName}` : "Scan" };
}

const linkClass = "underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink";

export default async function ScanDetailPage({ params, searchParams }: PageProps<"/admin/scans/[id]">) {
  const ctx = await requireAdmin();
  const { id } = await params;
  const query = await searchParams;
  const detail = await getScanDetail(id);
  if (!detail) notFound();

  const { scan, brand, organization, jobTotals, failedJobs } = detail;
  const active = (ACTIVE_SCAN_STATUSES as readonly string[]).includes(scan.status);
  const started = scan.startedAt ?? scan.createdAt;
  const clientName = organization.internal ? brand.name : organization.name;
  const duration = scanDuration(scan, ctx.now);
  // Older scans keep only some job rows (failed ones), so the scan's own counters win when they are larger.
  const jobsTotal = Math.max(jobTotals.total, scan.jobsTotal);
  const jobsDone = Math.max(jobTotals.done, scan.jobsDone);
  const completeJobRecords = jobTotals.total >= scan.jobsTotal;
  const retriedCount = Number(query.count);

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Scans and jobs", href: "/admin/scans" },
          { label: `${clientName}, ${formatDate(started)}` },
        ]}
        title={`${SCAN_TYPES[scan.type].label} scan for ${brand.name}`}
        description={
          <>
            <ScanStatusLabel status={scan.status} className="text-ink" />
            {scan.startedAt ? ` · Started ${formatDateTime(scan.startedAt)}` : " · Not started yet"}
            {duration !== null ? ` · ${formatDuration(duration)}${active ? " so far" : ""}` : null}
          </>
        }
        actions={
          organization.internal ? (
            <ButtonLink href="/admin/prospects">View prospects</ButtonLink>
          ) : (
            <ButtonLink href={`/admin/clients/${organization.id}`}>View client</ButtonLink>
          )
        }
      />

      {query.done === "retried" ? (
        <Notice tone="done" title="Retry started" className="mb-10">
          {Number.isFinite(retriedCount) && retriedCount > 0
            ? `${plural(retriedCount, "job")} ${retriedCount === 1 ? "is" : "are"} back in the queue.${active ? " Progress below updates by itself." : ""}`
            : "No failed jobs were left to retry."}
        </Notice>
      ) : null}
      {query.done === "cancelled" ? (
        <Notice tone="done" title="Scan cancelled" className="mb-10">
          Answers collected so far are kept. Jobs that had not run will not run.
        </Notice>
      ) : null}
      {scan.status === "failed" && scan.error ? (
        <Notice tone="attention" title="The scan stopped with an error" className="mb-10">
          {scan.error}
        </Notice>
      ) : null}

      {active ? <AutoRefresh seconds={5} /> : null}
      {active ? (
        <Section rule={false} title="Progress" className="mb-10">
          <div className="grid gap-6 sm:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] sm:items-center sm:gap-10">
            <ScanProgress done={jobsDone} total={jobsTotal} />
            <ScanActionForm
              action={cancelScanAction}
              scanId={scan.id}
              label="Cancel scan"
              hint="Stops the scan. Answers collected so far are kept."
            />
          </div>
        </Section>
      ) : null}

      <Details
        columns={3}
        className="border-t border-rule pt-5"
        items={[
          {
            label: "Client",
            value: organization.internal ? (
              <span>
                {brand.name} <span className="text-graphite">(prospect)</span>
              </span>
            ) : (
              <Link href={`/admin/clients/${organization.id}`} className={linkClass}>
                {organization.name}
              </Link>
            ),
          },
          { label: "Platforms", value: <PlatformList platforms={scan.platforms} /> },
          {
            label: "Questions × runs",
            value: (
              <span>
                {formatNumber(scan.questionCount)} × {scan.runsPerQuestion}
              </span>
            ),
          },
          {
            label: "Jobs",
            value: (
              <span>
                {formatNumber(jobsDone)} of {formatNumber(jobsTotal)} done
                {jobTotals.failed > 0 ? <span className="font-medium">, {formatNumber(jobTotals.failed)} failed</span> : null}
              </span>
            ),
          },
          { label: "Cost", value: <span>{formatCost(scan.totalCostUsd)}</span> },
          {
            label: "Answers from",
            value: (
              <span>
                <AnswerSourceLabel simulated={scan.simulated} />
                {scan.simulated ? <span className="text-graphite">, no API key was set</span> : null}
              </span>
            ),
          },
          { label: "Started by", value: detail.triggeredBy ?? (scan.type === "scheduled" ? "The schedule" : "TrueCite") },
          {
            label: "Finished",
            value: scan.finishedAt ? formatDateTime(scan.finishedAt) : <span className="text-graphite">{active ? "Still running" : "–"}</span>,
          },
          ...(detail.recheckIssue
            ? [
                {
                  label: "Re-check of",
                  value: (
                    <span>
                      <span className="figures text-graphite">#{detail.recheckIssue.number}</span> {detail.recheckIssue.title}
                    </span>
                  ),
                },
              ]
            : []),
          ...(scan.note ? [{ label: "Note", value: scan.note }] : []),
        ]}
      />

      {detail.jobsByPlatform.length > 0 && completeJobRecords ? (
        <Section title="Jobs by platform" description="One job for every question, platform and run.">
          <Table caption="Jobs by platform and status">
            <THead>
              <tr>
                <TH>Platform</TH>
                <TH numeric>Done</TH>
                <TH numeric>Running</TH>
                <TH numeric>Queued</TH>
                <TH numeric>Failed</TH>
              </tr>
            </THead>
            <TBody>
              {detail.jobsByPlatform.map(({ platform, counts }) => (
                <TR key={platform}>
                  <RowHead>{platformName(platform)}</RowHead>
                  <TD numeric>{formatNumber(counts.done)}</TD>
                  <TD numeric className={counts.running ? undefined : "text-graphite"}>
                    {formatNumber(counts.running)}
                  </TD>
                  <TD numeric className={counts.queued ? undefined : "text-graphite"}>
                    {formatNumber(counts.queued)}
                  </TD>
                  <TD numeric className={counts.failed ? "font-medium" : "text-graphite"}>
                    {formatNumber(counts.failed)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      ) : null}

      <Section
        title={failedJobs.length > 0 ? `Failed jobs (${formatNumber(failedJobs.length)})` : "Failed jobs"}
        id="failed"
        description={
          failedJobs.length > 0
            ? "These jobs ran out of automatic retries. Retry them once the provider recovers."
            : undefined
        }
      >
        {failedJobs.length === 0 ? (
          <p className="text-graphite">
            {jobTotals.total === 0 && !active
              ? "No job records are kept for this scan."
              : "No failed jobs. Every job got an answer or is still waiting its turn."}
          </p>
        ) : (
          <>
            <ScanActionForm
              action={retryJobs}
              scanId={scan.id}
              label="Retry failed jobs"
              variant="primary"
              hint={`Puts ${plural(failedJobs.length, "job")} back in the queue.`}
              className="mb-6"
            />
            <Table caption="Failed jobs">
              <THead>
                <tr>
                  <TH>Question</TH>
                  <TH>Platform</TH>
                  <TH numeric>Run</TH>
                  <TH numeric>Attempts</TH>
                  <TH>Last error</TH>
                  <TH>Next attempt</TH>
                </tr>
              </THead>
              <TBody>
                {failedJobs.map((job) => (
                  <TR key={job.id}>
                    <RowHead className="min-w-56">{job.question}</RowHead>
                    <TD className="whitespace-nowrap">{platformName(job.platform)}</TD>
                    <TD numeric>{job.runNumber}</TD>
                    <TD numeric>{job.attempts}</TD>
                    <TD className="min-w-56 max-w-sm text-graphite">
                      <span className="break-words">{job.lastError ?? "No error recorded"}</span>
                    </TD>
                    <TD className="whitespace-nowrap text-graphite">
                      {job.nextAttemptAt ? (
                        <span title={formatDateTime(job.nextAttemptAt)}>{formatRelative(job.nextAttemptAt, ctx.now)}</span>
                      ) : (
                        "Only when retried"
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </>
        )}
      </Section>

      <Section
        title="Answers collected"
        id="answers"
        description={
          detail.answerCount > 0
            ? `${plural(detail.answerCount, "answer")}, with ${plural(detail.wrongTotal, "wrong statement")} found by the checker.${
                detail.answerCount > SCAN_ANSWERS_LIMIT ? ` Showing the first ${SCAN_ANSWERS_LIMIT}, by question.` : ""
              }`
            : undefined
        }
      >
        {detail.answers.length === 0 ? (
          <EmptyState title="No answers yet." className="border-t-0 pt-0">
            {active ? "Answers appear here as jobs finish." : "This scan stopped before any AI assistant answered."}
          </EmptyState>
        ) : (
          <Table caption="Answers collected in this scan">
            <THead>
              <tr>
                <TH>Question</TH>
                <TH>Platform</TH>
                <TH numeric>Run</TH>
                <TH>Model</TH>
                <TH numeric>Statements</TH>
                <TH numeric>Wrong</TH>
                <TH numeric>Cost</TH>
              </tr>
            </THead>
            <TBody>
              {detail.answers.map((answer) => (
                <TR key={answer.id}>
                  <RowHead className="min-w-56">{answer.question}</RowHead>
                  <TD className="whitespace-nowrap">{platformName(answer.platform)}</TD>
                  <TD numeric>{answer.runNumber}</TD>
                  <TD className="whitespace-nowrap text-graphite">{answer.model}</TD>
                  <TD numeric>{answer.statements}</TD>
                  <TD numeric className={answer.wrong > 0 ? "font-medium" : "text-graphite"}>
                    {answer.wrong}
                  </TD>
                  <TD numeric>{formatCost(answer.costUsd)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
    </>
  );
}
