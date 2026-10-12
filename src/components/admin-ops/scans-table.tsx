import Link from "next/link";
import { PlatformList } from "@/components/ui/marks";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { SCAN_TYPES } from "@/lib/domain/constants";
import { formatCost, formatDateTime, formatNumber } from "@/lib/domain/format";
import { ACTIVE_SCAN_STATUSES, formatDuration, scanDuration, type AdminScanRow } from "@/lib/queries/admin-ops";
import { ScanStatusLabel } from "./marks";

const linkClass = "underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink";

function isActive(status: AdminScanRow["status"]): boolean {
  return (ACTIVE_SCAN_STATUSES as readonly string[]).includes(status);
}

/** Finished scans: one row per scan, linking to its jobs and answers. */
export function ScansTable({
  scans,
  now,
  showClient = true,
  caption,
}: {
  scans: AdminScanRow[];
  now: Date;
  showClient?: boolean;
  caption: string;
}) {
  return (
    <Table caption={caption}>
      <THead>
        <tr>
          <TH>{showClient ? "Client" : "Scan"}</TH>
          <TH>Status</TH>
          <TH>Platforms</TH>
          <TH numeric>Questions × runs</TH>
          <TH>Started</TH>
          <TH numeric>Duration</TH>
          <TH numeric>Cost</TH>
          <TH numeric>Failed jobs</TH>
        </tr>
      </THead>
      <TBody>
        {scans.map((scan) => {
          const started = scan.startedAt ?? scan.createdAt;
          return (
            <TR key={scan.id}>
              <RowHead className="min-w-36">
                <Link href={`/admin/scans/${scan.id}`} className={`font-medium text-ink ${linkClass}`}>
                  {showClient ? (scan.internal ? scan.brandName : scan.organizationName) : SCAN_TYPES[scan.type].label}
                  <span className="sr-only">, scan started {formatDateTime(started)}</span>
                </Link>
                {showClient ? (
                  <span className="mt-0.5 block text-sm text-graphite">
                    {SCAN_TYPES[scan.type].label}
                    {!scan.internal && scan.brandName !== scan.organizationName ? ` · ${scan.brandName}` : ""}
                  </span>
                ) : null}
              </RowHead>
              <TD>
                <ScanStatusLabel status={scan.status} />
                {scan.simulated ? <span className="mt-0.5 block text-sm text-graphite">Simulated</span> : null}
              </TD>
              <TD className="min-w-40">
                <PlatformList platforms={scan.platforms} />
              </TD>
              <TD numeric>
                {formatNumber(scan.questionCount)} × {scan.runsPerQuestion}
              </TD>
              <TD className="whitespace-nowrap">{formatDateTime(started)}</TD>
              <TD numeric>
                {scan.finishedAt ? (
                  formatDuration(scanDuration(scan, now))
                ) : isActive(scan.status) && scan.startedAt ? (
                  <span className="text-graphite">{formatDuration(scanDuration(scan, now))} so far</span>
                ) : (
                  <span className="text-graphite">–</span>
                )}
              </TD>
              <TD numeric>{formatCost(scan.totalCostUsd)}</TD>
              <TD numeric>
                {scan.failedJobs > 0 ? (
                  <span className="font-medium text-ink">{formatNumber(scan.failedJobs)}</span>
                ) : (
                  <span className="text-graphite">0</span>
                )}
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
