import type { Metadata } from "next";
import { AttentionTable } from "@/components/dashboard/attention-table";
import { BreakdownTable } from "@/components/dashboard/breakdown-table";
import { ChangeList } from "@/components/dashboard/change-list";
import { CompetitorTable } from "@/components/dashboard/competitor-table";
import { RunScanForm } from "@/components/dashboard/run-scan-form";
import { ScanProgress, scanScope } from "@/components/dashboard/scan-progress";
import { ScoreBand } from "@/components/dashboard/score-band";
import { TextLink } from "@/components/ui/button";
import { EmptyState, Notice, PageHeader, Section } from "@/components/ui/page";
import { requireClient, type ClientContext } from "@/lib/auth/dal";
import { SCAN_FREQUENCIES } from "@/lib/domain/constants";
import { formatDate, formatDateTime, plural } from "@/lib/domain/format";
import { getDashboard, type DashboardData, type DashboardScan } from "@/lib/queries/dashboard";
import { runScanNow } from "./actions";

export const metadata: Metadata = { title: "Dashboard" };
export const instant = false;

/** How many entries "What changed" shows before pointing to the Issues page. */
const CHANGE_LIMIT = 10;

function nextScanLine(ctx: ClientContext): string | null {
  const { scanFrequency, nextScanAt } = ctx.brand;
  if (scanFrequency === "manual") return "Scans run only when someone on your team starts one.";
  if (!nextScanAt) return null;
  const cadence = SCAN_FREQUENCIES[scanFrequency].label.toLowerCase();
  if (nextScanAt <= ctx.now) return `Next scheduled scan starts shortly (${cadence})`;
  return `Next scheduled scan ${formatDate(nextScanAt)} (${cadence})`;
}

function HeaderDescription({ ctx, data }: { ctx: ClientContext; data: DashboardData }) {
  const { lastScan, current, activeScan } = data;
  const next = nextScanLine(ctx);
  let last: string | null = null;
  if (lastScan) last = `Last scan ${formatDate(lastScan.finishedAt ?? lastScan.createdAt)} · ${scanScope(lastScan)}`;
  else if (current) last = `Last scan ${formatDate(current.takenAt)}`;
  else if (activeScan) last = `First scan · ${scanScope(activeScan)}`;
  return (
    <>
      {last ? <p>{last}</p> : <p>No scans yet.</p>}
      {next ? <p>{next}</p> : null}
      {lastScan?.simulated ? (
        <p className="mt-1 text-sm">
          Answers in this scan came from TrueCite&apos;s simulator, because no AI provider is connected yet.
        </p>
      ) : null}
    </>
  );
}

function StoppedNotice({ scan, lastScan, canEdit }: { scan: DashboardScan; lastScan: DashboardScan | null; canEdit: boolean }) {
  const nextStep = canEdit ? "Run a scan now to try again." : "An owner or member of your team can run it again.";
  return (
    <Notice tone="attention" title={`The scan started ${formatDateTime(scan.startedAt ?? scan.createdAt)} stopped before it finished.`}>
      {lastScan ? `The figures below are from the scan on ${formatDate(lastScan.finishedAt ?? lastScan.createdAt)}. ` : null}
      {nextStep}
    </Notice>
  );
}

function FirstScan({ ctx, data }: { ctx: ClientContext; data: DashboardData }) {
  if (data.activeScan) {
    return (
      <EmptyState title="No issues yet.">
        <p>Your first scan is running, and results will appear here when it finishes.</p>
        <ScanProgress scan={data.activeScan} className="mt-6" />
      </EmptyState>
    );
  }
  if (data.stoppedScan) {
    return (
      <EmptyState title="Your first scan stopped before it finished.">
        {data.stoppedScan.error ? <p>{data.stoppedScan.error}</p> : null}
        <p>
          {ctx.canEdit
            ? "Run a scan now to try again. Results will appear here when it finishes."
            : "An owner or member of your team can run it again. Results will appear here when it finishes."}
        </p>
      </EmptyState>
    );
  }
  return (
    <EmptyState title="No scans yet.">
      {ctx.canEdit
        ? `Run a scan now to see what AI assistants say about ${ctx.brand.name}. Wrong answers, scores and trends will appear here when it finishes.`
        : `Results will appear here after the first scan. An owner or member of your team can start it.`}
    </EmptyState>
  );
}

