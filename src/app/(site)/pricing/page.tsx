import type { Metadata } from "next";
import { headers } from "next/headers";
import { CurrencySwitch, OfferRow, Price, gstLabel } from "@/components/site-pages/pricing";
import { ClosingCall, PageIntro, SectionHeading, SiteSection } from "@/components/site-pages/site-page";
import { ButtonLink } from "@/components/ui/button";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  ANNUAL_MONTHS_CHARGED,
  AUDIT_CREDIT_DAYS,
  FOUNDING_LOCK_MONTHS,
  PLAN_SUMMARIES,
  PRICING_FAQ,
} from "@/lib/content/pricing";
import { PLAN_FEATURES, PRICES, type Currency } from "@/lib/domain/constants";
import { formatMoney } from "@/lib/domain/format";

/*
  Prices depend on where the visitor is, so this page renders per request:
  rupees for India (from the hosting provider's country header), dollars for
  everyone else, and ?currency=usd or ?currency=inr to choose.
*/
export const instant = false;

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "TrueCite pricing: a free mini-report, a one-time full audit, and monthly monitoring plans for PR, brand and legal teams. Prices in US dollars or Indian rupees.",
};

async function resolveCurrency(
  searchParams: Promise<Record<string, string | string[] | undefined>>,
): Promise<{ currency: Currency; detected: boolean }> {
  const { currency } = await searchParams;
  const chosen = typeof currency === "string" ? currency.toLowerCase() : null;
  if (chosen === "inr") return { currency: "INR", detected: false };
  if (chosen === "usd") return { currency: "USD", detected: false };
  const requestHeaders = await headers();
  const country = (requestHeaders.get("x-vercel-ip-country") ?? requestHeaders.get("cf-ipcountry") ?? "").toUpperCase();
  return { currency: country === "IN" ? "INR" : "USD", detected: country !== "" };
}

