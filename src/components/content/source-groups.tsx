import Link from "next/link";
import { PlatformList } from "@/components/ui/marks";
import { Table, TH, THead, TR } from "@/components/ui/table";
import { SOURCE_TYPES } from "@/lib/domain/constants";
import { displayUrl, formatDate, plural } from "@/lib/domain/format";
import type { SourceGroup, SourceIssue, SourcePage } from "@/lib/queries/content";
import { cx } from "@/lib/cx";

/*
  Sources grouped by website. Each website is one row with the issues it feeds;
  its pages open underneath, so links stay out of the disclosure button.
*/

const link = "underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink";

function IssueLink({ issue }: { issue: SourceIssue }) {
  return (
    <Link
      href={`/app/issues/${issue.number}`}
      className={cx("figures", link, issue.open ? "text-ink" : "text-graphite")}
      title={issue.title}
    >
      {issue.number}
      <span className="sr-only">: {issue.title}</span>
    </Link>
  );
}

/** Open issues first; resolved ones follow under their own word, not only a lighter color. */
function IssueLinks({ issues, className }: { issues: SourceIssue[]; className?: string }) {
  const open = issues.filter((issue) => issue.open);
  const resolved = issues.filter((issue) => !issue.open);
  return (
    <span className={cx("inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5", className)}>
      {open.map((issue) => (
        <IssueLink key={issue.number} issue={issue} />
      ))}
      {resolved.length > 0 ? (
        <span className="inline-flex flex-wrap items-baseline gap-x-2 text-graphite">
          <span className="text-sm">{open.length > 0 ? "· resolved" : "Resolved"}</span>
          {resolved.map((issue) => (
            <IssueLink key={issue.number} issue={issue} />
          ))}
        </span>
      ) : null}
    </span>
  );
}

function ContainsMark({ contains }: { contains: boolean }) {
  if (!contains) return <span className="text-graphite">Wrong statement not found on the page</span>;
  return (
    <span className="inline-flex items-center gap-2 text-ink">
      <span aria-hidden="true" className="inline-block h-[2px] w-3 shrink-0 bg-correction" />
      Contains the wrong statement
    </span>
  );
}

function PageItem({ page }: { page: SourcePage }) {
  const meta = [
    page.publishedLabel ? `Published ${page.publishedLabel}` : null,
    page.note,
    page.likely ? "Likely source" : null,
  ].filter(Boolean) as string[];
  return (
    <li className="grid gap-x-8 gap-y-1.5 border-t border-rule py-4 first:border-t-0 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <a href={page.url} target="_blank" rel="noopener noreferrer" className={cx("break-words text-ink", link)}>
          {displayUrl(page.url)}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        {page.title ? <p className="mt-0.5 text-sm text-graphite">{page.title}</p> : null}
        {meta.length > 0 ? <p className="mt-1 text-sm text-graphite">{meta.join(" · ")}</p> : null}
      </div>
      <div className="grid content-start gap-1 text-sm">
        <ContainsMark contains={page.containsStatement} />
        <p className="text-graphite">
          {page.citedBy.length > 0 ? (
            <>
              Cited by <PlatformList platforms={page.citedBy} />
            </>
          ) : (
            "Not cited directly"
          )}
          {" · "}
          {page.checkedAt ? `Checked ${formatDate(page.checkedAt)}` : "Not checked yet"}
        </p>
        <p className="text-graphite">
          {page.issues.some((issue) => issue.open) ? (page.issues.length === 1 ? "Issue " : "Issues ") : "Issue: "}
          <IssueLinks issues={page.issues} />
        </p>
      </div>
    </li>
  );
}

export function SourceGroupTable({ groups }: { groups: SourceGroup[] }) {
  return (
    <Table caption="Sources by website, the ones that feed the most open issues first">
      <THead>
        <TR>
          <TH className="pr-4">Website</TH>
          <TH className="hidden pr-4 md:table-cell">Type</TH>
          <TH numeric className="hidden pr-4 sm:table-cell">
            Pages
          </TH>
          <TH numeric className="hidden pr-4 sm:table-cell">
            With the wrong statement
          </TH>
          <TH className="pl-2">Issues</TH>
        </TR>
      </THead>
      {groups.map((group) => {
        const anchor = `site-${group.domain.replace(/[^a-z0-9]+/gi, "-")}`;
        return (
          <tbody key={group.domain} id={anchor} className="scroll-mt-24 border-b border-rule last:border-b-0">
            <tr>
              <th scope="row" className="pt-3 pr-4 text-left align-top font-normal">
                <span className="font-medium break-all text-ink">{group.domain}</span>
                <span className="mt-0.5 block text-sm text-graphite md:hidden">
                  {SOURCE_TYPES[group.sourceType].label}
                  <span className="sm:hidden">
                    {" · "}
                    {plural(group.pages.length, "page")}, {group.pagesWithStatement} with the wrong statement
                  </span>
                </span>
              </th>
              <td className="hidden pt-3 pr-4 align-top md:table-cell">{SOURCE_TYPES[group.sourceType].label}</td>
              <td className="figures hidden pt-3 pr-4 text-right align-top sm:table-cell">{group.pages.length}</td>
              <td className="figures hidden pt-3 pr-4 text-right align-top sm:table-cell">
                {group.pagesWithStatement > 0 ? group.pagesWithStatement : <span className="text-graphite">0</span>}
              </td>
              <td className="pt-3 pl-2 align-top">
                <IssueLinks issues={group.issues} />

              </td>
            </tr>
            <tr>
              <td colSpan={5} className="pt-1 pb-3">
                <details className="group">
                  <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-sm text-graphite hover:text-ink [&::-webkit-details-marker]:hidden">
                    <svg
                      aria-hidden="true"
                      width="10"
                      height="10"
                      viewBox="0 0 10 10"
                      className="shrink-0 transition-transform group-open:rotate-90"
                    >
                      <path d="M3.5 2 6.5 5 3.5 8" fill="none" stroke="currentColor" strokeWidth="1.4" />
                    </svg>
                    <span className="group-open:hidden">
                      Show {plural(group.pages.length, "page")}
                      <span className="sr-only"> on {group.domain}</span>
                    </span>
                    <span className="hidden group-open:inline">
                      Hide pages<span className="sr-only"> on {group.domain}</span>
                    </span>
                  </summary>
                  <ul className="mt-3 mb-1 border-l border-rule pl-4 sm:ml-1">
                    {group.pages.map((page) => (
                      <PageItem key={page.url} page={page} />
                    ))}
                  </ul>
                </details>
              </td>
            </tr>
          </tbody>
        );
      })}
    </Table>
  );
}
