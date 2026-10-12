import { Meter } from "@/components/charts/meter";
import { EstimateMark } from "@/components/ui/marks";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatPercent } from "@/lib/domain/format";
import { displayScore } from "@/lib/domain/score";
import type { CompetitorRow } from "@/lib/queries/dashboard";
import { cx } from "@/lib/cx";

/** The client next to its competitors. Accuracy leads; share of voice is context. */
export function CompetitorTable({ rows }: { rows: CompetitorRow[] }) {
  return (
    <Table caption="Accuracy Score and share of voice compared with competitors">
      <THead>
        <TR>
          <TH>Company</TH>
          <TH numeric>
            <span className="sm:hidden">Score</span>
            <span className="hidden sm:inline">Accuracy Score</span>
          </TH>
          <TH numeric>Share of voice</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => (
          <TR key={row.name}>
            <RowHead className="text-ink">
              <span className={row.isClient ? "font-medium" : undefined}>{row.name}</span>
              {row.isClient ? <span className="ml-2 text-sm text-graphite">You</span> : null}
            </RowHead>
            <TD numeric>
              <span className="flex items-center justify-end gap-3">
                {row.score !== null ? (
                  <Meter
                    value={row.score}
                    muted={!row.isClient}
                    label={`${row.name}: Accuracy Score ${displayScore(row.score)} out of 100${row.isClient ? "" : ", estimated"}`}
                    className="hidden w-24 sm:block lg:w-36"
                  />
                ) : null}
                <span className={cx("w-7", row.isClient && "font-medium")}>{displayScore(row.score)}</span>
                <span className="w-6 text-left [font-variant-numeric:normal]">{row.isClient || row.score === null ? null : <EstimateMark />}</span>
              </span>
            </TD>
            <TD numeric className={row.isClient ? "text-ink" : "text-graphite"}>
              {formatPercent(row.shareOfVoice)}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
