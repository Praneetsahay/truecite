import type { Metadata } from "next";
import { IssueFilterForm } from "@/components/issues/issue-filters";
import { IssueTable } from "@/components/issues/issue-table";
import { TextLink } from "@/components/ui/button";
import { EmptyState, FilterLinks, Notice, PageHeader } from "@/components/ui/page";
import { requireClient } from "@/lib/auth/dal";
import {
  IMPORTANCE,
  PLATFORM_IDS,
  PLATFORMS,
  QUESTION_CATEGORIES,
  QUESTION_CATEGORY_IDS,
} from "@/lib/domain/constants";
import { plural } from "@/lib/domain/format";
import {
  getDismissedIssueTitle,
  issuesHref,
  listIssues,
  parseIssueFilters,
  STATUS_GROUP_IDS,
  STATUS_GROUPS,
  type IssueFilters,
} from "@/lib/queries/issues";

export const metadata: Metadata = { title: "Issues" };
export const instant = false;

/** What an empty status tab says, and what happens next. */
const EMPTY_BY_STATUS = {
  open: {
    title: "Nothing open.",
    body: "New wrong answers appear here after each scan, once TrueCite review has confirmed them.",
  },
  in_progress: {
    title: "Nobody is working on an issue right now.",
    body: "Open an issue and choose “Start working on it” so your team knows it is taken.",
  },
  fixed: {
    title: "No fixes waiting for a re-check.",
    body: "When your team marks an issue as fixed, TrueCite re-checks it on every scan and resolves it after two clean scans in a row.",
  },
  resolved: {
    title: "No resolved issues yet.",
    body: "An issue is resolved when AI answers have been correct and consistent for two scans in a row.",
  },
  all: {
    title: "No wrong answers found yet.",
    body: "TrueCite checks every answer after each scan. Confirmed errors appear here, with the proof and the steps to fix them.",
  },
} as const;

/** How each status tab names its issues in a sentence. */
const GROUP_NOUN = {
  open: "open issues",
  in_progress: "issues in progress",
  fixed: "fixed issues waiting for a re-check",
  resolved: "resolved issues",
  all: "issues",
} as const;

function describeFilters(filters: IssueFilters): string {
  const parts = [
    filters.severity ? `with ${IMPORTANCE[filters.severity].label.toLowerCase()} severity` : null,
    filters.platform ? `seen on ${PLATFORMS[filters.platform].name}` : null,
    filters.category ? `about ${QUESTION_CATEGORIES[filters.category].label.toLowerCase()}` : null,
  ].filter(Boolean);
  return parts.join(", ");
}

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireClient();
  const params = await searchParams;
  const filters = parseIssueFilters(params);
  const dismissedParam = Number(Array.isArray(params.dismissed) ? params.dismissed[0] : params.dismissed);

  const [list, dismissedTitle] = await Promise.all([
    listIssues(ctx, filters),
    Number.isInteger(dismissedParam) && dismissedParam > 0 ? getDismissedIssueTitle(ctx, dismissedParam) : Promise.resolve(null),
  ]);

  const filtered = Boolean(filters.severity || filters.platform || filters.category);
  const platforms = PLATFORM_IDS.filter((id) => ctx.brand.platforms.includes(id) || id === filters.platform);
  const noun = GROUP_NOUN[filters.status];
  const caption = `${noun.charAt(0).toUpperCase()}${noun.slice(1)}${filtered ? `, ${describeFilters(filters)}` : ""}`;

  return (
    <>
      <PageHeader
        title="Issues"
        description={`Wrong answers AI assistants give about ${ctx.brand.name}, confirmed by TrueCite review. Open one to see the proof, the likely sources and the steps to fix it.`}
      />

      {dismissedTitle ? (
        <Notice tone="done" title={`Issue ${dismissedParam} marked as not an error`} className="mb-8">
          “{dismissedTitle}” is off your list and the score. TrueCite’s checker uses your note so the same statement is not
          flagged again.{" "}
          <TextLink href="/app/issues/not-an-error" className="text-ink">
            See issues marked not an error
          </TextLink>
        </Notice>
      ) : null}

      {list.visibleTotal === 0 ? (
        <EmptyState title={EMPTY_BY_STATUS.all.title}>
          {EMPTY_BY_STATUS.all.body} You can follow the latest scan on the{" "}
          <TextLink href="/app/dashboard">dashboard</TextLink>.
        </EmptyState>
      ) : (
        <>
          <FilterLinks
            label="Issue status"
            items={STATUS_GROUP_IDS.map((group) => ({
              label: STATUS_GROUPS[group].label,
              href: issuesHref({ ...filters, status: group }),
              active: filters.status === group,
              count: list.counts[group],
            }))}
          />

          <div className="mt-6">
            <IssueFilterForm filters={filters} platforms={platforms} categories={QUESTION_CATEGORY_IDS} />
          </div>

          <div className="mt-8">
            {list.rows.length > 0 ? (
              <>
                <p className="sr-only" role="status">
                  {plural(list.rows.length, "issue")} shown
                </p>
                <IssueTable rows={list.rows} caption={caption} />
                <p className="mt-4 text-sm text-graphite">
                  {plural(list.rows.length, "issue")}
                  {filters.status === "all" ? ", most severe first, resolved issues last" : ", most severe first"}.
                </p>
              </>
            ) : filtered ? (
              <EmptyState
                title={`No ${noun} ${describeFilters(filters)}.`}
                action={<TextLink href={issuesHref({ status: filters.status })}>Clear filters</TextLink>}
              >
                Try another severity, platform or category, or clear the filters to see all {noun}.
              </EmptyState>
            ) : (
              <EmptyState title={EMPTY_BY_STATUS[filters.status].title}>{EMPTY_BY_STATUS[filters.status].body}</EmptyState>
            )}
          </div>
        </>
      )}

      {list.dismissedCount > 0 ? (
        <p className="mt-12 border-t border-rule pt-5 text-sm text-graphite">
          {plural(list.dismissedCount, "issue")} marked as not an error by your team.{" "}
          <TextLink href="/app/issues/not-an-error" className="text-graphite hover:text-ink">
            See {list.dismissedCount === 1 ? "it" : "them"}
          </TextLink>
        </p>
      ) : null}
    </>
  );
}
