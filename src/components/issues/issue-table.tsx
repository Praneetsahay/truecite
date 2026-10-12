import { TextLink } from "@/components/ui/button";
import { PlatformList, SeverityMark, StatusMark } from "@/components/ui/marks";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/domain/format";
import type { IssueListRow } from "@/lib/queries/issues";

/**
 * The issues list. Columns that do not fit a narrow screen move into a line
 * under the title, as on the dashboard, so nothing scrolls sideways on a phone.
 */
export function IssueTable({ rows, caption }: { rows: IssueListRow[]; caption: string }) {
  return (
    <Table caption={caption}>
      <THead>
        <TR>
          <TH className="hidden pr-4 lg:table-cell">No.</TH>
          <TH className="pr-4">Issue</TH>
          <TH className="pr-4">Severity</TH>
          <TH className="hidden pr-4 sm:table-cell">Status</TH>
          <TH className="hidden pr-4 xl:table-cell">AI platforms</TH>
          <TH className="hidden pr-4 xl:table-cell">First seen</TH>
          <TH className="hidden pr-4 md:table-cell">Last seen</TH>
          <TH className="hidden xl:table-cell">Assignee</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => (
          <TR key={row.number}>
            <TD className="figures hidden pr-4 text-graphite lg:table-cell">{row.number}</TD>
            <RowHead className="pr-4 lg:min-w-[13rem]">
              <TextLink href={`/app/issues/${row.number}`} className="text-ink">
                {row.title}
              </TextLink>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-graphite xl:hidden">
                <span className="figures lg:hidden">#{row.number}</span>
                <span className="contents sm:hidden">
                  <span aria-hidden="true">·</span>
                  <StatusMark status={row.status} />
                </span>
                <span className="contents">
                  <span aria-hidden="true" className="lg:hidden">
                    ·
                  </span>
                  <PlatformList platforms={row.platforms} />
                </span>
                <span className="contents md:hidden">
                  <span aria-hidden="true">·</span>
                  <span>Last seen {formatDate(row.lastSeenAt)}</span>
                </span>
                {row.assigneeName ? (
                  <span className="contents">
                    <span aria-hidden="true">·</span>
                    <span>{row.assigneeName}</span>
                  </span>
                ) : null}
              </p>
            </RowHead>
            <TD className="pr-4 whitespace-nowrap">
              <SeverityMark severity={row.severity} />
            </TD>
            <TD className="hidden pr-4 sm:table-cell">
              <StatusMark status={row.status} />
            </TD>
            <TD className="hidden min-w-[8rem] pr-4 text-graphite xl:table-cell">
              <PlatformList platforms={row.platforms} />
            </TD>
            <TD className="hidden pr-4 whitespace-nowrap text-graphite xl:table-cell">{formatDate(row.firstSeenAt)}</TD>
            <TD className="hidden pr-4 whitespace-nowrap md:table-cell">{formatDate(row.lastSeenAt)}</TD>
            <TD className="hidden whitespace-nowrap xl:table-cell">
              {row.assigneeName ?? <span className="text-graphite">Nobody</span>}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
