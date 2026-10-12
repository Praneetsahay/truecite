import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HealthMark, MarginShare } from "@/components/admin-ops/marks";
import { ScansTable } from "@/components/admin-ops/scans-table";
import { ButtonLink, ExternalLink } from "@/components/ui/button";
import { PlatformList } from "@/components/ui/marks";
import { Details, EmptyState, Notice, PageHeader, Section } from "@/components/ui/page";
import { SubmitButton } from "@/components/ui/submit-button";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import {
  INVOICE_STATUSES,
  MARKETS,
  ONBOARDING_STEPS,
  PLANS,
  ROLES,
  SCAN_FREQUENCIES,
  SUBSCRIPTION_STATUSES,
} from "@/lib/domain/constants";
import { marginCheck } from "@/lib/domain/costs";
import {
  displayUrl,
  formatCost,
  formatDate,
  formatDateTime,
  formatMoney,
  formatMonth,
  formatNumber,
  formatPercent,
  formatRelative,
  listJoin,
  plural,
} from "@/lib/domain/format";
import { displayScore } from "@/lib/domain/score";
import { getClientDetail, getClientOrganization } from "@/lib/queries/admin-ops";
import { viewAsClient } from "./actions";

export const instant = false;

export async function generateMetadata({ params }: PageProps<"/admin/clients/[id]">): Promise<Metadata> {
  await requireAdmin();
  const { id } = await params;
  const organization = await getClientOrganization(id);
  return { title: organization?.name ?? "Client" };
}

const PROVIDER_LABELS: Record<string, string> = { manual: "Invoice", razorpay: "Razorpay", paddle: "Paddle", stripe: "Stripe" };

