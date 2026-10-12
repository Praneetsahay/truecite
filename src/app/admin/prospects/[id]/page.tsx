import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ScanProgress, ScanStatusLabel } from "@/components/admin-ops/marks";
import { ActionForm } from "@/components/admin-business/action-form";
import { AutoRefresh } from "@/components/admin-business/auto-refresh";
import { CopyBlock, CopyLink } from "@/components/admin-business/copy-text";
import {
  coldEmail,
  emailFindingFromIssue,
  emailFindingFromReport,
  outreachSteps,
  type EmailFinding,
} from "@/components/admin-business/outreach";
import { OutreachSteps } from "@/components/admin-business/outreach-steps";
import { ProspectStatusForm } from "@/components/admin-business/prospect-forms";
import { ExternalLink } from "@/components/ui/button";
import { PlatformList, ReviewLabel, SeverityMark, VerdictLabel } from "@/components/ui/marks";
import { Details, EmptyState, Notice, PageHeader, Section } from "@/components/ui/page";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { PROSPECT_LINK_DAYS, PROSPECT_STATUSES } from "@/lib/domain/constants";
import { displayUrl, formatCost, formatDate, formatDateTime, formatRelative, plural } from "@/lib/domain/format";
import { getProspectDetail, shareUrl } from "@/lib/queries/admin-business";
import { createReportAction, runProspectScan, updateProspect } from "./actions";

// Checks the admin session on every request, like the rest of /admin.
export const instant = false;

