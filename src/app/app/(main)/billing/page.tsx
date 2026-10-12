import type { Metadata } from "next";
import { TextLink } from "@/components/ui/button";
import { EmptyState, PageHeader, Section } from "@/components/ui/page";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireClient } from "@/lib/auth/dal";
import {
  GST_RATE,
  INVOICE_STATUSES,
  PLANS,
  SCAN_FREQUENCIES,
  SUBSCRIPTION_STATUSES,
  type InvoiceStatus,
  type PlanLimits,
} from "@/lib/domain/constants";
import { formatDate, formatMoney, formatNumber } from "@/lib/domain/format";
import { getBilling } from "@/lib/queries/account";
import { cx } from "@/lib/cx";
import { PlanChangeForm } from "./plan-change-form";

export const metadata: Metadata = { title: "Billing" };

const PAYMENT_METHODS = {
  manual: "Paid by bank transfer against invoice.",
  razorpay: "Paid through Razorpay by card, UPI or net banking.",
  paddle: "Paid by card through Paddle.",
  stripe: "Paid by card through Stripe.",
} as const;

function limitLabel(value: PlanLimits[keyof PlanLimits]): string {
  if (value === "custom") return "Custom";
  if (value === "all") return "All available";
  if (value === "several") return "Several";
  if (typeof value === "number") return formatNumber(value);
  return value in SCAN_FREQUENCIES ? SCAN_FREQUENCIES[value as keyof typeof SCAN_FREQUENCIES].label : String(value);
}

function InvoiceStatusLabel({ status }: { status: InvoiceStatus }) {
  return (
    <span className={cx(status === "overdue" && "font-medium text-ink", status === "due" && "text-ink", (status === "paid" || status === "void") && "text-graphite")}>
      {INVOICE_STATUSES[status].label}
    </span>
  );
}

