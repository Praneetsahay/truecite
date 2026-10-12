import type { Metadata } from "next";
import { ActionButton } from "@/components/account/action-button";
import { SentimentLegend, sentimentSummary } from "@/components/account/sentiment-legend";
import { Meter, SentimentBar } from "@/components/charts/meter";
import { TrendChart } from "@/components/charts/trend-chart";
import { ExternalLink, TextLink } from "@/components/ui/button";
import { EstimateMark } from "@/components/ui/marks";
import { EmptyState, Meta, PageHeader, Section } from "@/components/ui/page";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireClient } from "@/lib/auth/dal";
import { PLANS } from "@/lib/domain/constants";
import { displayUrl, formatDate, formatPercent, plural } from "@/lib/domain/format";
import { displayScore } from "@/lib/domain/score";
import { getCompetitorComparison, type ComparisonRow } from "@/lib/queries/account";
import { cx } from "@/lib/cx";
import { removeCompetitor } from "./actions";
import { CompetitorForm } from "./competitor-form";

export const metadata: Metadata = { title: "Competitors" };

/**
 * Scores sit close together, so a 0–100 axis stacks the end labels on top of
 * each other. Zoom to the band the scores occupy, in steps of ten.
 */
function trendRange(series: { points: { value: number | null }[] }[]): { min: number; max: number } {
  const values = series.flatMap((s) => s.points.map((p) => p.value)).filter((v): v is number => v !== null);
  if (values.length === 0) return { min: 0, max: 100 };
  const min = Math.max(0, Math.floor((Math.min(...values) - 5) / 10) * 10);
  let max = Math.min(100, Math.ceil((Math.max(...values) + 5) / 10) * 10);
  if ((max - min) % 20 !== 0) max = Math.min(100, max + 10);
  return { min, max: max > min ? max : Math.min(100, min + 20) };
}

function headline(rows: ComparisonRow[], brandName: string): { lead: string; detail: string | null } | null {
  const client = rows.find((row) => row.isClient);
  const scored = rows.filter((row) => !row.isClient && row.score !== null);
  if (!client || client.score === null || scored.length === 0) return null;
  const clientScore = Math.round(client.score);
  const ahead = scored.filter((row) => Math.round(row.score ?? 0) > clientScore);
  if (ahead.length > 0) {
    const top = ahead[0];
    return {
      lead: `AI is more accurate about ${top.name} than about ${brandName}: ${displayScore(top.score)} against ${clientScore}.`,
      detail:
        ahead.length > 1
          ? `${ahead.length} of ${plural(scored.length, "competitor")} score higher than ${brandName}.`
          : null,
    };
  }
  const closest = scored[0];
  return {
    lead: `AI is more accurate about ${brandName} than about any competitor you track: ${clientScore} against ${displayScore(
      closest.score,
    )} for ${closest.name}.`,
    detail: null,
  };
}

