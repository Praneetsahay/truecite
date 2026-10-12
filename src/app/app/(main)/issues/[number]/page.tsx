import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FixSteps } from "@/components/issues/fix-steps";
import { IssueHistory } from "@/components/issues/issue-history";
import { AssigneeForm, DismissForm, NoteForm } from "@/components/issues/issue-forms";
import { PlatformTabs, seenInRuns } from "@/components/issues/platform-tabs";
import { StatusBand, type StatusBandTransition } from "@/components/issues/status-band";
import { AnswerSheet, ProofAnswer } from "@/components/proof/proof-answer";
import { MarginNote } from "@/components/proof/margin-note";
import { SourceList } from "@/components/proof/source-list";
import { PlatformList, SeverityMark, StatusMark } from "@/components/ui/marks";
import { Details, Notice, PageHeader, Section } from "@/components/ui/page";
import { requireClient } from "@/lib/auth/dal";
import {
  ISSUE_ORIGINS,
  PLATFORMS,
  QUESTION_CATEGORIES,
  SOURCE_LIKELIHOOD,
  SOURCE_TYPES,
  VERDICTS,
  type IssueStatus,
} from "@/lib/domain/constants";
import { formatDate, formatDateTime, formatPercent, listJoin } from "@/lib/domain/format";
import { PLAYBOOK, PLAYBOOK_TIMING_NOTE } from "@/lib/domain/playbook";
import { manualTransitions, TRANSITION_ACTIONS } from "@/lib/domain/workflow";
import { assignableMembers, findVisibleIssue, getIssueDetail, type IssueDetail } from "@/lib/queries/issues";
import { addNote, assignIssue, changeStatus, dismissIssue, recheckIssue, setFixStep } from "../actions";

