import { TrendChart } from "@/components/charts/trend-chart";
import { Meter, SentimentBar } from "@/components/charts/meter";
import { ProofAnswer } from "@/components/proof/proof-answer";
import { PlatformList, SeverityMark, StatusMark } from "@/components/ui/marks";
import { Delta } from "@/components/ui/score";
import { PLATFORMS, REPORT_TYPES } from "@/lib/domain/constants";
import { formatDate, formatPercent, plural } from "@/lib/domain/format";
import type { ReportData, ReportFinding } from "@/lib/domain/report";
import { displayScore, scoreDelta } from "@/lib/domain/score";
import { cx } from "@/lib/cx";

/*
  A report reads like a document under review: Newsreader for the prose and
  quoted answers, Schibsted Grotesk for figures and tables. It renders the same
  on the web and in print.
*/

function ReportSection({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx("border-t border-rule pt-6 break-inside-avoid-page", className)}>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Finding({ finding, index }: { finding: ReportFinding; index: number }) {
  const answer = finding.answer;
  return (
    <article className="grid gap-5 border-t border-rule pt-6 first:border-t-0 first:pt-0 break-inside-avoid">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <h3 className="text-lg font-medium text-ink">
          <span className="figures mr-2 text-graphite">{index + 1}.</span>
          {finding.title}
        </h3>
        <div className="flex shrink-0 items-center gap-5 text-sm">
          <SeverityMark severity={finding.severity} />
          <StatusMark status={finding.status} />
        </div>
      </header>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0">
          <p className="text-sm text-graphite">
            Asked “{finding.question}” · <PlatformList platforms={finding.platforms} />
          </p>
          {answer ? (
            <div className="mt-3 rounded-md border border-rule bg-sheet px-5 py-4">
              <p className="mb-2 text-sm text-graphite">{PLATFORMS[answer.platform].name} said</p>
              <ProofAnswer
                size="sm"
                text={answer.text}
                marks={[{ start: answer.wrongStart, end: answer.wrongEnd, kind: "wrong", label: "Incorrect" }]}
              />
            </div>
          ) : (
            <p className="mt-3 font-serif text-base text-ink">“{finding.wrong}”</p>
          )}
          {finding.likelySources.length > 0 ? (
            <div className="mt-4">
              <p className="text-sm text-graphite">Likely sources</p>
              <ul className="mt-1 grid gap-0.5 text-sm text-ink">
                {finding.likelySources.map((source) => (
                  <li key={source} className="break-words">
                    {source}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="border-l border-rule-strong pl-5">
          <p className="text-sm font-medium text-verified">Correct</p>
          <p className="mt-1 font-serif text-lg leading-snug text-ink">{finding.correct}</p>
          {finding.fix.length > 0 ? (
            <>
              <p className="mt-5 text-sm text-graphite">Fix steps</p>
              <ol className="mt-1 grid list-decimal gap-1 pl-4 text-sm text-ink marker:text-graphite">
                {finding.fix.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function ReportDocument({ data, className }: { data: ReportData; className?: string }) {
  const delta = scoreDelta(data.score.current, data.score.previous);
  const openRisks = data.openRisks.critical + data.openRisks.high;
  const client = data.competitors.find((c) => c.isClient);

  return (
    <article className={cx("mx-auto w-full max-w-3xl", className)}>
      <header className="pb-8">
        <p className="text-sm text-graphite">
          TrueCite · {REPORT_TYPES[data.type].label}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em] text-ink">
          {data.brandName}, {data.periodLabel}
        </h1>
        <p className="mt-2 text-sm text-graphite">
          {data.website} · Prepared {formatDate(data.generatedAt)}
        </p>
        <p className="mt-6 font-serif text-xl leading-relaxed text-ink [font-optical-sizing:auto]">{data.summary}</p>
      </header>

      <div className="grid gap-12">
        <ReportSection title="Accuracy">
          <div className="grid gap-8 sm:grid-cols-[13rem_minmax(0,1fr)]">
            <div className="grid content-start gap-6">
              <div>
                <p className="text-sm text-graphite">Accuracy Score</p>
                <p className="mt-1 flex items-baseline gap-1.5">
                  <span className="figures text-5xl font-medium tracking-[-0.03em]">{displayScore(data.score.current)}</span>
                  <span className="text-graphite">/100</span>
                </p>
                {delta !== null ? <Delta value={delta} suffix="since the previous report" className="mt-1.5" /> : null}
              </div>
              <div>
                <p className="text-sm text-graphite">Open risks</p>
                <p className="figures mt-1 text-3xl font-medium tracking-[-0.02em]">{openRisks}</p>
                <p className="mt-1 text-sm text-graphite">
                  {data.openRisks.critical} critical, {data.openRisks.high} high
                </p>
              </div>
            </div>
            {data.score.trend.length > 1 ? (
              <TrendChart
                label={`Accuracy Score over the period, from ${displayScore(data.score.trend[0].score)} to ${displayScore(
                  data.score.trend[data.score.trend.length - 1].score,
                )}`}
                series={[
                  {
                    label: data.brandName,
                    emphasis: true,
                    points: data.score.trend.map((p) => ({ date: p.date, value: p.score })),
                  },
                ]}
              />
            ) : null}
          </div>
          <table className="mt-8 w-full border-collapse text-left text-md">
            <caption className="sr-only">Accuracy by AI platform</caption>
            <thead className="border-b border-rule-strong">
              <tr>
                <th scope="col" className="py-2 pr-6 text-sm font-normal text-graphite">
                  AI platform
                </th>
                <th scope="col" className="py-2 pr-6 text-right text-sm font-normal text-graphite">
                  Score
                </th>
                <th scope="col" className="hidden w-1/3 py-2 pr-6 sm:table-cell">
                  <span className="sr-only">Score bar</span>
                </th>
                <th scope="col" className="py-2 text-right text-sm font-normal text-graphite">
                  Open issues
                </th>
              </tr>
            </thead>
            <tbody>
              {data.byPlatform.map((row) => (
                <tr key={row.platform} className="border-b border-rule last:border-b-0">
                  <th scope="row" className="py-2.5 pr-6 font-normal">
                    {PLATFORMS[row.platform].name}
                  </th>
                  <td className="figures py-2.5 pr-6 text-right">{displayScore(row.score)}</td>
                  <td className="hidden py-2.5 pr-6 align-middle sm:table-cell">
                    <Meter value={row.score} label={`${PLATFORMS[row.platform].name} accuracy`} />
                  </td>
                  <td className="figures py-2.5 text-right">{row.openIssues}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ReportSection>

        <ReportSection title="Top open risks">
          {data.topRisks.length > 0 ? (
            <div className="grid gap-8">
              {data.topRisks.map((finding, index) => (
                <Finding key={`${finding.title}-${index}`} finding={finding} index={index} />
              ))}
            </div>
          ) : (
            <p className="font-serif text-lg text-ink">No critical or high issues are open.</p>
          )}
        </ReportSection>

        <ReportSection title="Fixed this period">
          {data.fixed.length > 0 ? (
            <ul className="grid gap-2">
              {data.fixed.map((item) => (
                <li key={item.title} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                  <span className="text-ink">{item.title}</span>
                  <span className="shrink-0 text-sm text-graphite">
                    Resolved {formatDate(item.resolvedOn)} · <PlatformList platforms={item.platforms} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-graphite">No issues were resolved in this period.</p>
          )}
        </ReportSection>

        <ReportSection title="What comes next">
          <ol className="grid list-decimal gap-2 pl-5 font-serif text-lg leading-relaxed text-ink marker:font-sans marker:text-base marker:text-graphite">
            {data.nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </ReportSection>

        {data.competitors.length > 0 ? (
          <ReportSection title="Compared with competitors">
            <table className="w-full border-collapse text-left text-md">
              <caption className="sr-only">Accuracy, share of voice and sentiment compared with competitors</caption>
              <thead className="border-b border-rule-strong">
                <tr>
                  <th scope="col" className="py-2 pr-6 text-sm font-normal text-graphite">
                    Company
                  </th>
                  <th scope="col" className="py-2 pr-6 text-right text-sm font-normal text-graphite">
                    Accuracy
                  </th>
                  <th scope="col" className="py-2 pr-6 text-right text-sm font-normal text-graphite">
                    Share of voice
                  </th>
                  <th scope="col" className="hidden w-1/4 py-2 text-sm font-normal text-graphite sm:table-cell">
                    Sentiment
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.competitors.map((row) => (
                  <tr key={row.name} className="border-b border-rule last:border-b-0">
                    <th scope="row" className={cx("py-2.5 pr-6 font-normal", row.isClient && "font-medium")}>
                      {row.name}
                    </th>
                    <td className="figures py-2.5 pr-6 text-right whitespace-nowrap">
                      {displayScore(row.score)}
                      {row.estimate ? <span className="ml-1 text-sm text-graphite">est.</span> : null}
                    </td>
                    <td className="figures py-2.5 pr-6 text-right">{formatPercent(row.shareOfVoice)}</td>
                    <td className="hidden py-2.5 align-middle sm:table-cell">
                      {row.sentiment ? <SentimentBar {...row.sentiment} /> : <span className="text-graphite">–</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {client && data.competitors.some((c) => !c.isClient && (c.score ?? 0) > (client.score ?? 0)) ? (
              <p className="mt-4 text-sm text-graphite">
                Competitor scores are estimates, because their Fact Sheets are drafted from public pages without
                confirmation.
              </p>
            ) : null}
          </ReportSection>
        ) : null}

        <ReportSection title="Method">
          <div className="grid gap-3 text-sm text-graphite">
            <p>
              {formatDate(data.method.from)} to {formatDate(data.method.to)}. {plural(data.method.questions, "question")} asked{" "}
              {plural(data.method.runsPerQuestion, "time")} each on <PlatformList platforms={data.method.platforms} />, across{" "}
              {plural(data.method.scans, "scan")}.
            </p>
            {data.method.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        </ReportSection>
      </div>
    </article>
  );
}
