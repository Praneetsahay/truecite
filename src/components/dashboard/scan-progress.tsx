import { Meter } from "@/components/charts/meter";
import type { PlatformId } from "@/lib/domain/constants";
import { formatDateTime, formatNumber, plural } from "@/lib/domain/format";
import type { DashboardScan } from "@/lib/queries/dashboard";
import { cx } from "@/lib/cx";
import { AutoRefresh } from "./auto-refresh";

/** "4 AI platforms · 98 questions · 3 runs each" */
export function scanScope(scan: { platforms: readonly PlatformId[]; questionCount: number; runsPerQuestion: number }): string {
  return [
    plural(scan.platforms.length, "AI platform"),
    plural(scan.questionCount, "question"),
    `${scan.runsPerQuestion} ${scan.runsPerQuestion === 1 ? "run" : "runs"} each`,
  ].join(" · ");
}

function progressLine(scan: DashboardScan): string {
  const total = formatNumber(scan.jobsTotal);
  if (scan.status === "queued") return `Scan in progress: waiting to start, ${total} answers to collect`;
  if (scan.status === "checking") return `Scan in progress: checking ${total} answers against your Fact Sheet`;
  return `Scan in progress: ${formatNumber(scan.jobsDone)} of ${total} answers collected`;
}

/** Shown in place of the run button while a full scan collects or checks answers. */
export function ScanProgress({ scan, className }: { scan: DashboardScan; className?: string }) {
  const share = scan.jobsTotal > 0 ? (100 * scan.jobsDone) / scan.jobsTotal : 0;
  return (
    <div className={cx("grid w-full gap-2 sm:w-80", className)}>
      <p className="text-base text-ink">{progressLine(scan)}</p>
      <Meter value={scan.status === "checking" ? 100 : share} label="Answers collected" />
      <p className="text-sm text-graphite">
        Started {formatDateTime(scan.startedAt ?? scan.createdAt)}. This page updates as answers come in.
      </p>
      <AutoRefresh />
    </div>
  );
}