export default async function CompetitorsPage() {
  const ctx = await requireClient();
  const data = await getCompetitorComparison(ctx);
  const plan = PLANS[ctx.organization.plan];
  const limit = plan.competitors;
  const atLimit = typeof limit === "number" && data.tracked.length >= limit;
  const summary = headline(data.rows, ctx.brand.name);
  const hasScores = data.rows.some((row) => !row.isClient && row.score !== null);

  const limitLine =
    typeof limit === "number"
      ? `${data.tracked.length} of ${limit} on the ${plan.label} plan.`
      : `${plural(data.tracked.length, "competitor")} tracked.`;

  const addForm = ctx.canEdit ? (
    atLimit ? (
      <p className="max-w-prose text-graphite">
        The {plan.label} plan includes {limit} competitors. Remove one to add another, or{" "}
        <TextLink href="/app/billing">ask to change plan</TextLink>.
      </p>
    ) : (
      <CompetitorForm />
    )
  ) : null;

  if (data.tracked.length === 0) {
    return (
      <>
        <PageHeader
          title="Competitors"
          description={`How accurately AI assistants describe ${ctx.brand.name} next to the companies buyers compare it with.`}
        />
        <EmptyState title="No competitors yet.">
          {ctx.canEdit
            ? "Add the companies buyers compare you with. TrueCite runs a lighter scan for each one on the next scan and estimates how accurately AI describes them."
            : "Members and owners can add the companies buyers compare you with. Their estimated scores then appear here after the next scan."}
        </EmptyState>
        {addForm ? (
          <Section title="Add a competitor" description={limitLine}>
            <div className="max-w-2xl">{addForm}</div>
          </Section>
        ) : null}
      </>
    );
  }

  const trendLabel =
    data.trend.length > 0
      ? `Accuracy Score over the last ${plural(data.trend[0].points.length, "scan")}. ` +
        data.trend
          .map((series) => {
            const values = series.points.map((p) => p.value).filter((v): v is number => v !== null);
            if (values.length === 0) return `${series.label}: no score yet.`;
            return `${series.label}${series.emphasis ? "" : " (estimate)"} from ${displayScore(values[0])} to ${displayScore(
              values[values.length - 1],
            )}.`;
          })
          .join(" ")
      : "";

  return (
    <>
      <PageHeader
        title="Competitors"
        description={`How accurately AI assistants describe ${ctx.brand.name} next to the companies buyers compare it with.`}
      />

      {summary ? (
        <div className="max-w-3xl pb-10">
          <p className="text-xl font-medium tracking-[-0.01em] text-ink">{summary.lead}</p>
          <p className="mt-2 text-sm text-graphite">
            {summary.detail ? `${summary.detail} ` : ""}
            {data.measuredAt ? `From the scan of ${formatDate(data.measuredAt)}. ` : ""}
            Competitor scores are estimates.
          </p>
        </div>
      ) : (
        <p className="max-w-prose pb-10 text-graphite">
          Scores appear here after the next scan. Competitors are checked with a lighter scan alongside yours.
        </p>
      )}

      <Section title="Comparison" rule={false}>
        <Table className="relative" caption={`Accuracy, share of voice and sentiment for ${ctx.brand.name} and its competitors`}>
          <THead>
            <TR>
              <TH>Company</TH>
              <TH numeric>Accuracy</TH>
              <TH className="hidden w-[22%] md:table-cell">
                <span className="sr-only">Accuracy bar</span>
              </TH>
              <TH numeric>Share of voice</TH>
              <TH className="w-[24%] min-w-40">Sentiment</TH>
            </TR>
          </THead>
          <TBody>
            {data.rows.map((row) => (
              <TR key={row.competitorId ?? "client"}>
                <RowHead className={cx("text-ink", row.isClient && "font-medium")}>
                  {row.name}
                  {row.isClient ? <Meta className="ml-2 font-normal">You</Meta> : null}
                </RowHead>
                <TD numeric>
                  {row.score === null ? (
                    <span className="text-graphite">–</span>
                  ) : (
                    <>
                      <span className={row.isClient ? "font-medium" : undefined}>{displayScore(row.score)}</span>
                      {row.estimate ? <EstimateMark className="ml-1.5 normal-nums" /> : null}
                    </>
                  )}
                </TD>
                <TD className="hidden align-middle md:table-cell">
                  <Meter
                    value={row.score}
                    muted={row.estimate}
                    label={`${row.name} accuracy${row.estimate ? ", estimated" : ""}`}
                  />
                </TD>
                <TD numeric>{formatPercent(row.shareOfVoice)}</TD>
                <TD className="align-middle">
                  {row.sentiment ? (
                    <span className="grid gap-1.5" title={sentimentSummary(row.sentiment)}>
                      <SentimentBar {...row.sentiment} />
                    </span>
                  ) : (
                    <span className="text-graphite">–</span>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <SentimentLegend className="mt-4" />
      </Section>

      {data.trend.length > 0 && hasScores ? (
        <Section
          title="Accuracy Score over time"
          description={`${ctx.brand.name} is the dark line. Competitor lines are estimates.`}
        >
          <div className="max-w-3xl">
            <TrendChart label={trendLabel} series={data.trend} height={240} {...trendRange(data.trend)} />
          </div>
        </Section>
      ) : null}

      <Section title="How competitor scores work">
        <div className="grid max-w-prose gap-3 text-graphite">
          <p>
            Competitor scores are estimates. TrueCite drafts each competitor&apos;s Fact Sheet from its public website,
            and nobody at that company confirms it, so a score can be a few points off. Competitors get a lighter scan,
            with fewer questions, on the same AI assistants as you.
          </p>
          <p>
            Share of voice is how often each company is named when people ask AI assistants about your category.
            Sentiment is whether answers about each company sound positive, neutral or negative. Both give context;
            accuracy is what TrueCite helps you fix.
          </p>
        </div>
      </Section>

      <Section
        id="tracked"
        title="Competitors you track"
        description={ctx.canEdit ? limitLine : `${limitLine} Members and owners can add or remove competitors.`}
      >
        <Table className="relative" caption="Competitors you track">
          <THead>
            <TR>
              <TH>Company</TH>
              <TH>Website</TH>
              <TH>Added</TH>
              <TH>Last scored</TH>
              {ctx.canEdit ? (
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              ) : null}
            </TR>
          </THead>
          <TBody>
            {data.tracked.map((competitor) => (
              <TR key={competitor.id}>
                <RowHead className="text-ink">{competitor.name}</RowHead>
                <TD>
                  <ExternalLink href={competitor.website} className="text-graphite">
                    {displayUrl(competitor.website)}
                  </ExternalLink>
                </TD>
                <TD className="whitespace-nowrap text-graphite">{formatDate(competitor.createdAt)}</TD>
                <TD className="whitespace-nowrap text-graphite">
                  {competitor.lastScoredAt ? formatDate(competitor.lastScoredAt) : "After the next scan"}
                </TD>
                {ctx.canEdit ? (
                  <TD className="text-right">
                    <ActionButton
                      action={removeCompetitor}
                      fields={{ id: competitor.id }}
                      label="Remove"
                      target={competitor.name}
                      className="justify-items-end"
                      confirm={{ question: `Remove ${competitor.name} and its scores?`, confirmLabel: "Remove" }}
                    />
                  </TD>
                ) : null}
              </TR>
            ))}
          </TBody>
        </Table>
        {addForm ? (
          <div className="mt-8 max-w-2xl">
            <h3 className="mb-4 text-base font-medium text-ink">Add a competitor</h3>
            {addForm}
          </div>
        ) : null}
      </Section>
    </>
  );
}

export const instant = false;