export default async function ClientDetailPage({ params }: PageProps<"/admin/clients/[id]">) {
  const ctx = await requireAdmin();
  const { id } = await params;
  const detail = await getClientDetail(id, ctx.now);
  if (!detail) notFound();

  const { client, organization } = detail;
  const subscription = client.subscription;
  const trial = subscription?.status === "trialing" || client.plan === "trial";
  const pendingNote = client.pendingReview > 0 ? `, ${client.pendingReview} waiting for review` : "";

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Clients", href: "/admin" }, { label: organization.name }]}
        title={organization.name}
        description={`${PLANS[organization.plan].label} plan · ${MARKETS[organization.country].label} · Client since ${formatDate(organization.createdAt)}`}
        actions={
          <form action={viewAsClient}>
            <input type="hidden" name="organizationId" value={organization.id} />
            <SubmitButton>View as client</SubmitButton>
          </form>
        }
      />

      {client.health.healthy ? null : (
        <Notice tone="attention" title="Needs attention" className="mb-10">
          <ul className="grid gap-0.5">
            {client.health.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </Notice>
      )}

      <Details
        columns={3}
        className="border-t border-rule pt-5"
        items={[
          {
            label: "Revenue a month",
            value:
              client.revenue > 0 ? (
                <span>
                  {formatMoney(client.revenue, client.revenueCurrency)}
                  {client.revenueCurrency !== "USD" ? (
                    <span className="text-graphite"> · {formatMoney(client.revenueUsd, "USD")}</span>
                  ) : null}
                </span>
              ) : (
                <span className="text-graphite">{trial ? "Trial, no revenue" : "No revenue"}</span>
              ),
          },
          { label: "API cost, last 30 days", value: <span>{formatCost(client.apiCost30)}</span> },
          { label: "Cost share", value: <MarginShare margin={client.margin} trial={trial} align="start" /> },
          {
            label: "Accuracy Score",
            value: (
              <span>
                {displayScore(client.score)}
                {client.scoreAt ? <span className="text-graphite"> · {formatDate(client.scoreAt)}</span> : null}
              </span>
            ),
          },
          {
            label: "Open issues",
            value: (
              <span>
                {client.openIssues}
                <span className="text-graphite">{pendingNote}</span>
              </span>
            ),
          },
          {
            label: "Health",
            value: client.health.healthy ? (
              <HealthMark health={client.health} />
            ) : (
              <span>
                <span className="font-medium">Needs attention</span>
                <span className="text-graphite">, {plural(client.health.reasons.length, "reason")} above</span>
              </span>
            ),
          },
        ]}
      />

      <Section title="Subscription" id="subscription">
        {subscription ? (
          <Details
            columns={3}
            items={[
              { label: "Plan", value: PLANS[subscription.plan].label },
              { label: "Status", value: SUBSCRIPTION_STATUSES[subscription.status].label },
              {
                label: "Price",
                value: (
                  <span>
                    {formatMoney(subscription.amount, subscription.currency)} a {subscription.interval}
                  </span>
                ),
              },
              { label: "Billing", value: PROVIDER_LABELS[subscription.provider] ?? subscription.provider },
              {
                label: "Founding price",
                value: subscription.founding
                  ? subscription.priceLockedUntil
                    ? `Locked until ${formatDate(subscription.priceLockedUntil)}`
                    : "Yes"
                  : "No",
              },
              { label: "Renews", value: subscription.renewsAt ? formatDate(subscription.renewsAt) : "–" },
            ]}
          />
        ) : (
          <p className="text-graphite">No subscription on record. The account was created without a plan.</p>
        )}

        {detail.invoices.length > 0 ? (
          <div className="mt-8">
            <h3 className="mb-2 text-sm font-medium text-ink">Invoices</h3>
            <Table caption="Recent invoices">
              <THead>
                <tr>
                  <TH>Invoice</TH>
                  <TH>Description</TH>
                  <TH numeric>Amount</TH>
                  <TH>Status</TH>
                  <TH>Issued</TH>
                  <TH>Paid</TH>
                </tr>
              </THead>
              <TBody>
                {detail.invoices.map((invoice) => (
                  <TR key={invoice.id}>
                    <RowHead className="figures whitespace-nowrap">{invoice.number}</RowHead>
                    <TD className="min-w-48">{invoice.description}</TD>
                    <TD numeric>{formatMoney(invoice.amount + invoice.tax, invoice.currency)}</TD>
                    <TD className={invoice.status === "overdue" ? "font-medium text-ink" : "text-graphite"}>
                      {INVOICE_STATUSES[invoice.status].label}
                    </TD>
                    <TD className="whitespace-nowrap">{formatDate(invoice.issuedOn)}</TD>
                    <TD className="whitespace-nowrap text-graphite">{invoice.paidOn ? formatDate(invoice.paidOn) : "–"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        ) : null}
      </Section>

      {detail.setups.map(({ brand, activeQuestions, keyQuestions, approvedFacts, draftFacts, competitors }) => (
        <Section key={brand.id} title={detail.setups.length > 1 ? `Brand: ${brand.name}` : "Brand"} id={`brand-${brand.id}`}>
          <Details
            columns={3}
            items={[
              { label: "Name", value: brand.name },
              { label: "Website", value: <ExternalLink href={brand.website}>{displayUrl(brand.website)}</ExternalLink> },
              { label: "Industry", value: brand.industry ?? "–" },
              {
                label: "Markets",
                value: brand.markets.length ? listJoin(brand.markets.map((m) => MARKETS[m].label)) : "–",
              },
              { label: "Platforms", value: <PlatformList platforms={brand.platforms} /> },
              {
                label: "Scans",
                value: `${SCAN_FREQUENCIES[brand.scanFrequency].label}, ${plural(brand.runsPerQuestion, "run")} per question`,
              },
              {
                label: "Questions",
                value: (
                  <span>
                    {formatNumber(activeQuestions)} active
                    <span className="text-graphite">, {formatNumber(keyQuestions)} key</span>
                  </span>
                ),
              },
              {
                label: "Fact Sheet",
                value: (
                  <span>
                    {formatNumber(approvedFacts)} approved
                    {draftFacts > 0 ? <span className="text-graphite">, {formatNumber(draftFacts)} drafts</span> : null}
                  </span>
                ),
              },
              { label: "Competitors", value: <span>{competitors}</span> },
              {
                label: "Onboarding",
                value:
                  brand.onboardingStep === "done"
                    ? "Finished"
                    : `Stopped at step ${ONBOARDING_STEPS[brand.onboardingStep].step}, ${ONBOARDING_STEPS[brand.onboardingStep].label}`,
              },
              {
                label: "Next scan",
                value: brand.nextScanAt ? (
                  <span>
                    {formatDateTime(brand.nextScanAt)}
                    <span className="text-graphite"> · {formatRelative(brand.nextScanAt, ctx.now)}</span>
                  </span>
                ) : (
                  <span className="text-graphite">Not scheduled</span>
                ),
              },
            ]}
          />
        </Section>
      ))}

      <Section title="Team" id="team" description={`${plural(detail.members.length, "person", "people")} with access.`}>
        {detail.members.length === 0 ? (
          <p className="text-graphite">Nobody has access to this account.</p>
        ) : (
          <Table caption="Team members">
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Role</TH>
                <TH>Last login</TH>
                <TH>Two-step login</TH>
              </tr>
            </THead>
            <TBody>
              {detail.members.map((member) => (
                <TR key={member.id}>
                  <RowHead className="min-w-52">
                    <span className="font-medium text-ink">{member.name}</span>
                    <span className="mt-0.5 block text-sm break-all text-graphite">
                      {member.email}
                      {member.title ? ` · ${member.title}` : ""}
                    </span>
                  </RowHead>
                  <TD>{ROLES[member.role].label}</TD>
                  <TD className="whitespace-nowrap">
                    {member.lastLoginAt ? (
                      <span title={formatDateTime(member.lastLoginAt)}>{formatRelative(member.lastLoginAt, ctx.now)}</span>
                    ) : (
                      <span className="text-graphite">Never</span>
                    )}
                  </TD>
                  <TD className={member.twoFactorEnabled ? undefined : "text-graphite"}>
                    {member.twoFactorEnabled ? "On" : "Off"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      <Section
        title="Recent scans"
        id="scans"
        actions={
          <ButtonLink href="/admin/scans" variant="quiet" size="sm">
            All scans
          </ButtonLink>
        }
      >
        {detail.scans.length === 0 ? (
          <EmptyState title="No scans yet." className="border-t-0 pt-0">
            {client.brands[0]?.onboardingStep === "done"
              ? "The first scheduled scan will appear here when it starts."
              : "The first scan starts when the client finishes onboarding."}
          </EmptyState>
        ) : (
          <ScansTable scans={detail.scans} now={ctx.now} showClient={false} caption={`Recent scans for ${organization.name}`} />
        )}
      </Section>

      <Section
        title="API cost"
        id="costs"
        description={
          client.revenueUsd > 0
            ? `Each month's cost against today's revenue of ${formatMoney(client.revenueUsd, "USD")} a month.`
            : "This account pays nothing yet, so there is no share to compare against."
        }
      >
        {detail.costByMonth.length === 0 ? (
          <p className="text-graphite">No API usage recorded for this account in the last six months.</p>
        ) : (
          <div className="grid gap-10 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:gap-12">
            <div>
              <h3 className="mb-2 text-sm font-medium text-ink">By month</h3>
              <Table caption="API cost by month">
                <THead>
                  <tr>
                    <TH>Month</TH>
                    <TH numeric>Cost</TH>
                    <TH numeric>Share</TH>
                  </tr>
                </THead>
                <TBody>
                  {detail.costByMonth.map((month) => {
                    const check = client.revenueUsd > 0 ? marginCheck(month.costUsd, client.revenueUsd) : null;
                    return (
                      <TR key={month.month}>
                        <RowHead className="whitespace-nowrap">{formatMonth(`${month.month}-15`)}</RowHead>
                        <TD numeric>{formatCost(month.costUsd)}</TD>
                        <TD numeric>
                          {check ? (
                            <MarginShare margin={{ share: check.share, overLimit: !check.withinRule }} />
                          ) : (
                            <span className="text-graphite">–</span>
                          )}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
            <div className="min-w-0">
              <h3 className="mb-2 text-sm font-medium text-ink">Last 30 days, by model</h3>
              {detail.costByModel.length === 0 ? (
                <p className="text-graphite">No API usage in the last 30 days.</p>
              ) : (
                <Table caption="API cost by model, last 30 days">
                  <THead>
                    <tr>
                      <TH>Model</TH>
                      <TH numeric>Requests</TH>
                      <TH numeric>Tokens in</TH>
                      <TH numeric>Tokens out</TH>
                      <TH numeric>Searches</TH>
                      <TH numeric>Cost</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {detail.costByModel.map((row) => (
                      <TR key={`${row.provider}-${row.model}`}>
                        <RowHead>
                          <span className="whitespace-nowrap text-ink">{row.model}</span>
                          <span className="mt-0.5 block text-sm text-graphite">{row.provider}</span>
                        </RowHead>
                        <TD numeric>{formatNumber(row.requests)}</TD>
                        <TD numeric>{formatNumber(row.tokensIn)}</TD>
                        <TD numeric>{formatNumber(row.tokensOut)}</TD>
                        <TD numeric>{formatNumber(row.searchCalls)}</TD>
                        <TD numeric>{formatCost(row.costUsd)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </div>
          </div>
        )}
      </Section>

      <Section
        title="Support log"
        id="audit"
        description="Every time someone at TrueCite views this account as the client, and other account changes."
      >
        {detail.audit.length === 0 ? (
          <p className="text-graphite">Nothing recorded yet.</p>
        ) : (
          <ol className="border-t border-rule">
            {detail.audit.map((entry) => (
              <li
                key={entry.id}
                className="grid gap-1 border-b border-rule py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6"
              >
                <span className="text-sm whitespace-nowrap text-graphite">{formatDateTime(entry.createdAt)}</span>
                <span>
                  <span className="text-ink">{entry.action}</span>
                  <span className="text-graphite"> · {entry.actorName}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </>
  );
}