const PLAN_COLUMNS = [
  { id: "starter", label: "Starter" },
  { id: "professional", label: "Professional" },
  { id: "enterprise", label: "Enterprise" },
] as const;

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { currency, detected } = await resolveCurrency(searchParams);
  const prices = PRICES[currency];
  const money = (amount: number) => formatMoney(amount, currency);
  const gst = currency === "INR" ? ` ${gstLabel}` : "";

  return (
    <>
      <PageIntro
        kicker="Pricing"
        title="Plans and prices"
        aside={<CurrencySwitch currency={currency} detected={detected} />}
      >
        <p>
          Start with a free check or a one-time audit, then monitor what AI says about you every week or two. Every plan
          runs month to month.
        </p>
      </PageIntro>

      <SiteSection split labelledBy="start">
        <SectionHeading title="Start with a check" id="start">
          <p>See what AI gets wrong about your company before you commit to anything.</p>
        </SectionHeading>
        <ul className="border-t border-rule-strong">
          <li className="grid gap-2 border-b border-rule py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-8">
            <div>
              <h3 className="font-medium text-ink">Mini-report</h3>
              <p className="mt-1 text-graphite">
                Three to five real errors about your company, each with its sources and first fix steps. Reviewed by hand
                and sent within three working days.
              </p>
            </div>
            <p className="text-2xl font-medium tracking-[-0.02em] text-ink">Free</p>
          </li>
          <li className="grid gap-2 border-b border-rule py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-8">
            <div>
              <h3 className="font-medium text-ink">Full audit, one time</h3>
              <p className="mt-1 text-graphite">
                A deep scan of every question category on all four AI assistants, with every issue, its sources and fix
                steps, in a report for leadership. Credited toward a subscription if you subscribe within{" "}
                {AUDIT_CREDIT_DAYS} days.
              </p>
            </div>
            <div className="sm:text-right">
              <Price amount={prices.audit} currency={currency} />
            </div>
          </li>
        </ul>
      </SiteSection>

      <SiteSection labelledBy="monitoring">
        <SectionHeading title="Monitoring plans" id="monitoring">
          <p>
            TrueCite asks AI assistants your customers&rsquo; questions on a schedule, checks every answer against your
            approved facts, alerts you to new errors and re-checks every fix.
          </p>
        </SectionHeading>
        <ul className="mt-12 border-t border-rule-strong">
          <OfferRow
            name="Starter"
            price={<Price amount={prices.starter} currency={currency} per="a month" />}
            note={
              <>
                Founding price for our first clients, fixed for {FOUNDING_LOCK_MONTHS} months. Regular price{" "}
                {money(prices.starterRegular)} a month{gst}.
              </>
            }
          >
            {PLAN_SUMMARIES.starter}
          </OfferRow>
          <OfferRow
            name="Professional"
            price={<Price amount={prices.professional} currency={currency} per="a month" />}
            note={
              <>
                Or {money(prices.professional * ANNUAL_MONTHS_CHARGED)} a year{gst}, paid annually.
              </>
            }
          >
            {PLAN_SUMMARIES.professional}
          </OfferRow>
          <OfferRow
            name="Enterprise"
            price={<Price amount={prices.enterpriseFrom} currency={currency} per="a month" prefix="From" />}
            note="Priced to the brands, languages and markets you need."
          >
            {PLAN_SUMMARIES.enterprise}
          </OfferRow>
        </ul>
      </SiteSection>

      <SiteSection labelledBy="compare">
        <SectionHeading title="Compare plans" id="compare" />
        <div className="mt-10">
          <Table caption="What each monitoring plan includes" className="min-w-[40rem]">
            <THead>
              <tr>
                <TH className="w-1/4">
                  <span className="sr-only">Feature</span>
                </TH>
                {PLAN_COLUMNS.map((plan) => (
                  <TH key={plan.id} className="w-1/4">
                    <span className="text-base font-medium text-ink">{plan.label}</span>
                  </TH>
                ))}
              </tr>
            </THead>
            <TBody>
              {PLAN_FEATURES.map((row) => (
                <TR key={row.feature}>
                  <RowHead className="text-graphite">{row.feature}</RowHead>
                  {PLAN_COLUMNS.map((plan) => (
                    <TD key={plan.id} className="text-ink">
                      {row[plan.id]}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      </SiteSection>

      <SiteSection split labelledBy="billing">
        <SectionHeading title="How billing works" id="billing">
          <p>Simple terms, so trying TrueCite carries little risk.</p>
        </SectionHeading>
        <dl className="border-t border-rule-strong">
          <div className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
            <dt className="font-medium text-ink">Month to month</dt>
            <dd className="text-ink">Every plan starts month to month. Cancel at any time; the plan runs to the end of the paid month.</dd>
          </div>
          <div className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
            <dt className="font-medium text-ink">Annual billing</dt>
            <dd className="text-ink">
              Pay for {ANNUAL_MONTHS_CHARGED} months, get 12. Refundable within 14 days of payment.
            </dd>
          </div>
          <div className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
            <dt className="font-medium text-ink">Founding prices</dt>
            <dd className="text-ink">
              Our first clients keep their founding price for {FOUNDING_LOCK_MONTHS} months, in exchange for regular
              feedback.
            </dd>
          </div>
          <div className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
            <dt className="font-medium text-ink">{currency === "INR" ? "GST invoices" : "Invoices"}</dt>
            <dd className="text-ink">
              {currency === "INR"
                ? "Prices exclude 18% GST. Every invoice is a GST invoice, so your company can claim input tax credit. Invoices are payable by bank transfer."
                : "Invoices are issued in US dollars and payable by card or bank transfer. Companies in India pay in rupees, plus GST."}
            </dd>
          </div>
        </dl>
      </SiteSection>

      <SiteSection split labelledBy="questions">
        <SectionHeading title="Questions" id="questions" />
        <dl className="border-t border-rule-strong">
          {PRICING_FAQ.map((item) => (
            <div key={item.question} className="border-b border-rule py-5">
              <dt className="font-medium text-ink">{item.question}</dt>
              <dd className="mt-2 text-ink">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </SiteSection>

      <ClosingCall
        title="Start with a free check."
        actions={
          <>
            <ButtonLink href="/free-check" variant="primary">
              Request a free check
            </ButtonLink>
            <ButtonLink href="/sample-report">See a sample report</ButtonLink>
          </>
        }
      >
        <p>
          Tell us your company and website. We review every finding by hand and send you a short report within three
          working days.
        </p>
      </ClosingCall>
    </>
  );
}