export default async function DashboardPage() {
  const ctx = await requireClient();
  const data = await getDashboard(ctx);
  const hasResults = data.current !== null || data.lastScan !== null;

  let headerAction: React.ReactNode = null;
  if (data.activeScan) headerAction = hasResults ? <ScanProgress scan={data.activeScan} /> : null;
  else if (ctx.canEdit) headerAction = <RunScanForm action={runScanNow} />;

  return (
    <>
      <PageHeader
        title={ctx.brand.name}
        description={<HeaderDescription ctx={ctx} data={data} />}
        actions={headerAction}
      />

      {!hasResults ? (
        <FirstScan ctx={ctx} data={data} />
      ) : (
        <>
          {data.stoppedScan && !data.activeScan ? (
            <StoppedNotice scan={data.stoppedScan} lastScan={data.lastScan} canEdit={ctx.canEdit} />
          ) : null}

          <div className={data.stoppedScan && !data.activeScan ? "mt-8 pt-2 pb-2" : "pt-2 pb-2"}>
            <ScoreBand
              brandName={ctx.brand.name}
              current={data.current}
              previous={data.previous}
              openBySeverity={data.openBySeverity}
              trend={data.trend}
            />
          </div>

          <Section
            id="attention"
            title="Wrong answers that need attention"
            description="Critical and high first, then the most recently seen."
            actions={
              data.openTotal > 0 ? (
                <TextLink href="/app/issues" className="text-sm">
                  See all {plural(data.openTotal, "open issue")}
                </TextLink>
              ) : null
            }
          >
            {data.attention.length > 0 ? (
              <AttentionTable issues={data.attention} />
            ) : (
              <p className="text-graphite">
                No open wrong answers. TrueCite checks every answer again on the next scan and tells you if one appears.
              </p>
            )}
          </Section>

          <Section id="platforms" title="By AI platform" description="How accurate each assistant was in the last scan.">
            <BreakdownTable
              caption="Accuracy Score, statements checked and open issues by AI platform"
              nameHeader="AI platform"
              rows={data.byPlatform}
              issuesHref={(key) => `/app/issues?platform=${key}`}
              emptyScore="Not in the last scan"
            />
          </Section>

          <Section id="categories" title="By question category" description="Accuracy by the topic of the question.">
            {data.byCategory.length > 0 ? (
              <BreakdownTable
                caption="Accuracy Score, statements checked and open issues by question category"
                nameHeader="Question category"
                rows={data.byCategory}
                issuesHref={(key) => `/app/issues?category=${key}`}
              />
            ) : (
              <p className="text-graphite">Category results appear after the next scan.</p>
            )}
          </Section>

          <Section
            id="changes"
            title="What changed since the last scan"
            description={data.previous ? `Since the scan on ${formatDate(data.previous.takenAt)}.` : undefined}
          >
            {!data.previous ? (
              <p className="text-graphite">Changes appear here after your second scan.</p>
            ) : data.changes.length === 0 ? (
              <p className="text-graphite">
                Nothing changed: no new, resolved or reopened issues, and every platform&apos;s score held steady.
              </p>
            ) : (
              <>
                <ChangeList changes={data.changes.slice(0, CHANGE_LIMIT)} />
                {data.changes.length > CHANGE_LIMIT ? (
                  <p className="mt-3 text-sm text-graphite">
                    {plural(data.changes.length - CHANGE_LIMIT, "earlier change")} not shown. Each issue keeps its full
                    history on the <TextLink href="/app/issues">Issues</TextLink> page.
                  </p>
                ) : null}
              </>
            )}
          </Section>

          <Section
            id="competitors"
            title="Compared with competitors"
            description={
              data.competitors.length > 0
                ? `Competitor scores are estimates, because their Fact Sheets are drafted from public pages without confirmation.${
                    data.competitorsCheckedAt ? ` Last checked ${formatDate(data.competitorsCheckedAt)}.` : ""
                  }`
                : undefined
            }
            actions={
              data.competitors.length > 0 ? (
                <TextLink href="/app/competitors" className="text-sm">
                  Compare in detail
                </TextLink>
              ) : null
            }
          >
            {data.competitors.length > 0 ? (
              <CompetitorTable rows={data.competitors} />
            ) : (
              <p className="text-graphite">
                No competitors yet. <TextLink href="/app/competitors">Add competitors</TextLink> to see how accurately AI
                describes them next to {ctx.brand.name}.
              </p>
            )}
          </Section>
        </>
      )}
    </>
  );
}
