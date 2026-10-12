import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfidenceMark } from "@/components/admin-ops/marks";
import { ReviewForm } from "@/components/admin-ops/review-form";
import { ReviewedNotice } from "@/components/admin-ops/reviewed-notice";
import { AnswerSheet, ProofAnswer, type AnswerMark, type Footnote } from "@/components/proof/proof-answer";
import { MarginNote } from "@/components/proof/margin-note";
import { SourceList, type SourceItem } from "@/components/proof/source-list";
import { ButtonLink } from "@/components/ui/button";
import { PlatformList, ReviewLabel, SeverityMark, VerdictLabel, platformName } from "@/components/ui/marks";
import { Details, Notice, PageHeader, Section } from "@/components/ui/page";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import {
  IMPORTANCE,
  ISSUE_ORIGINS,
  ISSUE_STATUSES,
  QUESTION_CATEGORIES,
  SOURCE_LIKELIHOOD,
  SOURCE_TYPES,
  VERDICTS,
  type Verdict,
} from "@/lib/domain/constants";
import { formatDate, formatDateTime, formatRelative } from "@/lib/domain/format";
import { PLAYBOOK } from "@/lib/domain/playbook";
import { getReviewedSummary, getReviewItem, type ReviewItem } from "@/lib/queries/admin-ops";
import { reviewIssue } from "./actions";

export const instant = false;

export async function generateMetadata({ params }: PageProps<"/admin/review/[id]">): Promise<Metadata> {
  await requireAdmin();
  const { id } = await params;
  const summary = await getReviewedSummary(id);
  return { title: summary ? `Review #${summary.number}` : "Review" };
}

const WRONG: readonly Verdict[] = ["incorrect", "outdated", "confused"];

const EVENT_LABELS: Record<ReviewItem["events"][number]["kind"], string> = {
  detected: "Detected",
  approved: "Approved",
  rejected: "Rejected",
  status: "Status changed",
  assigned: "Assigned",
  note: "Note added",
  seen: "Seen again",
  clean: "Correct in a re-check",
  recheck: "Re-check started",
  not_an_error: "Marked “Not an error”",
  reopened: "Reopened",
  resolved: "Resolved",
  severity: "Severity changed",
  fix_step: "Fix step ticked off",
};

function marksFor(item: ReviewItem): AnswerMark[] {
  const marks: AnswerMark[] = [];
  for (const statement of item.answerStatements) {
    if (statement.spanStart === null || statement.spanEnd === null) continue;
    const label = VERDICTS[statement.verdict].label;
    const base = { start: statement.spanStart, end: statement.spanEnd, label };
    if (statement.id === item.statement?.id) marks.push({ ...base, kind: "wrong" });
    else if (WRONG.includes(statement.verdict)) {
      marks.push({
        ...base,
        kind: "other-wrong",
        href: statement.issueId ? `/admin/review/${statement.issueId}` : undefined,
      });
    } else if (statement.verdict === "unsupported" || statement.intermittent) marks.push({ ...base, kind: "review" });
    else if (statement.verdict === "correct") marks.push({ ...base, kind: "correct" });
  }
  return marks;
}

function sourceItems(item: ReviewItem): SourceItem[] {
  const traced = new Map(item.sources.map((source) => [source.url, source]));
  const items: SourceItem[] = item.citations.map((citation, index) => {
    const source = traced.get(citation.url);
    traced.delete(citation.url);
    return {
      n: index + 1,
      url: citation.url,
      title: citation.title ?? source?.title,
      meta: source ? [SOURCE_TYPES[source.sourceType].label, source.publishedLabel, source.note] : ["Not traced yet"],
      containsStatement: source?.containsStatement,
      extra: source ? <span className="text-sm text-graphite">{SOURCE_LIKELIHOOD[source.likelihood].label}</span> : null,
    };
  });
  // Sources found while tracing that this answer did not cite.
  for (const source of traced.values()) {
    items.push({
      n: items.length + 1,
      url: source.url,
      title: source.title,
      meta: [SOURCE_TYPES[source.sourceType].label, source.publishedLabel, source.note, "Not cited in this answer"],
      containsStatement: source.containsStatement,
      extra: <span className="text-sm text-graphite">{SOURCE_LIKELIHOOD[source.likelihood].label}</span>,
    });
  }
  return items;
}