type Props = {
  params: Promise<{ number: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const instant = false;

function parseNumber(value: string): number {
  return /^\d{1,9}$/.test(value) ? Number(value) : NaN;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { number } = await params;
  const ctx = await requireClient();
  const issue = await findVisibleIssue(ctx, parseNumber(number));
  return { title: issue ? `${issue.title} (issue ${issue.number})` : "Issue not found" };
}

/** The margin's verdict, in words a client uses. */
function marginVerdict(verdict: IssueDetail["issue"]["verdict"]): string {
  return verdict === "confused" ? "Confused with another company" : VERDICTS[verdict].label;
}

/** The step most teams take next from each status; it gets the one primary button. */
const NEXT_STEP: Record<IssueStatus, IssueStatus | "recheck"> = {
  open: "in_progress",
  reopened: "in_progress",
  in_progress: "fixed_rechecking",
  fixed_rechecking: "recheck",
  resolved: "recheck",
};

export default async function IssuePage({ params, searchParams }: Props) {
  const ctx = await requireClient();
  const [{ number: raw }, query] = await Promise.all([params, searchParams]);
  const issue = await findVisibleIssue(ctx, parseNumber(raw));
  if (!issue) notFound();

  const requested = Array.isArray(query.platform) ? query.platform[0] : query.platform;
  const detail = await getIssueDetail(ctx, issue, requested ?? null);
  const { current, answer } = detail;
  const dismissed = Boolean(issue.dismissedAt);
  const canEdit = ctx.canEdit && !dismissed;
  const playbook = PLAYBOOK[issue.type];
  const verdictLabel = VERDICTS[issue.verdict].label;
  const platformName = current ? PLATFORMS[current.platform].name : null;
  const allPlatforms = detail.sightings.map((s) => s.platform);

  /* The answer: the latest one carrying the wrong statement, or the statement alone if no answer is stored. */
  const runs = current ? seenInRuns(current) : null;
  const fallbackRuns = seenInRuns({ runsSeen: issue.runsSeen, runsTotal: issue.runsTotal });
  const cleanAt = current && !current.answerId ? current.cleanAt : null;
  const sheetRuns = runs ?? (cleanAt ? null : fallbackRuns);
  const sheetDate = current?.seenAt ?? issue.lastSeenAt;
  const proofText = answer?.text ?? issue.wrongStatement;
  const proofMarks = answer
    ? detail.marks
    : issue.verdict === "missing"
      ? []
      : [{ start: 0, end: issue.wrongStatement.length, kind: "wrong" as const, label: verdictLabel }];
  const footnotes = detail.footnotes.map((n) => ({ n, href: `#source-${n}`, label: `Source ${n}` }));

  /* Status band. */
  const nextCheckAt = issue.nextCheckAt ?? ctx.brand.nextScanAt;
  const bandItems = [
    { label: "Status", value: <StatusMark status={issue.status} /> },
    dismissed
      ? { label: "Not an error", value: `Marked ${formatDate(issue.dismissedAt)}` }
      : issue.status === "resolved"
        ? { label: "Resolved", value: formatDate(issue.resolvedAt ?? issue.updatedAt) }
        : { label: "Next check", value: nextCheckAt ? formatDate(nextCheckAt) : "With the next scan" },
  ];
  if (!dismissed && issue.status === "resolved") {
    bandItems.push({ label: "Next check", value: nextCheckAt ? formatDate(nextCheckAt) : "With the next scan" });
  }
  const nextStep = NEXT_STEP[issue.status];
  const transitions: StatusBandTransition[] = manualTransitions(issue.status).map((to) => ({
    to,
    label: TRANSITION_ACTIONS[to] ?? to,
    variant: to === nextStep ? "primary" : to === "open" ? "quiet" : "secondary",
  }));
  const recheckNext = `TrueCite is asking ${listJoin(allPlatforms.map((id) => PLATFORMS[id].name)) || "the AI assistants"} ${
    detail.question ? `“${detail.question.text}”` : "the question"
  } again. The result appears in the history below when it finishes, usually within a few minutes.`;

  /* Facts about the issue. */
  const facts = [
    { label: "First seen", value: formatDate(issue.firstSeenAt) },
    { label: "Last seen", value: formatDate(issue.lastSeenAt) },
    {
      label: "Runs",
      value: fallbackRuns ? `${fallbackRuns} in the latest scan` : "Not recorded",
    },
    { label: "Platforms", value: allPlatforms.length ? <PlatformList platforms={allPlatforms} /> : "–" },
    { label: "Origin", value: ISSUE_ORIGINS[issue.origin].label },
    { label: "Checker confidence", value: formatPercent(issue.confidence) },
    ...(issue.category ? [{ label: "Question category", value: QUESTION_CATEGORIES[issue.category].label }] : []),
    { label: "Type of error", value: playbook.label },
  ];

  const members = assignableMembers(detail.members, issue.assigneeId);

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Issues", href: "/app/issues" }, { label: issue.title }]}
        title={issue.title}
        description={
          <>
            Issue {issue.number}
            <span aria-hidden="true"> · </span>
            <span className="sr-only">, </span>
            {playbook.label}
          </>
        }
        aside={
          <span className="flex items-center gap-2 text-ink">
            <span className="text-graphite">Severity</span>
            <SeverityMark severity={issue.severity} />
          </span>
        }
      />

      {dismissed ? (
        <Notice title="Marked as not an error" className="mb-8">
          {detail.dismissedByName ?? "Your team"} marked this on {formatDate(issue.dismissedAt)}
          {issue.dismissNote ? <>: “{issue.dismissNote}”</> : "."} It no longer counts toward the score, and this page is kept as
          a record.
        </Notice>
      ) : null}

      {/* The proof: the evidence on the left, the truth and next steps on the right. */}
      <div className="grid gap-y-8 lg:grid-cols-[minmax(0,1fr)_18.5rem] lg:grid-rows-[auto_auto_1fr] lg:gap-x-12">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          {detail.question ? (
            <>
              <p className="text-sm text-graphite">Question</p>
              <p className="mt-1 max-w-2xl text-lg text-ink">“{detail.question.text}”</p>
            </>
          ) : null}
          {detail.sightings.length > 1 && current ? (
            <div className="mt-6">
              <PlatformTabs number={issue.number} sightings={detail.sightings} current={current.platform} />
            </div>
          ) : null}
        </div>

        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <AnswerSheet
            heading={
              <>
                <span className="font-medium text-ink">{platformName ?? "AI answer"}</span>
                <span className="text-graphite">
                  {sheetRuns ? `${sheetRuns}, ` : ""}
                  {formatDate(sheetDate)}
                </span>
              </>
            }
            meta={
              answer ? (
                <>
                  Recorded {formatDateTime(answer.createdAt)}
                  <span aria-hidden="true"> · </span>
                  <span className="sr-only">, </span>
                  run {answer.runNumber}
                  <span aria-hidden="true"> · </span>
                  <span className="sr-only">, </span>
                  {answer.model}
                  {answer.settings?.webSearch ? ", web search on" : ", web search off"}
                  {answer.simulated ? ", answer from the built-in simulator" : ""}
                </>
              ) : cleanAt ? (
                `${platformName} did not repeat this in its latest answer, on ${formatDate(cleanAt)}. This is the statement as the checker recorded it before.`
              ) : (
                "The full answer is not stored for this issue. This is the statement as the checker recorded it."
              )
            }
          >
            <ProofAnswer text={proofText} marks={proofMarks} footnotes={footnotes} />
          </AnswerSheet>
          {issue.origin === "memory" ? (
            <p className="mt-4 max-w-2xl text-sm text-graphite">
              <span className="font-medium text-ink">{ISSUE_ORIGINS.memory.label}.</span>{" "}
              {footnotes.length === 0
                ? ISSUE_ORIGINS.memory.description
                : `${platformName ?? "This assistant"} cited pages here, but the error appears without citations elsewhere, so it probably comes from what the models learned during training. That usually takes longer to change.`}
            </p>
          ) : null}
          {answer && detail.marks.some((mark) => mark.kind !== "wrong") ? (
            <p className="mt-3 max-w-2xl text-sm text-graphite">
              {detail.marks.some((mark) => mark.kind === "other-wrong")
                ? "Dotted underlines are other wrong statements in this answer; each links to its own issue. "
                : ""}
              {detail.marks.some((mark) => mark.kind === "review")
                ? "Highlighted statements need review or were seen in only some runs."
                : ""}
            </p>
          ) : null}
        </div>

        <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-2">
          <MarginNote
            verdictLabel={marginVerdict(issue.verdict)}
            detail={sheetRuns ?? undefined}
            correct={issue.correctStatement}
            source={
              <Link href="/app/facts" className="underline decoration-rule-strong underline-offset-[3px] hover:text-ink hover:decoration-ink">
                {detail.fact?.validFrom ? `Fact Sheet, valid from ${formatDate(detail.fact.validFrom)}` : "Fact Sheet"}
              </Link>
            }
          >
            <div className="border-t border-rule pt-5">
              <FixSteps
                number={issue.number}
                steps={playbook.steps}
                done={issue.fixProgress}
                canEdit={canEdit}
                setFixStep={setFixStep}
              />
              <p className="mt-5 text-sm text-graphite">Common cause: {playbook.cause}</p>
              <p className="mt-3 text-xs leading-relaxed text-graphite">{PLAYBOOK_TIMING_NOTE}</p>
            </div>
          </MarginNote>
        </div>

        <div className="min-w-0 lg:col-start-1 lg:row-start-3">
          <Section
            id="sources"
            title="Sources"
            description={
              detail.sources.length
                ? "Pages the AI cited, and other pages TrueCite traced, with the most likely sources first."
                : undefined
            }
          >
            {detail.sources.length ? (
              <SourceList
                items={detail.sources.map((item) => ({
                  n: item.n,
                  url: item.url,
                  title: item.title,
                  meta: item.source
                    ? [
                        SOURCE_LIKELIHOOD[item.source.likelihood].label,
                        SOURCE_TYPES[item.source.sourceType].label,
                        item.source.publishedLabel,
                        item.source.note,
                        item.cited ? null : "Not cited in this answer",
                      ]
                    : ["Cited in this answer, not traced yet"],
                  containsStatement: item.source?.containsStatement ?? false,
                }))}
              />
            ) : (
              <p className="max-w-2xl text-graphite">
                {issue.origin === "memory"
                  ? "The answer cites no pages, so there is nothing to trace. Strengthen your official pages and trusted third-party profiles so the correct fact is easy to find."
                  : "TrueCite has not traced any pages for this issue yet. Sources appear here after the next scan."}
              </p>
            )}
          </Section>
        </div>
      </div>

      <div className="mt-14">
        <StatusBand
          number={issue.number}
          items={bandItems}
          canEdit={canEdit}
          transitions={transitions}
          recheckVariant={nextStep === "recheck" ? "primary" : "secondary"}
          recheckNext={recheckNext}
          changeStatus={changeStatus}
          recheck={recheckIssue}
        />
      </div>

      <div className="mt-12 grid gap-y-12 lg:grid-cols-[minmax(0,1fr)_18.5rem] lg:grid-rows-[auto_1fr] lg:gap-x-12">
        <div className="min-w-0 lg:col-start-2 lg:row-start-1">
          <Section title="Details" id="details">
            <div className="grid gap-6">
              {canEdit ? (
                <AssigneeForm
                  number={issue.number}
                  assigneeId={issue.assigneeId}
                  members={members.map(({ id, name }) => ({ id, name }))}
                  action={assignIssue}
                />
              ) : (
                <Details items={[{ label: "Assignee", value: detail.assigneeName ?? "Nobody" }]} />
              )}
              <Details items={facts} className="border-t border-rule pt-5" />
            </div>
          </Section>
        </div>

        <div className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <Section
            title="History"
            id="history"
            description="Oldest first. Every change, with the date, the time and who made it."
          >
            <IssueHistory events={detail.events} />
            {canEdit ? (
              <div className="mt-8 max-w-2xl">
                <NoteForm number={issue.number} action={addNote} />
              </div>
            ) : null}
          </Section>
        </div>

        {canEdit ? (
          <div className="min-w-0 lg:col-start-2 lg:row-start-2">
            <div className="border-t border-rule pt-5">
              <DismissForm number={issue.number} action={dismissIssue} />
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
