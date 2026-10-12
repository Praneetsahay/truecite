import type { FactCategory, FactStatus, Importance } from "@/lib/domain/constants";
import { shiftDay } from "./util";

/*
  Acme's Fact Sheet. Each fact also carries the ways an AI assistant tends to phrase
  it correctly, which the answer composer uses. Every claim variant is written so it
  can start a sentence.
*/

export type Sentiment = "positive" | "neutral" | "negative";

export type FactDef = {
  key: string;
  category: FactCategory;
  statement: string;
  importance: Importance;
  sourceUrl: string;
  validFrom: string | null;
  validTo: string | null;
  status: FactStatus;
  origin: "website" | "manual";
  /** Correct phrasings used in answers. Empty for former, draft and archived facts. */
  claims: string[];
  sentiment: Sentiment;
};

export const ACME_PAGES: Record<string, string> = {
  "https://acme.example/pricing": "Pricing | Acme",
  "https://acme.example/in/pricing": "Pricing in India | Acme",
  "https://acme.example/products": "Products | Acme",
  "https://acme.example/products/payroll": "Acme Payroll for India, the UAE and the UK",
  "https://acme.example/products/spend": "Acme Spend | Expenses and corporate cards",
  "https://acme.example/products/insights": "Acme Insights | People analytics",
  "https://acme.example/integrations": "Integrations | Acme",
  "https://acme.example/about": "About Acme",
  "https://acme.example/about/leadership": "Leadership | Acme",
  "https://acme.example/legal/refund-policy": "Refund and cancellation policy | Acme",
  "https://acme.example/support": "Support | Acme",
  "https://acme.example/security": "Security and compliance | Acme",
  "https://acme.example/press": "Press | Acme",
  "https://acme.example/careers": "Careers at Acme",
};

/** The day the current Basic prices took effect: six months before the anchor. */
export function priceChangeDay(anchorDay: string): string {
  const [y, m, d] = anchorDay.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 - 6, d));
  return date.toISOString().slice(0, 10);
}