export const metadata: Metadata = { title: "Prospect" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const linkClass = "underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink";
const ACTIVE = new Set(["queued", "running", "checking"]);

const DONE_NOTICES: Record<string, string> = {
  added: "Prospect added. Run the prospect scan when you are ready; the findings wait for your review before anything is sent.",
  accepted: "Request accepted. The prospect is in the pipeline with the details from the form.",
};

export default async function ProspectPage({ params, searchParams }: PageProps<"/admin/prospects/[id]">) {
  const ctx = await requireAdmin();
  const { id } = await params;
  const { done } = await searchParams;
  if (!UUID.test(id)) notFound();
  const detail = await getProspectDetail(id);
  if (!detail) notFound();

  const { prospect, report, scan, findings, request } = detail;
  const approved = findings.filter((f) => f.reviewState === "approved");
  const pending = findings.filter((f) => f.reviewState === "pending");
  const scanActive = scan ? ACTIVE.has(scan.status) : false;
  const linkExpired = report?.shareExpiresAt ? report.shareExpiresAt <= ctx.now : false;
  const notice = typeof done === "string" ? DONE_NOTICES[done] : undefined;

  // One primary action, depending on where the prospect is.
  const primary: "scan" | "report" | null = !scan ? "scan" : approved.length > 0 && !report && !scanActive ? "report" : null;

  // Findings come from the approved issues; a report built earlier keeps its own copy of them.
  const reportOnly = findings.length === 0 && (report?.findings.length ?? 0) > 0;
  const emailFindings: EmailFinding[] =
    approved.length > 0 ? approved.map(emailFindingFromIssue) : (report?.findings ?? []).map(emailFindingFromReport);
  const email = coldEmail({
    company: prospect.company,
    contactName: prospect.contactName,
    senderName: ctx.user.name,
    platforms: scan?.platforms ?? [],
    approved: emailFindings,
  });

  return (
    <>
      {scanActive ? <AutoRefresh seconds={5} /> : null}
      <PageHeader
        crumbs={[{ label: "Prospects", href: "/admin/prospects" }, { label: prospect.company }]}
        title={prospect.company}
        description={
          <>
            <ExternalLink href={prospect.website}>{displayUrl(prospect.website)}</ExternalLink>
            {prospect.industry ? ` · ${prospect.industry}` : null}
            {` · ${prospect.source === "free_check" ? "Asked for a free check" : "Outbound"}`}
          </>
        }
        aside={<span className="text-base text-ink">{PROSPECT_STATUSES[prospect.status].label}</span>}
      />

      {notice ? (
        <Notice tone="done" className="mb-8">
          {notice}
        </Notice>
      ) : null}

      <Details
        columns={3}
        className="border-t border-rule pt-5"
        items={[
          {
            label: "Contact",
            value: prospect.contactName ? (
              <>
                {prospect.contactName}
                {prospect.contactRole ? <span className="block text-sm text-graphite">{prospect.contactRole}</span> : null}
              </>
            ) : (
              <span className="text-graphite">Not found yet</span>
            ),
          },
          {
            label: "Email",
            value: prospect.contactEmail ? (
              <a href={`mailto:${prospect.contactEmail}`} className={`break-all ${linkClass}`}>
                {prospect.contactEmail}
              </a>
            ) : (
              <span className="text-graphite">Not found yet</span>
            ),
          },
          {
            label: "Added",
            value: (
              <>
                {formatDate(prospect.createdAt)}
                <span className="block text-sm text-graphite">Updated {formatRelative(prospect.updatedAt, ctx.now)}</span>
              </>
            ),
          },
        ]}
      />
      {request?.message ? (
        <div className="mt-6 max-w-2xl">
          <p className="text-sm text-graphite">What worries them, from the free check form</p>
          <p className="mt-1 text-ink">{request.message}</p>
        </div>
      ) : null}

      <Section
        className="mt-12"
        title="Prospect scan"
        description="Asks about 20 to 30 questions on two platforms, ChatGPT and Perplexity, two runs each. At typical prices it costs roughly $1 to $6 in API usage."
      >
        {!scan ? (
          <ActionForm
            action={runProspectScan}
            fields={{ prospectId: prospect.id }}
            label="Run prospect scan"
            variant="primary"
            hint="TrueCite drafts facts from the website, picks the questions and starts the scan. It takes a few minutes."
          />
        ) : (
          <div className="grid gap-6">
            <Details
              columns={3}
              items={[
                {
                  label: "Status",
                  value: (
                    <>
                      <Link href={`/admin/scans/${scan.id}`} className={linkClass}>
                        <ScanStatusLabel status={scan.status} />
                      </Link>
                      {scan.simulated ? <span className="block text-sm text-graphite">Simulated answers</span> : null}
                    </>
                  ),
                },
                {
                  label: scanActive ? "Progress" : "Questions",
                  value: scanActive ? (
                    <ScanProgress done={scan.jobsDone} total={scan.jobsTotal} />
                  ) : (
                    <>
                      {plural(scan.questionCount, "question")} on <PlatformList platforms={scan.platforms} />
                      {scan.jobsFailed > 0 ? <span className="block text-sm text-graphite">{plural(scan.jobsFailed, "failed job")}</span> : null}
                    </>
                  ),
                },
                {
                  label: "API cost",
                  value: (
                    <>
                      <span>{formatCost(scan.totalCostUsd)}</span>
                      <span className="block text-sm text-graphite">
                        {scan.finishedAt ? `Finished ${formatDateTime(scan.finishedAt)}` : `Started ${formatRelative(scan.createdAt, ctx.now)}`}
                      </span>
                    </>
                  ),
                },
              ]}
            />
            {scan.error ? <p className="max-w-2xl text-correction">{scan.error}</p> : null}
            {!scanActive ? (
              <ActionForm
                action={runProspectScan}
                fields={{ prospectId: prospect.id }}
                label="Run prospect scan"
                hint={`Runs it again with fresh answers. ${detail.scanCount > 1 ? `${detail.scanCount} scans so far.` : ""}`.trim()}
              />
            ) : null}
          </div>
        )}
      </Section>

      <Section
        title="Findings"
        description="Wrong answers the scan found. Only findings you approve go into the report and the email, so send real, clear errors only."
        actions={pending.length > 0 ? <span className="text-sm text-graphite">{plural(pending.length, "finding")} to review</span> : null}
      >
        {reportOnly && report ? (
          <Table caption="Findings in the report">
            <THead>
              <tr>
                <TH>Finding</TH>
                <TH>Severity</TH>
                <TH>Seen on</TH>
                <TH>Review</TH>
              </tr>
            </THead>
            <TBody>
              {report.findings.map((finding, index) => (
                <TR key={`${finding.title}-${index}`}>
                  <RowHead className="min-w-64">
                    <span className="font-medium text-ink">{finding.title}</span>
                    <span className="mt-1 block font-serif text-ink">
                      <s className="strike">{finding.wrong}</s> <VerdictLabel verdict="incorrect" className="ml-1 font-sans" />
                    </span>
                    <span className="mt-0.5 block text-sm text-graphite">Correct: {finding.correct}</span>
                  </RowHead>
                  <TD>
                    <SeverityMark severity={finding.severity} />
                  </TD>
                  <TD className="min-w-28">
                    <PlatformList platforms={finding.platforms} />
                  </TD>
                  <TD className="whitespace-nowrap text-graphite">In the report</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : findings.length === 0 ? (
          <EmptyState title={scanActive ? "Waiting for answers." : scan ? "The scan found no wrong answers." : "No findings yet."} className="border-t-0 pt-0">
            {scanActive
              ? "Findings appear here as answers are checked. This page updates on its own."
              : scan
                ? "Every checked answer matched the facts from the website. Run the scan again later, or move on to the next prospect."
                : "Run the prospect scan. Each finding waits in the review queue until you approve it."}
          </EmptyState>
        ) : (
          <Table caption="Findings for this prospect">
            <THead>
              <tr>
                <TH>Finding</TH>
                <TH>Severity</TH>
                <TH>Seen on</TH>
                <TH>Review</TH>
              </tr>
            </THead>
            <TBody>
              {findings.map((finding) => (
                <TR key={finding.id}>
                  <RowHead className="min-w-64">
                    <span className="font-medium text-ink">{finding.title}</span>
                    <span className="mt-1 block font-serif text-ink">
                      <s className="strike">{finding.wrongStatement}</s> <VerdictLabel verdict={finding.verdict} className="ml-1 font-sans" />
                    </span>
                    <span className="mt-0.5 block text-sm text-graphite">Correct: {finding.correctStatement}</span>
                  </RowHead>
                  <TD>
                    <SeverityMark severity={finding.severity} />
                  </TD>
                  <TD className="min-w-28">
                    <PlatformList platforms={finding.platforms} />
                  </TD>
                  <TD className="whitespace-nowrap">
                    {finding.reviewState === "pending" ? (
                      <Link href={`/admin/review/${finding.id}`} className={linkClass}>
                        Review
                      </Link>
                    ) : (
                      <ReviewLabel state={finding.reviewState} />
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      <Section
        title="Report"
        description={`A short report with the approved findings, behind a private link that stops working after ${PROSPECT_LINK_DAYS} days.`}
      >
        <div className="grid gap-6">
          {report?.shareToken ? (
            <CopyLink
              id="share-link"
              label="Private link"
              value={shareUrl(report.shareToken)}
              hint={
                linkExpired
                  ? `Expired on ${formatDate(report.shareExpiresAt)}. Create the report again to renew the link for ${PROSPECT_LINK_DAYS} days.`
                  : `Expires ${formatDate(report.shareExpiresAt)}, ${formatRelative(report.shareExpiresAt, ctx.now)}. Created ${formatDate(report.createdAt)}.`
              }
            />
          ) : null}
          <ActionForm
            action={createReportAction}
            fields={{ prospectId: prospect.id }}
            label="Create report"
            variant={primary === "report" ? "primary" : "secondary"}
            hint={
              report
                ? "Creating it again refreshes the findings and keeps the same link."
                : approved.length > 0
                  ? `Uses the ${plural(approved.length, "approved finding")}.`
                  : "Approve at least one finding first."
            }
          />
        </div>
      </Section>

      <Section
        title="Cold email"
        description={
          email.filled
            ? `Filled in with ${emailFindings.length > 1 ? "two" : "one"} approved ${emailFindings.length > 1 ? "findings" : "finding"}. Read it once more and make it personal before you send it.`
            : "Approve one or two findings to fill in the email. Until then it shows where they go."
        }
      >
        <CopyBlock id="cold-email" label={`Email to ${prospect.contactName ?? prospect.company}`} value={email.text} />
      </Section>

      <Section title="Outreach steps" description="Steps tick off as the status moves forward.">
        {prospect.status === "lost" ? (
          <p className="mb-4 max-w-2xl text-graphite">Marked as not interested. Stop contacting anyone who asks you to.</p>
        ) : null}
        <OutreachSteps
          steps={outreachSteps({
            status: prospect.status,
            hasContact: Boolean(prospect.contactName && prospect.contactEmail),
            hasReport: Boolean(report),
          })}
        />
      </Section>

      <Section title="Contact, status and notes" description="Move the status forward as the conversation goes; the outreach steps follow it.">
        <ProspectStatusForm
          action={updateProspect}
          prospectId={prospect.id}
          status={prospect.status}
          notes={prospect.notes}
          contactName={prospect.contactName}
          contactEmail={prospect.contactEmail}
          contactRole={prospect.contactRole}
        />
      </Section>
    </>
  );
}