export default async function ReviewIssuePage({ params, searchParams }: PageProps<"/admin/review/[id]">) {
  const ctx = await requireAdmin();
  const { id } = await params;
  const query = await searchParams;
  const reviewedId = typeof query.reviewed === "string" && query.reviewed !== id ? query.reviewed : null;

  const [item, justReviewed] = await Promise.all([getReviewItem(id), reviewedId ? getReviewedSummary(reviewedId) : null]);
  if (!item) notFound();

  const { issue, organization, brand, fact, question, answer } = item;
  const clientName = organization.internal ? `the ${brand.name} prospect report` : organization.name;
  const clientLabel = organization.internal ? `${brand.name} (prospect)` : organization.name;
  const pending = issue.reviewState === "pending";
  const decision = [...item.events].reverse().find((event) => event.kind === "approved" || event.kind === "rejected");
  const footnotes: Footnote[] = item.citations.map((citation, index) => ({
    n: index + 1,
    href: `#source-${index + 1}`,
    label: `Source ${index + 1}`,
  }));
  const sources = sourceItems(item);
  const verdictLabel = issue.verdict === "confused" ? "Confused with another company" : VERDICTS[issue.verdict].label;
  const runs = issue.runsTotal > 0 ? `Seen in ${issue.runsSeen} of ${issue.runsTotal} runs` : null;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Review queue", href: "/admin/review" }, { label: `#${issue.number}` }]}
        title={issue.title}
        description={
          <>
            {clientLabel} · Detected {formatDate(issue.firstSeenAt)}
            {pending && item.queuePosition ? ` · ${item.queuePosition} of ${item.queueLength} waiting` : null}
          </>
        }
        aside={<SeverityMark severity={issue.severity} />}
        actions={
          pending && item.nextId ? (
            <ButtonLink href={`/admin/review/${item.nextId}`} variant="quiet" size="sm">
              Skip to the next one
            </ButtonLink>
          ) : null
        }
      />

      {justReviewed ? <ReviewedNotice summary={justReviewed} className="mb-10" /> : null}

      {!pending ? (
        <Notice tone={issue.reviewState === "approved" ? "done" : "progress"} className="mb-10" title={
          <>
            <ReviewLabel state={issue.reviewState} className="text-base font-medium" />
            {decision ? ` by ${decision.actorName}, ${formatDateTime(decision.createdAt)}` : null}
          </>
        }>
          {decision?.note ? decision.note : issue.reviewState === "approved" ? `${organization.name} can see this issue.` : "The client never saw this issue."}
        </Notice>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-12">
        <div className="min-w-0">
          <p className="text-sm text-graphite">
            Question{question ? ` · ${QUESTION_CATEGORIES[question.category].label}` : ""}
          </p>
          <p className="mt-1 text-lg text-ink">{question ? `“${question.text}”` : "The question was removed from the Question Set."}</p>

          {answer ? (
            <AnswerSheet
              className="mt-5"
              heading={
                <>
                  <span className="font-medium text-ink">{platformName(answer.platform)}</span>
                  <span className="text-graphite">
                    Run {answer.runNumber} · {formatDateTime(answer.createdAt)}
                  </span>
                </>
              }
              meta={
                <span>
                  {answer.model} · {answer.webSearch ? "Answered with web search" : "Answered without web search"}
                  {runs ? ` · ${runs}` : ""}
                </span>
              }
            >
              <ProofAnswer text={answer.text} marks={marksFor(item)} footnotes={footnotes} />
            </AnswerSheet>
          ) : (
            <div className="mt-5 rounded-md border border-rule bg-sheet px-5 py-5 sm:px-6">
              <p className="text-sm text-graphite">The statement as the checker recorded it</p>
              <p className="mt-2 font-serif text-lg leading-[1.7] text-ink [font-optical-sizing:auto]">
                <del className="strike text-ink/85">{issue.wrongStatement}</del>
              </p>
              <p className="mt-3 text-sm text-graphite">The full answer is no longer stored.</p>
            </div>
          )}
        </div>

        <MarginNote
          className="lg:mt-[3.25rem]"
          verdictLabel={verdictLabel}
          detail={runs ?? undefined}
          correct={issue.correctStatement}
          source={
            fact
              ? `From ${brand.name}'s Fact Sheet${fact.validFrom ? `, valid from ${formatDate(fact.validFrom)}` : ""}${
                  fact.status !== "approved" ? ` (${fact.status === "draft" ? "not approved yet" : "archived"})` : ""
                }`
              : "No matching fact on the Fact Sheet"
          }
        >
          <Details
            items={[
              { label: "Checker confidence", value: <ConfidenceMark value={issue.confidence} /> },
              { label: "Platforms", value: <PlatformList platforms={issue.platforms} /> },
              { label: "Where it comes from", value: ISSUE_ORIGINS[issue.origin].label },
              { label: "Error type", value: PLAYBOOK[issue.type].label },
              ...(fact ? [{ label: "Fact importance", value: IMPORTANCE[fact.importance].label }] : []),
            ]}
          />
        </MarginNote>
      </div>

      {item.answerStatements.length > 0 ? (
        <Section
          title="Every statement in this answer"
          description="What the checker extracted, and the verdict it gave each one."
          className="mt-12"
        >
          <Table caption="Statements the checker extracted from this answer">
            <THead>
              <tr>
                <TH>Statement</TH>
                <TH>Verdict</TH>
                <TH>Confidence</TH>
                <TH>Matched fact</TH>
              </tr>
            </THead>
            <TBody>
              {item.answerStatements.map((statement) => {
                const isThis = statement.id === item.statement?.id;
                return (
                  <TR key={statement.id}>
                    <RowHead className="min-w-56">
                      <span className="text-ink">{statement.text}</span>
                      {isThis ? <span className="mt-0.5 block text-sm text-graphite">This issue</span> : null}
                    </RowHead>
                    <TD>
                      <VerdictLabel verdict={statement.verdict} />
                      {statement.intermittent ? (
                        <span className="mt-1 block text-sm whitespace-nowrap text-graphite">Seen once, watched</span>
                      ) : null}
                    </TD>
                    <TD className="min-w-28">
                      <ConfidenceMark value={statement.confidence} />
                    </TD>
                    <TD className="min-w-48 text-graphite">{statement.factStatement ?? "No matching fact"}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Section>
      ) : null}

      <Section
        title="Decision"
        id="decision"
        className={item.answerStatements.length > 0 ? undefined : "mt-12"}
        description={
          pending
            ? `Approve if the answer really contradicts ${brand.name}'s facts. Reject a false alarm with a note.`
            : undefined
        }
      >
        {pending ? (
          <ReviewForm action={reviewIssue} issueId={issue.id} severity={issue.severity} clientName={clientName} />
        ) : (
          <Details
            columns={3}
            items={[
              { label: "Review", value: <ReviewLabel state={issue.reviewState} className="text-base" /> },
              { label: "Status for the client", value: issue.reviewState === "approved" ? ISSUE_STATUSES[issue.status].label : "Hidden" },
              { label: "Severity", value: <SeverityMark severity={issue.severity} /> },
            ]}
          />
        )}
      </Section>

      {item.sightings.length > 0 ? (
        <Section title="Where it was seen" description="Every answer in which the checker found this statement, latest first.">
          <Table caption="Answers that contain this statement">
            <THead>
              <tr>
                <TH>Platform</TH>
                <TH numeric>Run</TH>
                <TH>Model</TH>
                <TH>Seen</TH>
                <TH>Confidence</TH>
              </tr>
            </THead>
            <TBody>
              {item.sightings.map((sighting) => (
                <TR key={sighting.statementId}>
                  <RowHead>
                    {platformName(sighting.platform)}
                    {sighting.answerId === answer?.id ? <span className="mt-0.5 block text-sm text-graphite">Shown above</span> : null}
                  </RowHead>
                  <TD numeric>{sighting.runNumber}</TD>
                  <TD className="whitespace-nowrap text-graphite">{sighting.model}</TD>
                  <TD className="whitespace-nowrap">
                    <span title={formatDateTime(sighting.seenAt)}>{formatRelative(sighting.seenAt, ctx.now)}</span>
                  </TD>
                  <TD className="min-w-28">
                    <ConfidenceMark value={sighting.confidence} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      ) : null}

      <Section title="Sources">
        {sources.length > 0 ? (
          <SourceList items={sources} className="max-w-3xl" />
        ) : (
          <p className="max-w-2xl text-graphite">
            {issue.origin === "memory" ? `No citations. ${ISSUE_ORIGINS.memory.description}` : "No sources found for this answer yet."}
          </p>
        )}
      </Section>

      {item.events.length > 0 ? (
        <Section title="History">
          <ol className="max-w-3xl border-t border-rule">
            {item.events.map((event) => (
              <li key={event.id} className="grid gap-1 border-b border-rule py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
                <span className="text-sm whitespace-nowrap text-graphite">{formatDateTime(event.createdAt)}</span>
                <span>
                  <span className="text-ink">{EVENT_LABELS[event.kind]}</span>
                  <span className="text-graphite"> · {event.actorName}</span>
                  {event.note ? <span className="mt-0.5 block text-graphite">{event.note}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      <p className="mt-12 text-sm text-graphite">
        <Link href="/admin/review" className="underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink">
          Back to the review queue
        </Link>
      </p>
    </>
  );
}
