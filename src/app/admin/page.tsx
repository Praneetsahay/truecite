import type { Metadata } from "next";
import Link from "next/link";
import { HealthMark, MarginShare, ScanStatusLabel } from "@/components/admin-ops/marks";
import { EmptyState, FilterLinks, PageHeader, Section } from "@/components/ui/page";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { MARGIN_LIMIT, MARKETS, PLANS } from "@/lib/domain/constants";
import { INR_PER_USD } from "@/lib/domain/costs";
import { formatCost, formatDate, formatMoney, formatPercent, formatRelative } from "@/lib/domain/format";
import { displayScore } from "@/lib/domain/score";
import { getClients } from "@/lib/queries/admin-ops";

export const instant = false;

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: PageProps<"/admin">) {
  const ctx = await requireAdmin();
  const { show } = await searchParams;
  const clients = await getClients(ctx.now);
  const attention = clients.filter((client) => !client.health.healthy);
  const onlyAttention = show === "attention";
  const rows = onlyAttention ? attention : clients;

  const revenueUsd = clients.reduce((sum, client) => sum + client.revenueUsd, 0);
  const apiCost = clients.reduce((sum, client) => sum + client.apiCost30, 0);
  const paying = clients.filter((client) => client.revenueUsd > 0).length;
  const overLimit = clients.filter((client) => client.margin.overLimit).length;

  return (
    <>
      <PageHeader
        title="Clients"
        description="Every client account, what it pays and what it costs to run. Accounts that need attention come first."
      />

      {clients.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-8 gap-y-6 border-t border-rule pt-5 sm:grid-cols-4">
          <div>
            <dt className="text-sm text-graphite">Clients</dt>
            <dd className="mt-1 text-3xl font-medium tracking-[-0.02em] text-ink">{clients.length}</dd>
            <dd className="mt-1 text-sm text-graphite">{paying} paying</dd>
          </div>
          <div>
            <dt className="text-sm text-graphite">Revenue a month</dt>
            <dd className="mt-1 text-3xl font-medium tracking-[-0.02em] text-ink">{formatMoney(revenueUsd, "USD")}</dd>
            <dd className="mt-1 text-sm text-graphite">In USD</dd>
          </div>
          <div>
            <dt className="text-sm text-graphite">API cost, last 30 days</dt>
            <dd className="mt-1 text-3xl font-medium tracking-[-0.02em] text-ink">{formatMoney(apiCost, "USD")}</dd>
            <dd className="mt-1 text-sm text-graphite">
              {revenueUsd > 0 ? `${formatPercent(apiCost / revenueUsd)} of revenue` : "No revenue yet"}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-graphite">Need attention</dt>
            <dd className="mt-1 text-3xl font-medium tracking-[-0.02em] text-ink">{attention.length}</dd>
            <dd className="mt-1 text-sm text-graphite">
              {overLimit > 0 ? `${overLimit} over the ${formatPercent(MARGIN_LIMIT)} cost rule` : `All within the ${formatPercent(MARGIN_LIMIT)} cost rule`}
            </dd>
          </div>
        </dl>
      ) : null}

      <Section
        className="mt-12"
        rule={false}
        title="Accounts"
        description={`Revenue is the monthly subscription in the client's currency; rupees convert at ₹${INR_PER_USD} to the dollar. API cost covers the last 30 days. The cost rule keeps it under ${formatPercent(MARGIN_LIMIT)} of revenue.`}
      >
        {clients.length === 0 ? (
          <EmptyState title="No client accounts yet.">
            Accounts appear here when someone signs up or a prospect becomes a client. Free check requests and prospects are
            on the Prospects page.
          </EmptyState>
        ) : (
          <>
            <FilterLinks
              label="Show"
              className="mb-2"
              items={[
                { label: "All clients", href: "/admin", active: !onlyAttention, count: clients.length },
                { label: "Needs attention", href: "/admin?show=attention", active: onlyAttention, count: attention.length },
              ]}
            />
            {rows.length === 0 ? (
              <EmptyState title="Every account is healthy." className="border-t-0">
                Payments are up to date, costs are within the rule and the latest scans finished without failed jobs.
              </EmptyState>
            ) : (
              <Table caption="Client accounts">
                <THead>
                  <tr>
                    <TH>Client</TH>
                    <TH numeric>Revenue</TH>
                    <TH numeric>In USD</TH>
                    <TH numeric>API cost</TH>
                    <TH numeric>Cost share</TH>
                    <TH numeric>Score</TH>
                    <TH numeric>Open issues</TH>
                    <TH numeric>To review</TH>
                    <TH>Last scan</TH>
                    <TH>Health</TH>
                  </tr>
                </THead>
                <TBody>
                  {rows.map((client) => {
                    const trial = client.subscription?.status === "trialing" || client.plan === "trial";
                    return (
                      <TR key={client.id}>
                        <RowHead className="min-w-40">
                          <Link
                            href={`/admin/clients/${client.id}`}
                            className="font-medium text-ink underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink"
                          >
                            {client.name}
                          </Link>
                          <span className="mt-0.5 block text-sm text-graphite">
                            {PLANS[client.plan].label} · {MARKETS[client.country].label}
                          </span>
                        </RowHead>
                        <TD numeric>
                          {client.revenue > 0 ? (
                            formatMoney(client.revenue, client.revenueCurrency)
                          ) : (
                            <span className="text-graphite">{trial ? "Trial" : "None"}</span>
                          )}
                        </TD>
                        <TD numeric className="text-graphite">
                          {client.revenue > 0 ? formatMoney(client.revenueUsd, "USD") : "–"}
                        </TD>
                        <TD numeric>{formatCost(client.apiCost30)}</TD>
                        <TD numeric>
                          <MarginShare margin={client.margin} trial={trial} />
                        </TD>
                        <TD numeric>{displayScore(client.score)}</TD>
                        <TD numeric>{client.openIssues}</TD>
                        <TD numeric>
                          {client.pendingReview > 0 ? (
                            <Link
                              href="/admin/review"
                              aria-label={`${client.pendingReview} waiting for review`}
                              className="underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink"
                            >
                              {client.pendingReview}
                            </Link>
                          ) : (
                            <span className="text-graphite">0</span>
                          )}
                        </TD>
                        <TD className="whitespace-nowrap">
                          {client.lastScan ? (
                            <>
                              <Link
                                href={`/admin/scans/${client.lastScan.id}`}
                                className="underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink"
                                title={formatDate(client.lastScan.startedAt ?? client.lastScan.createdAt)}
                              >
                                {formatRelative(client.lastScan.startedAt ?? client.lastScan.createdAt, ctx.now)}
                              </Link>
                              {client.lastScan.status !== "completed" ? (
                                <ScanStatusLabel status={client.lastScan.status} className="mt-0.5 block text-sm" />
                              ) : null}
                            </>
                          ) : (
                            <span className="text-graphite">None yet</span>
                          )}
                        </TD>
                        <TD className="min-w-44">
                          <HealthMark health={client.health} />
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </>
        )}
      </Section>
    </>
  );
}
