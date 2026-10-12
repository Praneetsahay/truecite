import { TrendChart } from "@/components/charts/trend-chart";
import { CountFigure, ScoreFigure } from "@/components/ui/score";
import type { ScoreSnapshot } from "@/lib/db";
import type { Severity } from "@/lib/domain/constants";
import { formatDate, plural } from "@/lib/domain/format";
import { displayScore } from "@/lib/domain/score";

type TrendRow = Pick<ScoreSnapshot, "takenAt" | "accuracyScore">;

/** The lowest gridline: zero unless every score sits well above it, then the nearest ten below the lowest score. */
function axisMin(trend: TrendRow[]): number {
  const values = trend.map((row) => row.accuracyScore).filter((value): value is number => value !== null);
  if (values.length === 0) return 0;
  const lowest = Math.min(...values);
  return Math.max(0, Math.min(60, Math.floor((lowest - 10) / 10) * 10));
}

function trendSentence(brandName: string, trend: TrendRow[]): string {
  const scored = trend.filter((row) => row.accuracyScore !== null);
  const first = scored[0];
  const last = scored[scored.length - 1];
  if (!first || !last || first === last) return `Accuracy Score for ${brandName}.`;
  return `Accuracy Score for ${brandName} over the last ${plural(trend.length, "scan")}: ${displayScore(first.accuracyScore)} on ${formatDate(first.takenAt)}, ${displayScore(last.accuracyScore)} on ${formatDate(last.takenAt)}.`;
}

/** Accuracy Score, Open risks and the trend: what leadership looks at first. */
export function ScoreBand({
  brandName,
  current,
  previous,
  openBySeverity,
  trend,
}: {
  brandName: string;
  current: ScoreSnapshot | null;
  previous: ScoreSnapshot | null;
  openBySeverity: Record<Severity, number>;
  trend: TrendRow[];
}) {
  const risks = openBySeverity.critical + openBySeverity.high;
  return (
    <section
      aria-label="Accuracy Score and open risks"
      className="grid grid-cols-2 gap-x-6 gap-y-10 sm:gap-x-12 xl:grid-cols-[12rem_11rem_minmax(0,1fr)]"
    >
      <div>
        <ScoreFigure score={current?.accuracyScore} previous={previous?.accuracyScore ?? null} />
        {current ? (
          <p className="mt-1 text-sm text-graphite">{plural(current.statementsChecked, "statement")} checked</p>
        ) : null}
      </div>
      <CountFigure
        value={risks}
        label="Open risks"
        detail={
          risks > 0
            ? `${openBySeverity.critical} critical, ${openBySeverity.high} high`
            : "No open critical or high issues"
        }
      />
      <div className="col-span-2 min-w-0 xl:col-span-1">
        <p className="text-sm text-graphite">
          {trend.length > 1 ? `Accuracy Score, last ${plural(trend.length, "scan")}` : "Accuracy Score over time"}
        </p>
        {trend.length > 1 ? (
          <TrendChart
            className="mt-2"
            label={trendSentence(brandName, trend)}
            min={axisMin(trend)}
            series={[
              {
                label: brandName,
                emphasis: true,
                points: trend.map((row) => ({ date: row.takenAt, value: row.accuracyScore })),
              },
            ]}
          />
        ) : (
          <p className="mt-2 max-w-sm text-graphite">The trend line starts after your second scan.</p>
        )}
      </div>
    </section>
  );
}
