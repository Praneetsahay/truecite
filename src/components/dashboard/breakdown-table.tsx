import { Meter } from "@/components/charts/meter";
import { TextLink } from "@/components/ui/button";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatNumber } from "@/lib/domain/format";
import { displayScore } from "@/lib/domain/score";
import type { BreakdownRow } from "@/lib/queries/dashboard";

/** One row per AI platform or question category: score with a bar, statements checked, open issues. */
export function BreakdownTable<K extends string>({
  caption,
  nameHeader,
  rows,
  issuesHref,
  emptyScore = "–",
}: {
  caption: string;
  nameHeader: string;
  rows: BreakdownRow<K>[];
  /** Where the open issue count links to, such as the Issues page filtered to this row. */
  issuesHref: (key: K) => string;
  /** Shown instead of a score when nothing was checked for this row. */
  emptyScore?: string;
}) {
  return (
    <Table caption={caption}>
      <THead>
        <TR>
          <TH>{nameHeader}</TH>
          <TH numeric>
            <span className="sm:hidden">Score</span>
            <span className="hidden sm:inline">Accuracy Score</span>
          </TH>
          <TH numeric>
            <span className="sm:hidden">Checked</span>
            <span className="hidden sm:inline">Statements checked</span>
          </TH>
          <TH numeric>
            <span className="sm:hidden">Open</span>
            <span className="hidden sm:inline">Open issues</span>
          </TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => (
          <TR key={row.key}>
            <RowHead className="text-ink">{row.label}</RowHead>
            <TD numeric>
              {row.score === null ? (
                <span className="text-sm text-graphite">{emptyScore}</span>
              ) : (
                <span className="flex items-center justify-end gap-3">
                  <Meter
                    value={row.score}
                    label={`${row.label}: Accuracy Score ${displayScore(row.score)} out of 100`}
                    className="hidden w-24 sm:block lg:w-36"
                  />
                  <span className="w-7">{displayScore(row.score)}</span>
                </span>
              )}
            </TD>
            <TD numeric className={row.checked === 0 ? "text-graphite" : undefined}>
              {formatNumber(row.checked)}
            </TD>
            <TD numeric>
              {row.openIssues > 0 ? (
                <TextLink href={issuesHref(row.key)} aria-label={`${row.openIssues} open issues: ${row.label}`}>
                  {formatNumber(row.openIssues)}
                </TextLink>
              ) : (
                <span className="text-graphite">0</span>
              )}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
