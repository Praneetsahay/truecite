import type { Metadata } from "next";
import Link from "next/link";
import { ConfidenceMark } from "@/components/admin-ops/marks";
import { ReviewedNotice } from "@/components/admin-ops/reviewed-notice";
import { ButtonLink } from "@/components/ui/button";
import { PlatformList, ReviewLabel, SeverityMark, VerdictLabel } from "@/components/ui/marks";
import { EmptyState, PageHeader, Section } from "@/components/ui/page";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDate, formatDateTime, formatPercent, formatRelative, plural } from "@/lib/domain/format";
import {
  getNotAnErrorFeedback,
  getRecentlyReviewed,
  getReviewQueue,
  getReviewedSummary,
  LOW_CONFIDENCE_BELOW,
} from "@/lib/queries/admin-ops";

export const instant = false;

export const metadata: Metadata = { title: "Review queue" };

const linkClass = "underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink";

function clientLabel(item: { organizationName: string; brandName: string; internal: boolean }) {
  if (item.internal) return { name: item.brandName, detail: "Prospect report" };
  return { name: item.organizationName, detail: item.brandName !== item.organizationName ? item.brandName : null };
}

export default async function ReviewQueuePage({ searchParams }: PageProps<"/admin/review">) {
  const ctx = await requireAdmin();
  const query = await searchParams;
  const reviewedId = typeof query.reviewed === "string" ? query.reviewed : null;

  const [queue, reviewed, feedback, justReviewed] = await Promise.all([
    getReviewQueue(),
    getRecentlyReviewed(12),
    getNotAnErrorFeedback(20),
    reviewedId ? getReviewedSummary(reviewedId) : null,
  ]);
  const lowConfidence = queue.filter((item) => item.confidence < LOW_CONFIDENCE_BELOW).length;

  return (
    <>
      <PageHeader
        title="Review queue"
        description="New issues wait here until you approve them, so false alarms never reach clients. Oldest first."
        actions={
          queue.length > 0 ? (
            <ButtonLink href={`/admin/review/${queue[0].id}`} variant="primary">
              Start reviewing
            </ButtonLink>
          ) : null
        }
      />

      {justReviewed ? (
        <ReviewedNotice summary={justReviewed} className="mb-10">
          {queue.length === 0 ? "That was the last one. Nothing else waits for review." : null}
        </ReviewedNotice>
      ) : null}

      <Section
        rule={false}
        title={queue.length > 0 ? `${plural(queue.length, "issue")} waiting` : "Waiting for review"}
        description={
          queue.length > 0
            ? lowConfidence > 0
              ? `${lowConfidence} with low checker confidence, below ${formatPercent(LOW_CONFIDENCE_BELOW)}. Read those answers closely.`
              : `Every verdict has checker confidence of ${formatPercent(LOW_CONFIDENCE_BELOW)} or more.`
            : undefined
        }
      >
        {queue.length === 0 ? (
          <EmptyState title="Nothing waits for review.">
            New issues appear here after each scan, before any client sees them. Approved issues go straight to the
            client&apos;s dashboard and alerts.
          </EmptyState>
        ) : (
          <Table caption="Issues waiting for review, oldest first">
            <THead>
              <tr>
                <TH>Client</TH>
                <TH>Issue</TH>
                <TH>Verdict</TH>
                <TH>Severity</TH>
                <TH>Confidence</TH>
                <TH>Platforms</TH>
                <TH>Detected</TH>
              </tr>
            </THead>
            <TBody>
              {queue.map((item) => {
                const client = clientLabel(item);
                return (
                  <TR key={item.id}>
                    <TD className="min-w-32">
                      <span className="text-ink">{client.name}</span>
                      {client.detail ? <span className="mt-0.5 block text-sm text-graphite">{client.detail}</span> : null}
                    </TD>
                    <RowHead className="min-w-56">
                      <Link href={`/admin/review/${item.id}`} className={`text-ink ${linkClass}`}>
                        <span className="figures text-graphite">#{item.number}</span> {item.title}
                      </Link>
                    </RowHead>
                    <TD>
                      <VerdictLabel verdict={item.verdict} />
                    </TD>
                    <TD>
                      <SeverityMark severity={item.severity} />
                    </TD>
                    <TD className="min-w-28">
                      <ConfidenceMark value={item.confidence} />
                    </TD>
                    <TD className="min-w-32">
                      <PlatformList platforms={item.platforms} />
                    </TD>
                    <TD className="whitespace-nowrap">
                      <span title={formatDateTime(item.firstSeenAt)}>{formatDate(item.firstSeenAt)}</span>
                      <span className="mt-0.5 block text-sm text-graphite">{formatRelative(item.firstSeenAt, ctx.now)}</span>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Section>

      <Section title="Recently reviewed" description="Your latest decisions. Approved issues are visible to the client.">
        {reviewed.length === 0 ? (
          <p className="text-graphite">No decisions yet. They are listed here once you approve or reject an issue.</p>
        ) : (
          <Table caption="Recently reviewed issues">
            <THead>
              <tr>
                <TH>Issue</TH>
                <TH>Decision</TH>
                <TH>Note</TH>
                <TH>By</TH>
                <TH>When</TH>
              </tr>
            </THead>
            <TBody>
              {reviewed.map((item) => {
                const client = clientLabel(item);
                return (
                  <TR key={item.eventId}>
                    <RowHead className="min-w-56">
                      <Link href={`/admin/review/${item.issueId}`} className={`text-ink ${linkClass}`}>
                        <span className="figures text-graphite">#{item.number}</span> {item.title}
                      </Link>
                      <span className="mt-0.5 block text-sm text-graphite">{client.name}</span>
                    </RowHead>
                    <TD>
                      <ReviewLabel state={item.decision} />
                    </TD>
                    <TD className="min-w-56 max-w-md text-graphite">{item.note ?? "–"}</TD>
                    <TD className="whitespace-nowrap">{item.actorName}</TD>
                    <TD className="whitespace-nowrap text-graphite">
                      <span title={formatDateTime(item.at)}>{formatRelative(item.at, ctx.now)}</span>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Section>

      <Section
        title="Marked “Not an error” by clients"
        description="Clients dismissed these after approval. Their notes feed the checker's rules, so read them before you change a rule or approve a similar issue."
      >
        {feedback.length === 0 ? (
          <p className="text-graphite">
            No client has dismissed an issue yet. When one does, the statement and their reason appear here.
          </p>
        ) : (
          <ol className="border-t border-rule">
            {feedback.map((item) => (
              <li key={item.id} className="grid gap-2 border-b border-rule py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-10">
                <div className="min-w-0">
                  <p className="text-sm text-graphite">
                    {item.organizationName} · <span className="figures">#{item.number}</span> {item.title} ·{" "}
                    <VerdictLabel verdict={item.verdict} className="font-normal" />
                  </p>
                  <p className="mt-1.5 font-serif text-lg leading-snug text-ink [font-optical-sizing:auto]">
                    “{item.wrongStatement}”
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-graphite">
                    {item.dismissedBy ?? "A client"} · {formatDate(item.dismissedAt)}
                  </p>
                  <p className="mt-1.5 text-ink">{item.note ?? <span className="text-graphite">No note given.</span>}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </>
  );
}