export function acmeFacts(anchorDay: string): FactDef[] {
  const change = priceChangeDay(anchorDay);
  const beforeChange = shiftDay(change, -1);
  const approved = (
    key: string,
    category: FactCategory,
    importance: Importance,
    statement: string,
    sourceUrl: string,
    claims: string[],
    extra: Partial<FactDef> = {},
  ): FactDef => ({
    key,
    category,
    importance,
    statement,
    sourceUrl,
    claims,
    validFrom: null,
    validTo: null,
    status: "approved",
    origin: "website",
    sentiment: "neutral",
    ...extra,
  });

  return [
    // Pricing
    approved("price_basic_usd", "pricing", "critical", "The Basic plan costs $79 per month.", "https://acme.example/pricing", [
      "Acme's Basic plan costs $79 per month",
      "The Basic plan is priced at $79 per month",
      "Basic starts at $79 per month",
    ], { validFrom: change }),
    approved("price_basic_usd_old", "pricing", "critical", "The Basic plan costs $49 per month.", "https://acme.example/pricing", [], {
      validTo: beforeChange,
    }),
    approved("price_growth_usd", "pricing", "critical", "The Growth plan costs $199 per month.", "https://acme.example/pricing", [
      "The Growth plan costs $199 per month",
      "Acme's Growth plan is $199 per month",
    ], { validFrom: change }),
    approved("price_basic_inr", "pricing", "critical", "In India, the Basic plan costs ₹4,999 per month plus GST.", "https://acme.example/in/pricing", [
      "In India, the Basic plan costs ₹4,999 per month plus GST",
      "Indian customers pay ₹4,999 per month plus GST for Basic",
    ], { validFrom: change }),
    approved("price_basic_inr_old", "pricing", "critical", "In India, the Basic plan costs ₹2,999 per month plus GST.", "https://acme.example/in/pricing", [], {
      validTo: beforeChange,
    }),
    approved("price_growth_inr", "pricing", "high", "In India, the Growth plan costs ₹14,999 per month plus GST.", "https://acme.example/in/pricing", [
      "The Growth plan in India costs ₹14,999 per month plus GST",
      "Growth is ₹14,999 per month plus GST in India",
    ]),
    approved("no_free_plan", "pricing", "high", "Acme has no free plan. New customers get a 14-day free trial.", "https://acme.example/pricing", [
      "Acme has no free plan, but new customers get a 14-day free trial",
      "There is no free plan; instead, Acme offers new customers a 14-day free trial",
    ]),
    approved("basic_admins", "pricing", "medium", "The Basic plan includes up to 5 admin users.", "https://acme.example/pricing", [
      "The Basic plan includes up to 5 admin users",
      "Basic comes with up to five admin users",
    ]),
    approved("enterprise_custom", "pricing", "medium", "Enterprise pricing is custom and quoted on request.", "https://acme.example/pricing", [
      "Enterprise pricing is custom and quoted on request",
      "Enterprise plans are priced on request",
    ]),

    // Products
    approved("products", "products", "high", "Acme's products are Acme Payroll, Acme Attendance, Acme Spend and Acme Insights.", "https://acme.example/products", [
      "Acme's products are Acme Payroll, Acme Attendance, Acme Spend and Acme Insights",
      "Acme sells four products: Acme Payroll, Acme Attendance, Acme Spend and Acme Insights",
    ], { sentiment: "neutral" }),
    approved("expense_retired", "products", "high", "Acme Expense was retired on 30 June 2025 and replaced by Acme Spend.", "https://acme.example/products/spend", [
      "Acme Expense was retired on 30 June 2025 and replaced by Acme Spend",
      "Acme Spend replaced Acme Expense, which was retired in June 2025",
    ], { validFrom: "2025-07-01" }),
    approved("expense_old", "products", "high", "Acme Expense is available as an add-on.", "https://acme.example/products", [], {
      validTo: "2025-06-30",
    }),
    approved("payroll_countries", "products", "high", "Acme Payroll supports payroll in India, the UAE (including WPS) and the UK.", "https://acme.example/products/payroll", [
      "Acme Payroll supports payroll in India, the UAE (including WPS) and the UK",
      "Acme runs payroll in India, the UAE and the UK, including WPS salary files for the UAE",
    ], { sentiment: "positive" }),
    approved("insights_addon", "products", "medium", "Acme Insights is a paid add-on for Growth and Enterprise plans.", "https://acme.example/products/insights", [
      "Acme Insights is a paid add-on for the Growth and Enterprise plans",
      "Insights is sold as a paid add-on on Growth and Enterprise",
    ]),
    approved("integrations", "products", "low", "Acme integrates with Tally, Zoho Books and Xero.", "https://acme.example/integrations", [
      "Acme integrates with Tally, Zoho Books and Xero",
      "Acme connects to Tally, Zoho Books and Xero",
    ], { origin: "manual", sentiment: "positive" }),

    // Leadership
    approved("ceo", "leadership", "high", "Meera Iyer has been Chief Executive Officer since 1 January 2025.", "https://acme.example/about/leadership", [
      "Meera Iyer has been Acme's CEO since January 2025",
      "Acme's chief executive is Meera Iyer, who took over in January 2025",
    ], { validFrom: "2025-01-01" }),
    approved("ceo_old", "leadership", "high", "Rahul Mehta is the Chief Executive Officer.", "https://acme.example/about/leadership", [], {
      validTo: "2024-12-31",
    }),
    approved("chairman", "leadership", "medium", "Rahul Mehta is co-founder and chairman of the board.", "https://acme.example/about/leadership", [
      "Rahul Mehta, a co-founder, is chairman of the board",
      "Co-founder Rahul Mehta now chairs the board",
    ], { validFrom: "2025-01-01" }),
    approved("cfo", "leadership", "medium", "Arjun Rao is the Chief Financial Officer.", "https://acme.example/about/leadership", [
      "Arjun Rao is Acme's Chief Financial Officer",
      "Acme's CFO is Arjun Rao",
    ]),

    // Company
    approved("founded", "company", "low", "Acme was founded in 2014.", "https://acme.example/about", [
      "Acme was founded in 2014",
      "Acme started out in 2014",
    ]),
    approved("hq", "company", "low", "Acme is headquartered in Bengaluru, India.", "https://acme.example/about", [
      "Acme is headquartered in Bengaluru, India",
      "Acme's head office is in Bengaluru",
    ], { validFrom: "2023-06-01" }),
    approved("hq_old", "company", "low", "Acme is headquartered in Mumbai.", "https://acme.example/about", [], {
      validTo: "2023-05-31",
    }),
    approved("employees", "company", "low", "Acme has about 650 employees.", "https://acme.example/about", [
      "Acme has about 650 employees",
      "Acme employs around 650 people",
    ]),
    approved("customers", "company", "medium", "More than 2,400 companies use Acme.", "https://acme.example/about", [
      "More than 2,400 companies use Acme",
      "Acme says it serves more than 2,400 customer companies",
    ]),
    approved("legal_name", "company", "medium", "Acme's legal name is Acme Technologies Private Limited.", "https://acme.example/about", [
      "Acme's legal name is Acme Technologies Private Limited",
      "Acme is registered as Acme Technologies Private Limited",
    ], { origin: "manual" }),

    // Policies
    approved("refund", "policies", "high", "Annual plans can be refunded within 14 days of the first payment.", "https://acme.example/legal/refund-policy", [
      "Acme refunds annual plans if you ask within 14 days of the first payment",
      "Annual plans can be refunded within 14 days of the first payment",
    ], { validFrom: "2026-01-01" }),
    approved("refund_old", "policies", "high", "Annual plans can be refunded within 30 days of the first payment.", "https://acme.example/legal/refund-policy", [], {
      validTo: "2025-12-31",
    }),
    approved("monthly_cancel", "policies", "medium", "Monthly plans can be cancelled at any time and are not refunded.", "https://acme.example/legal/refund-policy", [
      "Monthly plans can be cancelled at any time but are not refunded",
      "Acme lets you cancel a monthly plan at any time, though monthly payments are not refunded",
    ]),

    // Support
    approved("support_hours", "support", "high", "Support is available Monday to Saturday, 9am to 9pm IST, by chat and email.", "https://acme.example/support", [
      "Support is available Monday to Saturday, 9am to 9pm IST, by chat and email",
      "Acme's support team works Monday to Saturday from 9am to 9pm IST over chat and email",
    ]),
    approved("phone_support", "support", "medium", "Phone support is available on Growth and Enterprise plans.", "https://acme.example/support", [
      "Phone support is included on the Growth and Enterprise plans",
      "Growth and Enterprise customers also get phone support",
    ]),

    // Security
    approved("iso", "security", "critical", "Acme is certified to ISO/IEC 27001.", "https://acme.example/security", [
      "Acme is certified to ISO/IEC 27001",
      "Acme holds ISO/IEC 27001 certification",
    ], { sentiment: "positive" }),
    approved("soc2", "security", "critical", "Acme's SOC 2 Type II audit is in progress and has not been completed.", "https://acme.example/security", [
      "Acme's SOC 2 Type II audit is still in progress",
      "Acme has started a SOC 2 Type II audit but has not completed it yet",
    ]),
    approved("data_location", "security", "high", "Customer data is stored in AWS data centres in Mumbai.", "https://acme.example/security", [
      "Customer data is stored in AWS data centres in Mumbai",
      "Acme keeps customer data in AWS data centres in Mumbai",
    ]),
    approved("no_breach", "security", "critical", "Acme has never reported a data breach.", "https://acme.example/security", [
      "Acme has never reported a data breach",
      "There are no reported data breaches at Acme",
    ], { sentiment: "positive" }),

    // Legal and careers
    approved("no_lawsuits", "legal", "high", "Acme has no pending lawsuits.", "https://acme.example/press", [
      "Acme has no pending lawsuits",
      "There are no known pending lawsuits against Acme",
    ], { origin: "manual", sentiment: "positive" }),
    approved("hiring", "careers", "low", "Acme is hiring in Bengaluru and Dubai.", "https://acme.example/careers", [
      "Acme is currently hiring in Bengaluru and Dubai",
      "Acme's open roles are mostly in Bengaluru and Dubai",
    ]),

    // Drafts waiting for approval, and one archived fact
    approved("draft_insights_launch", "products", "low", "Acme Insights launched in April 2024.", "https://acme.example/press", [], { status: "draft" }),
    approved("draft_award", "company", "low", "Acme won the 2025 HR Tech Award for best payroll product.", "https://acme.example/press", [], { status: "draft" }),
    approved("draft_offices", "company", "medium", "Acme has offices in Bengaluru, Dubai and London.", "https://acme.example/about", [], { status: "draft" }),
    approved("archived_annual_discount", "pricing", "medium", "Acme offers 10% off annual billing.", "https://acme.example/pricing", [], {
      status: "archived",
      origin: "manual",
    }),
  ];
}

export const ACME_COMPETITORS = [
  { key: "northwind", name: "Northwind Payroll", website: "https://northwind.example" },
  { key: "fabrikam", name: "Fabrikam HR", website: "https://fabrikam.example" },
  { key: "contoso", name: "Contoso People", website: "https://contoso.example" },
] as const;
