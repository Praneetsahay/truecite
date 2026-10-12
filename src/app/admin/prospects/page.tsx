import type { Metadata } from "next";
import Link from "next/link";
import { RequestActions } from "@/components/admin-business/request-actions";
import { ButtonLink, ExternalLink } from "@/components/ui/button";
import { EmptyState, PageHeader, Section } from "@/components/ui/page";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { PROSPECT_STATUSES } from "@/lib/domain/constants";
import { displayUrl, formatDate, formatDateTime, formatRelative, plural } from "@/lib/domain/format";
import { getCheckRequestCounts, getNewCheckRequests, getProspects, shareUrl } from "@/lib/queries/admin-business";
import { acceptRequest, declineRequest } from "./actions";

// Checks the admin session on every request, like the rest of /admin.
export const instant = false;

export const metadata: Metadata = { title: "Prospects" };

const linkClass = "underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink";

export default async function ProspectsPage() {
  const ctx = await requireAdmin();
  const [requests, handled, pipeline] = await Promise.all([getNewCheckRequests(), getCheckRequestCounts(), getProspects()]);

  return (
    <>
      <PageHeader
        title="Prospects"
        description="Free check requests and the sales pipeline. Each prospect gets a small scan and a short report with real errors, to open a conversation."
        actions={
          <ButtonLink href="/admin/prospects/new" variant="primary">
            Add prospect
          </ButtonLink>
        }
      />

      <Section
        rule={false}
        title="Free check requests"
        description="Requests from the form on the website wait here instead of running on their own. Accept one to make it a prospect."
      >
        {requests.length === 0 ? (
          <EmptyState title="No new requests.">
            Requests from the free check form land here.{" "}
            {handled.accepted + handled.declined > 0
              ? `So far ${plural(handled.accepted, "request")} accepted and ${handled.declined} declined.`
              : "None has come in yet."}
          </EmptyState>
        ) : (
          <Table caption="Free check requests waiting for a decision">
            <THead>
              <tr>
                <TH>Company</TH>
                <TH>From</TH>
                <TH>What worries them</TH>
                <TH>Received</TH>
                <TH>
                  <span className="sr-only">Decision</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {requests.map((request) => (
                <TR key={request.id}>
                  <RowHead className="min-w-40">
                    <span className="font-medium text-ink">{request.company}</span>
                    <span className="mt-0.5 block text-sm text-graphite">
                      <ExternalLink href={request.website}>{displayUrl(request.website)}</ExternalLink>
                    </span>
                  </RowHead>
                  <TD className="min-w-48">
                    {request.name}
                    <span className="mt-0.5 block text-sm text-graphite">{request.role ?? "Role not given"}</span>
                    <a href={`mailto:${request.email}`} className={`mt-0.5 block text-sm text-graphite ${linkClass}`}>
                      {request.email}
                    </a>
                  </TD>
                  <TD className="min-w-56 max-w-md">
                    {request.message ? <span className="text-ink">{request.message}</span> : <span className="text-graphite">Nothing added</span>}
                  </TD>
                  <TD className="whitespace-nowrap">
                    <span title={formatDateTime(request.createdAt)}>{formatRelative(request.createdAt, ctx.now)}</span>
                  </TD>
                  <TD className="min-w-40">
                    <RequestActions requestId={request.id} company={request.company} accept={acceptRequest} decline={declineRequest} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      <Section title="Pipeline" description="Every prospect, most recently updated first. Open one to run its scan, create the report and copy the email.">
        {pipeline.length === 0 ? (
          <EmptyState title="No prospects yet." action={<ButtonLink href="/admin/prospects/new">Add prospect</ButtonLink>}>
            Add a company you want to reach, or accept a free check request. TrueCite runs a small scan for it and you review
            the findings before anything is sent.
          </EmptyState>
        ) : (
          <Table caption="Prospect pipeline">
            <THead>
              <tr>
                <TH>Company</TH>
                <TH>Contact</TH>
                <TH>Status</TH>
                <TH numeric>Findings</TH>
                <TH>Last updated</TH>
                <TH>Report</TH>
              </tr>
            </THead>
            <TBody>
              {pipeline.map((prospect) => {
                const expired = prospect.report?.shareExpiresAt ? prospect.report.shareExpiresAt <= ctx.now : false;
                return (
                  <TR key={prospect.id}>
                    <RowHead className="min-w-44">
                      <Link href={`/admin/prospects/${prospect.id}`} className={`font-medium text-ink ${linkClass}`}>
                        {prospect.company}
                      </Link>
                      <span className="mt-0.5 block text-sm text-graphite">
                        {displayUrl(prospect.website)}
                        {prospect.source === "free_check" ? " · Free check" : null}
                      </span>
                    </RowHead>
                    <TD className="min-w-40">
                      {prospect.contactName ? (
                        <>
                          {prospect.contactName}
                          {prospect.contactRole ? <span className="mt-0.5 block text-sm text-graphite">{prospect.contactRole}</span> : null}
                        </>
                      ) : (
                        <span className="text-graphite">Not found yet</span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap">
                      <span className={prospect.status === "lost" ? "text-graphite" : "text-ink"}>{PROSPECT_STATUSES[prospect.status].label}</span>
                    </TD>
                    <TD numeric>
                      {prospect.findings > 0 ? prospect.findings : <span className="text-graphite">0</span>}
                      {prospect.pending > 0 ? <span className="mt-0.5 block text-sm text-graphite">{prospect.pending} to review</span> : null}
                    </TD>
                    <TD className="whitespace-nowrap">
                      <span title={formatDateTime(prospect.updatedAt)}>{formatRelative(prospect.updatedAt, ctx.now)}</span>
                    </TD>
                    <TD className="whitespace-nowrap">
                      {prospect.report?.shareToken ? (
                        <>
                          <ExternalLink href={shareUrl(prospect.report.shareToken)}>Open report</ExternalLink>
                          <span className="mt-0.5 block text-sm text-graphite">
                            {expired ? `Expired ${formatDate(prospect.report.shareExpiresAt)}` : `Expires ${formatDate(prospect.report.shareExpiresAt)}`}
                          </span>
                        </>
                      ) : prospect.report ? (
                        <span className="text-graphite">Not shared</span>
                      ) : (
                        <span className="text-graphite">Not yet</span>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Section>
    </>
  );
}
