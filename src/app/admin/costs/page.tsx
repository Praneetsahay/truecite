import type { Metadata } from "next";
import Link from "next/link";
import { MarginShare } from "@/components/admin-ops/marks";
import { MonthPicker } from "@/components/admin-business/month-picker";
import { EmptyState, PageHeader, Section } from "@/components/ui/page";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { MARGIN_LIMIT, PLANS } from "@/lib/domain/constants";
import { INR_PER_USD } from "@/lib/domain/costs";
import { formatCost, formatMoney, formatMonth, formatNumber, formatPercent, plural } from "@/lib/domain/format";
import { COST_PURPOSES, getCostsOverview, monthKeyFor, parseMonth, providerLabel } from "@/lib/queries/admin-business";

// Checks the admin session on every request, like the rest of /admin.
export const instant = false;

export const metadata: Metadata = { title: "Costs" };

const linkClass = "underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink";

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <dt className="text-sm text-graphite">{label}</dt>
      <dd className="mt-1 text-3xl font-medium tracking-[-0.02em] text-ink">{value}</dd>
      <dd className="mt-1 text-sm text-graphite">{note}</dd>
    </div>
  );
}

export default async function CostsPage({ searchParams }: PageProps<"/admin/costs">) {
  const ctx = await requireAdmin();
  const query = await searchParams;
  const month = parseMonth(query.month) ?? monthKeyFor(ctx.now);
  const data = await getCostsOverview(month, ctx.now);
  const monthLabel = formatMonth(`${month}-01`);
  const current = month === monthKeyFor(ctx.now);
  const { totals } = data;
  const share = totals.revenueUsd > 0 ? totals.clientCost / totals.revenueUsd : null;
  const hasUsage = totals.allCost > 0;

  return (
    <>
      <PageHeader
        title="Costs"
        description={`API cost for each client against what it pays. The margin rule keeps API cost under ${formatPercent(MARGIN_LIMIT)} of revenue.`}
        actions={<MonthPicker months={data.months} month={month} action="/admin/costs" />}
      />

      <dl className="grid grid-cols-2 gap-x-8 gap-y-6 border-t border-rule pt-5 sm:grid-cols-4">
        <Figure label="Revenue" value={formatMoney(totals.revenueUsd, "USD")} note={`${monthLabel}, in USD`} />
        <Figure
          label="API cost, clients"
          value={formatMoney(totals.clientCost, "USD", { cents: totals.clientCost < 100 })}
          note={current ? "So far this month" : "For the month"}
        />
        <Figure
          label="Share of revenue"
          value={formatPercent(share)}
          note={share === null ? "No revenue this month" : share > MARGIN_LIMIT ? `Over the ${formatPercent(MARGIN_LIMIT)} rule` : `Within the ${formatPercent(MARGIN_LIMIT)} rule`}
        />
        <Figure
          label="Over the limit"
          value={String(totals.overLimit)}
          note={
            totals.overLimit === 0
              ? `No client is over ${formatPercent(MARGIN_LIMIT)}`
              : `${totals.overLimit === 1 ? "Client" : "Clients"} with API cost over ${formatPercent(MARGIN_LIMIT)}`
          }
        />
      </dl>

      <Section
        className="mt-12"
        rule={false}
        title="By client"
        description={`Worst first. Revenue is the monthly subscription; rupees convert at ₹${INR_PER_USD} to the dollar. Requests are AI answers asked for the client this month. Cost per scan covers full scans (scheduled, manual and audit) with their checking and tracing.`}
      >
        {data.clients.length === 0 ? (
          <EmptyState title="No client accounts yet.">
            Costs appear here once a client signs up and its first scan runs. Prospect scans are counted separately below.
          </EmptyState>
        ) : (
          <Table caption={`API cost and revenue by client, ${monthLabel}`}>
            <THead>
              <tr>
                <TH>Client</TH>
                <TH numeric>Revenue</TH>
                <TH numeric>API cost</TH>
                <TH numeric>Share of revenue</TH>
                <TH numeric>Requests</TH>
                <TH numeric>Cost per scan</TH>
              </tr>
            </THead>
            <TBody>
              {data.clients.map((client) => (
                <TR key={client.id}>
                  <RowHead className="min-w-40">
                    <Link href={`/admin/clients/${client.id}`} className={`font-medium text-ink ${linkClass}`}>
                      {client.name}
                    </Link>
                    <span className="mt-0.5 block text-sm text-graphite">{PLANS[client.plan].label}</span>
                  </RowHead>
                  <TD numeric>
                    {client.revenue > 0 ? (
                      <>
                        {formatMoney(client.revenueUsd, "USD")}
                        {client.revenueCurrency !== "USD" ? (
                          <span className="mt-0.5 block text-sm text-graphite">{formatMoney(client.revenue, client.revenueCurrency)}</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-graphite">{client.trial ? "Trial" : "None"}</span>
                    )}
                  </TD>
                  <TD numeric>{formatCost(client.apiCost)}</TD>
                  <TD numeric>
                    <MarginShare margin={client.margin} trial={client.trial} />
                  </TD>
                  <TD numeric>{formatNumber(client.requests)}</TD>
                  <TD numeric>
                    {client.costPerScan !== null ? (
                      <>
                        {formatCost(client.costPerScan)}
                        <span className="mt-0.5 block text-sm text-graphite">{plural(client.fullScans, "scan")}</span>
                      </>
                    ) : (
                      <span className="text-graphite">No full scan</span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
            <tfoot className="border-t border-rule-strong">
              <tr>
                <th scope="row" className="py-3 pr-6 text-left font-medium text-ink">
                  All clients
                </th>
                <TD numeric className="font-medium">
                  {formatMoney(totals.revenueUsd, "USD")}
                </TD>
                <TD numeric className="font-medium">
                  {formatCost(totals.clientCost)}
                </TD>
                <TD numeric className="font-medium">
                  {formatPercent(share)}
                </TD>
                <TD numeric className="font-medium">
                  {formatNumber(totals.requests)}
                </TD>
                <TD />
              </tr>
            </tfoot>
          </Table>
        )}
        <p className="mt-4 max-w-2xl text-sm text-graphite">
          {data.internal.cost > 0 || data.internal.scans > 0
            ? `Prospect reports, which no client pays for, cost ${formatCost(data.internal.cost)} across ${plural(data.internal.scans, "prospect scan")}${data.internal.requests > 0 ? ` and ${plural(data.internal.requests, "request")}` : ""}. They are included in the breakdowns below.`
            : "No prospect scans ran this month."}
        </p>
      </Section>

      <Section
        title="When a client goes over the limit"
        description="API cost above the margin rule eats into what the client pays. Pick the change that fits the account."
      >
        <ol className="grid max-w-2xl list-decimal gap-2 pl-5 marker:text-graphite">
          <li>Ask standard questions less often, or with fewer runs per question. Key questions stay on every scan.</li>
          <li>Move the client to a higher plan that covers its question count, platforms and scan frequency.</li>
          <li>Use batch processing for scheduled scans where the provider supports it; it costs about half the normal price.</li>
        </ol>
      </Section>

      <Section
        title="By provider and model"
        description={`Every request in ${monthLabel}, including checking, source tracing and prospect scans. Costs come from the price table in Settings.`}
      >
        {!hasUsage ? (
          <EmptyState title={`No API usage in ${monthLabel}.`} className="border-t-0">
            Usage is recorded with every answer, check and source trace. Pick another month to see its costs.
          </EmptyState>
        ) : (
          <Table caption={`API cost by provider and model, ${monthLabel}`}>
            <THead>
              <tr>
                <TH>Provider</TH>
                <TH>Model</TH>
                <TH numeric>Tokens in</TH>
                <TH numeric>Tokens out</TH>
                <TH numeric>Search calls</TH>
                <TH numeric>Cost</TH>
                <TH numeric>Share</TH>
              </tr>
            </THead>
            <TBody>
              {data.byModel.map((line) => (
                <TR key={line.key}>
                  <RowHead>{providerLabel(line.provider)}</RowHead>
                  <TD className="whitespace-nowrap">{line.model}</TD>
                  <TD numeric>{formatNumber(line.tokensIn)}</TD>
                  <TD numeric>{formatNumber(line.tokensOut)}</TD>
                  <TD numeric>{formatNumber(line.searchCalls)}</TD>
                  <TD numeric>{formatCost(line.cost)}</TD>
                  <TD numeric className="text-graphite">
                    {formatPercent(line.cost / totals.allCost)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      {hasUsage ? (
        <Section title="By purpose" description="What the money was spent on.">
          <Table caption={`API cost by purpose, ${monthLabel}`}>
            <THead>
              <tr>
                <TH>Purpose</TH>
                <TH numeric>Tokens in</TH>
                <TH numeric>Tokens out</TH>
                <TH numeric>Cost</TH>
                <TH numeric>Share</TH>
              </tr>
            </THead>
            <TBody>
              {data.byPurpose.map((line) => (
                <TR key={line.purpose}>
                  <RowHead className="min-w-52">
                    {COST_PURPOSES[line.purpose].label}
                    <span className="mt-0.5 block text-sm text-graphite">{COST_PURPOSES[line.purpose].description}</span>
                  </RowHead>
                  <TD numeric>{formatNumber(line.tokensIn)}</TD>
                  <TD numeric>{formatNumber(line.tokensOut)}</TD>
                  <TD numeric>{formatCost(line.cost)}</TD>
                  <TD numeric className="text-graphite">
                    {formatPercent(line.cost / totals.allCost)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      ) : null}
    </>
  );
}
