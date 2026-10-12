import type { Metadata } from "next";
import { TextLink } from "@/components/ui/button";
import { PlatformList, SeverityMark } from "@/components/ui/marks";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireClient } from "@/lib/auth/dal";
import { formatDate } from "@/lib/domain/format";
import { listDismissedIssues } from "@/lib/queries/issues";

export const metadata: Metadata = { title: "Not an error" };
export const instant = false;

export default async function NotAnErrorPage() {
  const ctx = await requireClient();
  const rows = await listDismissedIssues(ctx);

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Issues", href: "/app/issues" }, { label: "Not an error" }]}
        title="Marked as not an error"
        description="Findings your team dismissed, with who did it and why. They no longer count toward the score, and TrueCite’s checker uses the notes so the same statement is not flagged again."
      />

      {rows.length === 0 ? (
        <EmptyState title="Your team has not dismissed any issues." action={<TextLink href="/app/issues">Back to issues</TextLink>}>
          If TrueCite flags something that is actually correct, open the issue and choose “Not an error” with a short note.
          It moves here, and the checker learns from it.
        </EmptyState>
      ) : (
        <Table caption="Issues marked as not an error, most recent first">
          <THead>
            <TR>
              <TH className="hidden pr-4 lg:table-cell">No.</TH>
              <TH className="pr-4">Issue</TH>
              <TH className="hidden pr-4 md:table-cell">Marked</TH>
              <TH className="hidden pr-4 md:table-cell">By</TH>
              <TH className="hidden md:table-cell">Note</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.number}>
                <TD className="figures hidden pr-4 text-graphite lg:table-cell">{row.number}</TD>
                <RowHead className="pr-4 md:min-w-[14rem]">
                  <TextLink href={`/app/issues/${row.number}`} className="text-ink">
                    {row.title}
                  </TextLink>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-graphite">
                    <span className="figures lg:hidden">#{row.number}</span>
                    <span aria-hidden="true" className="lg:hidden">
                      ·
                    </span>
                    <SeverityMark severity={row.severity} />
                    <span aria-hidden="true">·</span>
                    <PlatformList platforms={row.platforms} />
                  </p>
                  <div className="mt-2 grid gap-1 md:hidden">
                    <p className="text-sm text-graphite">
                      Marked by {row.dismissedByName}, {formatDate(row.dismissedAt)}
                    </p>
                    {row.dismissNote ? <p className="text-ink">{row.dismissNote}</p> : null}
                  </div>
                </RowHead>
                <TD className="hidden pr-4 whitespace-nowrap md:table-cell">{formatDate(row.dismissedAt)}</TD>
                <TD className="hidden pr-4 whitespace-nowrap md:table-cell">{row.dismissedByName}</TD>
                <TD className="hidden max-w-md md:table-cell">
                  {row.dismissNote ?? <span className="text-graphite">No note</span>}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