export default async function BillingPage() {
  const ctx = await requireClient();
  const { subscription, invoices, usage } = await getBilling(ctx);
  const planId = subscription?.plan ?? ctx.organization.plan;
  const plan = PLANS[planId];
  const currency = subscription?.currency ?? ctx.organization.currency;
  const amount = subscription?.amount ?? 0;
  const per = subscription?.interval === "year" ? "a year" : "a month";
  const gst = currency === "INR" ? Math.round(amount * GST_RATE) : 0;

  const includes: { item: string; included: string; using: string }[] = [
    { item: "Questions", included: limitLabel(plan.questions), using: `${formatNumber(usage.questions)} active` },
    { item: "AI platforms", included: limitLabel(plan.platforms), using: formatNumber(ctx.brand.platforms.length) },
    { item: "Runs per question", included: limitLabel(plan.runsPerQuestion), using: formatNumber(ctx.brand.runsPerQuestion) },
    { item: "Scan frequency", included: limitLabel(plan.frequency), using: SCAN_FREQUENCIES[ctx.brand.scanFrequency].label },
    { item: "Competitors", included: limitLabel(plan.competitors), using: formatNumber(usage.competitors) },
    {
      item: "Team members",
      included: limitLabel(plan.teamMembers),
      using:
        usage.invites > 0
          ? `${formatNumber(usage.members)}, plus ${formatNumber(usage.invites)} invited`
          : formatNumber(usage.members),
    },
  ];

  return (
    <>
      <PageHeader title="Billing" description="Your plan, what it includes, your invoices and how you pay." />

      <Section id="plan" title={`${plan.label} plan`} rule={false}>
        <dl className="grid gap-x-10 gap-y-5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="min-w-0">
            <dt className="text-sm text-graphite">Price</dt>
            <dd className="mt-0.5 text-ink">
              {amount > 0 ? (
                <>
                  <span className="text-xl font-medium tracking-[-0.01em]">{formatMoney(amount, currency)}</span>{" "}
                  <span className="text-graphite">{per}</span>
                  {currency === "INR" ? (
                    <span className="mt-1 block text-sm text-graphite">
                      Plus GST at {Math.round(GST_RATE * 100)}%, {formatMoney(gst, "INR")}.{" "}
                      {formatMoney(amount + gst, "INR")} in total {per}.
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-xl font-medium tracking-[-0.01em]">
                  {subscription?.status === "trialing" ? "Free during the trial" : "No charge"}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-graphite">Status</dt>
            <dd className={cx("mt-0.5", subscription?.status === "past_due" ? "font-medium text-ink" : "text-ink")}>
              {subscription ? SUBSCRIPTION_STATUSES[subscription.status].label : "No subscription yet"}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-graphite">{subscription?.status === "cancelled" ? "Ends on" : "Renews on"}</dt>
            <dd className="mt-0.5 text-ink">{subscription?.renewsAt ? formatDate(subscription.renewsAt) : "–"}</dd>
          </div>
          <div>
            <dt className="text-sm text-graphite">Founding price</dt>
            <dd className="mt-0.5 text-ink">
              {subscription?.founding && subscription.priceLockedUntil
                ? `Locked until ${formatDate(subscription.priceLockedUntil)}`
                : subscription?.founding
                  ? "Locked"
                  : "Standard price"}
            </dd>
          </div>
        </dl>
        <p className="mt-6 text-sm text-graphite">
          {subscription ? PAYMENT_METHODS[subscription.provider] : "No payment method yet."}{" "}
          {currency === "INR" ? "Prices exclude GST, which is added to each invoice. " : ""}
          See what every plan includes on the <TextLink href="/pricing">pricing page</TextLink>.
        </p>
      </Section>

      <Section id="includes" title="What your plan includes" description="Your plan's limits next to what this account uses now.">
        <Table className="relative" caption={`What the ${plan.label} plan includes`}>
          <THead>
            <TR>
              <TH>Item</TH>
              <TH>Included</TH>
              <TH>In use</TH>
            </TR>
          </THead>
          <TBody>
            {includes.map((row) => (
              <TR key={row.item}>
                <RowHead className="text-ink">{row.item}</RowHead>
                <TD>{row.included}</TD>
                <TD className="text-graphite">{row.using}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>

      <Section id="invoices" title="Invoices" description="Newest first. Amounts are in the currency you are billed in.">
        {invoices.length === 0 ? (
          <EmptyState title="No invoices yet." className="border-t-0 pt-0">
            Your first invoice appears here at the start of your first paid billing period.
          </EmptyState>
        ) : (
          <Table className="relative" caption="Invoices, newest first">
            <THead>
              <TR>
                <TH>Number</TH>
                <TH>Description</TH>
                <TH>Issued</TH>
                <TH>Due</TH>
                <TH numeric>Amount</TH>
                <TH numeric>Tax</TH>
                <TH numeric>Total</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {invoices.map((invoice) => (
                <TR key={invoice.id}>
                  <RowHead className="whitespace-nowrap text-ink">{invoice.number}</RowHead>
                  <TD className="min-w-52">{invoice.description}</TD>
                  <TD className="whitespace-nowrap text-graphite">{formatDate(invoice.issuedOn)}</TD>
                  <TD className="whitespace-nowrap text-graphite">{formatDate(invoice.dueOn)}</TD>
                  <TD numeric>
                    <span className="normal-nums">{formatMoney(invoice.amount, invoice.currency)}</span>
                  </TD>
                  <TD numeric className="text-graphite">
                    <span className="normal-nums">{invoice.tax > 0 ? formatMoney(invoice.tax, invoice.currency) : "–"}</span>
                  </TD>
                  <TD numeric className="font-medium">
                    <span className="normal-nums">{formatMoney(invoice.amount + invoice.tax, invoice.currency)}</span>
                  </TD>
                  <TD className="whitespace-nowrap">
                    <InvoiceStatusLabel status={invoice.status} />
                    {invoice.status === "paid" && invoice.paidOn ? (
                      <span className="block text-sm text-graphite">{formatDate(invoice.paidOn)}</span>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      <Section
        id="change-plan"
        title="Change plan"
        description={
          ctx.isOwner
            ? "Tell TrueCite which plan you want. We confirm the price and start date by email before anything changes."
            : "Only an owner can ask to change the plan."
        }
      >
        {ctx.isOwner ? (
          <div className="max-w-xl">
            <PlanChangeForm current={planId} />
          </div>
        ) : null}
      </Section>
    </>
  );
}

export const instant = false;
