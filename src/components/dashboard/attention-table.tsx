import { TextLink } from "@/components/ui/button";
import { PlatformList, SeverityMark, StatusMark } from "@/components/ui/marks";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/domain/format";
import type { DashboardIssue } from "@/lib/queries/dashboard";

/**
 * The most urgent open issues. Columns that do not fit a narrow screen move
 * into a line under the title, so nothing scrolls sideways on a phone.
 */
export function AttentionTable({ issues }: { issues: DashboardIssue[] }) {
  return (
    <Table caption="Wrong answers that need attention, most urgent first">
      <THead>
        <TR>
          <TH>Wrong answer</TH>
          <TH>Severity</TH>
          <TH className="hidden sm:table-cell">Status</TH>
          <TH className="hidden xl:table-cell">AI platforms</TH>
          <TH className="hidden md:table-cell">Last seen</TH>
        </TR>
      </THead>
      <TBody>
        {issues.map((issue) => (
          <TR key={issue.number}>
            <RowHead className="min-w-0">
              <TextLink href={`/app/issues/${issue.number}`} className="text-ink">
                {issue.title}
              </TextLink>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-graphite">
                <span className="figures">#{issue.number}</span>
                <span className="contents sm:hidden">
                  <span aria-hidden="true">·</span>
                  <StatusMark status={issue.status} />
                </span>
                <span className="contents xl:hidden">
                  <span aria-hidden="true">·</span>
                  <PlatformList platforms={issue.platforms} />
                </span>
                <span className="contents md:hidden">
                  <span aria-hidden="true">·</span>
                  <span>Last seen {formatDate(issue.lastSeenAt)}</span>
                </span>
              </p>
            </RowHead>
            <TD className="whitespace-nowrap">
              <SeverityMark severity={issue.severity} />
            </TD>
            <TD className="hidden sm:table-cell">
              <StatusMark status={issue.status} />
            </TD>
            <TD className="hidden xl:table-cell">
              <PlatformList platforms={issue.platforms} />
            </TD>
            <TD className="hidden whitespace-nowrap md:table-cell">{formatDate(issue.lastSeenAt)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
