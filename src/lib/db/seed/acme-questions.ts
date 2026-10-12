import type { PlatformId, QuestionCategory } from "@/lib/domain/constants";
import type { Sentiment } from "./acme-facts";

/*
  Acme's Question Set (100 questions, 5 switched off). Each question lists the facts a
  good answer draws on (primary first), claims an assistant tends to add that the Fact
  Sheet does not cover (checked as unsupported), and context sentences that make no
  claim about Acme, such as notes on competitors.
*/

export type Extra = { text: string; sentiment?: Sentiment; platforms?: PlatformId[] };
export type Page = { url: string; title: string };

export type QuestionDef = {
  key: string;
  text: string;
  category: QuestionCategory;
  priority: "key" | "standard";
  active: boolean;
  origin: "generated" | "custom";
  facts: string[];
  extras?: Extra[];
  context?: string[];
  pages?: Page[];
  topic: string;
};

type Opts = Partial<Pick<QuestionDef, "extras" | "context" | "pages">> & {
  key?: boolean;
  custom?: boolean;
  off?: boolean;
};

function q(key: string, category: QuestionCategory, text: string, topic: string, facts: string[], opts: Opts = {}): QuestionDef {
  return {
    key,
    text,
    category,
    topic,
    facts,
    priority: opts.key ? "key" : "standard",
    active: !opts.off,
    origin: opts.custom ? "custom" : "generated",
    extras: opts.extras,
    context: opts.context,
    pages: opts.pages,
  };
}

const COMPARE_NW: Page = { url: "https://saasreviews.example/compare/acme-vs-northwind-payroll", title: "Acme vs Northwind Payroll compared" };
const INDIA_LIST: Page = { url: "https://saasreviews.example/payroll-software-india", title: "Payroll software in India: reviews and ratings" };
const UAE_LIST: Page = { url: "https://payrollguide.example/best-payroll-software-uae", title: "Best payroll software in the UAE" };
const UK_LIST: Page = { url: "https://techbench.example/best-hr-software-uk", title: "Best HR software for UK mid-size firms" };
const TALLY_LIST: Page = { url: "https://payrollguide.example/payroll-software-tally", title: "Payroll software that works with Tally" };
const REVIEWS: Page = { url: "https://saasreviews.example/acme-payroll/reviews", title: "Acme Payroll reviews" };
const JOBS: Page = { url: "https://jobsboard.example/companies/acme/reviews", title: "Working at Acme: employee reviews" };
const FORUM_300: Page = { url: "https://communityforum.example/t/acme-or-northwind-for-300-staff", title: "Acme or Northwind for 300 staff?" };

export const ACME_QUESTIONS: QuestionDef[] = [
  // Pricing and plans
  q("p_cost", "pricing", "How much does Acme cost?", "Acme's pricing", ["price_basic_usd", "price_growth_usd", "enterprise_custom"], { key: true }),
  q("p_free", "pricing", "Does Acme have a free plan?", "Acme's free options", ["no_free_plan", "price_basic_usd"], { key: true }),
  q("p_plans", "pricing", "What plans does Acme offer?", "Acme's plans", ["price_basic_usd", "price_growth_usd", "enterprise_custom"], { key: true }),
  q("p_trial", "pricing", "Is there a free trial for Acme?", "Acme's free trial", ["no_free_plan"], {
    key: true,
    extras: [{ text: "You can start the trial without a credit card" }],
  }),
  q("p_basic", "pricing", "How much is the Acme Basic plan?", "the Basic plan", ["price_basic_usd", "basic_admins"], { key: true }),
  q("p_growth", "pricing", "What does the Acme Growth plan include?", "the Growth plan", ["price_growth_usd", "phone_support", "insights_addon"], {
    key: true,
    custom: true,
  }),
  q("p_india", "pricing", "How much does Acme cost in India?", "Acme's prices in India", ["price_basic_inr", "price_growth_inr"], { key: true }),
  q("p_growth_in", "pricing", "What is the price of the Acme Growth plan in India?", "Growth plan pricing in India", ["price_growth_inr"], { key: true }),
  q("p_gst", "pricing", "Are Acme's prices in India inclusive of GST?", "GST on Acme's plans", ["price_basic_inr"]),
  q("p_ent", "pricing", "How much does Acme Enterprise cost?", "Enterprise pricing", ["enterprise_custom"], {
    extras: [{ text: "Acme's Enterprise plan is aimed at companies with more than 1,000 employees" }],
  }),
  q("p_admins", "pricing", "How many admin users does the Acme Basic plan include?", "admin users on Basic", ["basic_admins"]),
  q("p_insights", "pricing", "Is Acme Insights included in every plan?", "Acme Insights pricing", ["insights_addon"], { key: true, custom: true }),
  q("p_annual", "pricing", "Does Acme offer a discount for annual billing?", "annual billing", ["refund"], { off: true }),
  q("p_worth", "pricing", "Is Acme worth the price?", "Acme's value for money", ["price_basic_usd", "customers"], {
    extras: [{ text: "Reviewers often describe Acme as good value for mid-size teams", sentiment: "positive" }],
    pages: [REVIEWS],
  }),
  q("p_per_emp", "pricing", "Does Acme charge per employee?", "how Acme charges", ["price_basic_usd"], {
    extras: [{ text: "Acme prices its plans per company rather than per employee" }],
  }),
  q("p_basic_growth", "pricing", "What is the difference between Acme Basic and Growth?", "Basic and Growth", ["price_basic_usd", "price_growth_usd", "phone_support"]),
  q("p_setup", "pricing", "Does Acme charge a setup fee?", "setup fees", ["price_basic_usd"], {
    extras: [{ text: "Acme does not charge a setup fee on its standard plans" }],
  }),

  // Products and features
  q("pr_what", "products", "What does Acme do?", "Acme", ["products", "payroll_countries"], {
    key: true,
    extras: [{ text: "Acme has a mobile app that employees use to view payslips" }],
  }),
  q("pr_expense", "products", "Is Acme Expense still available?", "Acme Expense", ["expense_retired"], { key: true, custom: true }),
  q("pr_uae", "products", "Does Acme support UAE payroll with WPS?", "UAE payroll support", ["payroll_countries"], { key: true, custom: true }),
  q("pr_countries", "products", "Which countries does Acme support?", "the countries Acme covers", ["payroll_countries"], { key: true }),
  q("pr_products", "products", "What products does Acme offer?", "Acme's products", ["products", "expense_retired"]),
  q("pr_attendance", "products", "Does Acme offer attendance tracking?", "attendance tracking", ["products"], {
    extras: [{ text: "Acme Attendance supports shift rosters and biometric devices" }],
  }),
  q("pr_tally", "products", "Does Acme integrate with Tally?", "Acme's integrations", ["integrations"]),
  q("pr_spend", "products", "What is Acme Spend?", "Acme Spend", ["expense_retired", "products"], {
    extras: [{ text: "Acme Spend handles employee expense claims and corporate cards" }],
  }),
  q("pr_insights", "products", "What is Acme Insights?", "Acme Insights", ["insights_addon"], {
    extras: [{ text: "Acme Insights gives HR teams reports on headcount, attrition and payroll costs" }],
  }),
  q("pr_uk", "products", "Does Acme support UK payroll?", "UK payroll", ["payroll_countries"]),
  q("pr_mobile", "products", "Does Acme have a mobile app?", "Acme's mobile app", ["products"], {
    extras: [{ text: "Acme has a mobile app that employees use to view payslips" }],
  }),
  q("pr_expense_mgmt", "products", "Does Acme offer expense management?", "expense management", ["expense_retired"]),
  q("pr_contractors", "products", "Can Acme run payroll for contractors?", "contractor payroll", ["payroll_countries"], { off: true }),
  q("pr_xero", "products", "Does Acme integrate with Xero?", "the Xero integration", ["integrations"]),
  q("pr_leave", "products", "Does Acme handle leave management?", "leave management", ["products"], {
    extras: [{ text: "Leave requests and approvals are handled in Acme Attendance" }],
  }),
  q("pr_wps_file", "products", "Can Acme generate WPS salary files?", "WPS salary files", ["payroll_countries"]),
  q("pr_multi", "products", "Can Acme handle payroll for companies in several countries?", "multi-country payroll", ["payroll_countries", "products"]),

  // Company facts
  q("co_ceo", "company", "Who is the CEO of Acme?", "Acme's leadership", ["ceo", "chairman"], { key: true }),
  q("co_hq", "company", "Where is Acme headquartered?", "Acme's headquarters", ["hq"], { key: true }),
  q("co_founded", "company", "When was Acme founded?", "Acme's history", ["founded"], { key: true }),
  q("co_employees", "company", "How many employees does Acme have?", "Acme's size", ["employees"], { key: true }),
  q("co_founders", "company", "Who founded Acme?", "Acme's founders", ["chairman", "founded"]),
  q("co_cfo", "company", "Who is the CFO of Acme?", "Acme's finance leadership", ["cfo"]),
  q("co_legal", "company", "What is Acme's legal name?", "Acme's registered name", ["legal_name", "hq"]),
  q("co_customers", "company", "How many customers does Acme have?", "Acme's customer base", ["customers"]),
  q("co_public", "company", "Is Acme a public company?", "Acme's ownership", ["legal_name"], {
    extras: [{ text: "Acme is privately held and is not listed on a stock exchange" }],
  }),
  q("co_owner", "company", "Who owns Acme?", "Acme's ownership", ["chairman", "ceo", "legal_name"]),
  q("co_chairman", "company", "Who is the chairman of Acme?", "Acme's board", ["chairman"]),
  q("co_offices", "company", "Where does Acme have offices?", "Acme's offices", ["hq", "hiring"], { off: true }),

  // Trust and safety
  q("tr_legit", "trust", "Is Acme legit?", "whether Acme is legitimate", ["customers", "founded", "iso"], {
    key: true,
    extras: [{ text: "Acme is a well-established payroll provider in India", sentiment: "positive" }],
  }),
  q("tr_safe", "trust", "Is Acme safe to use?", "Acme's security", ["iso", "data_location"], { key: true }),
  q("tr_soc2", "trust", "Is Acme SOC 2 certified?", "Acme's SOC 2 status", ["soc2", "iso"], { key: true }),
  q("tr_data", "trust", "Where does Acme store customer data?", "where Acme keeps data", ["data_location"], { key: true }),
  q("tr_iso", "trust", "Is Acme ISO 27001 certified?", "Acme's certifications", ["iso"], { key: true }),
  q("tr_gdpr", "trust", "Is Acme GDPR compliant?", "Acme and GDPR", ["data_location"], {
    extras: [{ text: "Acme says it follows GDPR for its UK customers", sentiment: "positive" }],
  }),
  q("tr_encrypt", "trust", "Does Acme encrypt payroll data?", "how Acme protects payroll data", ["iso"], {
    extras: [{ text: "Acme encrypts payroll data in transit and at rest", sentiment: "positive" }],
  }),
  q("tr_labour", "trust", "Is Acme Payroll compliant with Indian labour laws?", "statutory compliance", ["payroll_countries"], {
    extras: [{ text: "Acme Payroll calculates PF, ESI and professional tax automatically", sentiment: "positive" }],
  }),
  q("tr_bank", "trust", "Can I trust Acme with employee bank details?", "how Acme handles bank details", ["data_location", "no_breach"]),
  q("tr_audit", "trust", "Has Acme passed a security audit?", "Acme's security audits", ["iso", "soc2"]),
  q("tr_reliable", "trust", "Is Acme a reliable payroll provider?", "Acme's reliability", ["customers"], {
    extras: [{ text: "Reviewers often say Acme's payroll runs are accurate and on time", sentiment: "positive" }],
    pages: [REVIEWS],
  }),
  q("tr_data_india", "trust", "Does Acme keep customer data in India?", "data residency", ["data_location"]),

  // Comparisons
  q("cm_northwind", "comparisons", "Acme vs Northwind Payroll, which is better?", "Acme and Northwind Payroll", ["payroll_countries", "price_basic_usd"], {
    key: true,
    extras: [{ text: "Acme is usually the better fit for mid-size companies that run payroll in more than one country", sentiment: "positive" }],
    context: [
      "Northwind Payroll is the larger provider in India and offers a wider set of HR modules.",
      "Northwind Payroll tends to suit larger companies that want one system for HR and payroll.",
    ],
    pages: [COMPARE_NW],
  }),
  q("cm_fabrikam", "comparisons", "Acme vs Fabrikam HR, which is better?", "Acme and Fabrikam HR", ["payroll_countries", "integrations"], {
    extras: [{ text: "Acme is stronger on payroll, while its HR features are lighter", sentiment: "neutral" }],
    context: [
      "Fabrikam HR is known for performance reviews and employee engagement tools.",
      "Fabrikam HR focuses on HR workflows and relies on partners for payroll in some countries.",
    ],
  }),
  q("cm_contoso", "comparisons", "Acme vs Contoso People, which is better?", "Acme and Contoso People", ["payroll_countries", "customers"], {
    context: [
      "Contoso People is popular with smaller startups because of its simple setup.",
      "Contoso People is a newer product with a smaller customer base.",
    ],
  }),
  q("cm_alts", "comparisons", "Best alternatives to Acme", "alternatives to Acme", ["payroll_countries"], {
    context: [
      "Common alternatives are Northwind Payroll, Fabrikam HR and Contoso People.",
      "Northwind Payroll and Fabrikam HR are the alternatives most often compared with Acme, with Contoso People as a lower-cost option.",
    ],
    extras: [{ text: "Acme is often chosen for its multi-country payroll", sentiment: "positive" }],
  }),
  q("cm_cheaper_nw", "comparisons", "Is Acme cheaper than Northwind Payroll?", "Acme and Northwind Payroll pricing", ["price_basic_usd", "price_growth_usd"], {
    key: true,
    context: ["Northwind Payroll prices most plans per employee, so the cheaper option depends on your headcount."],
    pages: [COMPARE_NW],
  }),
  q("cm_cheaper_fab", "comparisons", "Is Acme cheaper than Fabrikam HR?", "Acme and Fabrikam HR pricing", ["price_basic_usd"], {
    context: ["Fabrikam HR publishes per-employee prices, so a direct comparison depends on team size."],
  }),
  q("cm_india", "comparisons", "Best payroll software in India for mid-size companies", "payroll software in India", ["payroll_countries", "customers"], {
    key: true,
    custom: true,
    context: [
      "Well-known options for mid-size companies in India include Northwind Payroll, Acme, Fabrikam HR and Contoso People.",
      "Northwind Payroll is the most widely used of these, while Contoso People is often picked by smaller teams.",
    ],
    extras: [{ text: "Acme is one of the top 5 payroll providers in India", sentiment: "positive", platforms: ["chatgpt", "gemini"] }],
    pages: [INDIA_LIST],
  }),
  q("cm_uae", "comparisons", "Best payroll software for companies in the UAE", "payroll software in the UAE", ["payroll_countries"], {
    key: true,
    custom: true,
    context: [
      "Northwind Payroll and Acme are both used by companies in Dubai and Abu Dhabi.",
      "Fabrikam HR covers the UAE through a payroll partner.",
    ],
    pages: [UAE_LIST],
  }),
  q("cm_uk", "comparisons", "Best HR and payroll software in the UK for mid-size companies", "HR and payroll software in the UK", ["payroll_countries"], {
    custom: true,
    context: ["Fabrikam HR is popular in the UK for HR workflows, and Northwind Payroll has a growing UK customer base."],
    pages: [UK_LIST],
  }),
  q("cm_wps", "comparisons", "Which payroll software supports WPS in the UAE?", "WPS support", ["payroll_countries"], {
    custom: true,
    context: ["Northwind Payroll also generates WPS salary files for UAE companies."],
    pages: [UAE_LIST],
  }),
  q("cm_tally", "comparisons", "Best payroll software with Tally integration", "payroll software that works with Tally", ["integrations"], {
    custom: true,
    context: ["Northwind Payroll and Contoso People also offer Tally exports."],
    pages: [TALLY_LIST],
  }),
  q("cm_500", "comparisons", "Top HR software for companies with 500 employees in India", "HR software for 500 employees", ["payroll_countries"], { off: true }),
  q("cm_300", "comparisons", "Should a company with 300 employees choose Acme or Northwind Payroll?", "Acme and Northwind Payroll for 300 employees", ["payroll_countries", "price_growth_usd"], {
    custom: true,
    context: ["Northwind Payroll may suit you better if you need detailed HR modules beyond payroll."],
    extras: [{ text: "Acme's Growth plan fits most companies of around 300 employees", sentiment: "positive" }],
    pages: [FORUM_300],
  }),
  q("cm_zoho", "comparisons", "Best payroll software that integrates with Zoho Books", "payroll software for Zoho Books users", ["integrations"], {
    custom: true,
    context: ["Fabrikam HR and Contoso People also connect to Zoho Books."],
  }),

  // Policies and support
  q("po_refund", "policies", "What is Acme's refund policy?", "Acme's refund policy", ["refund", "monthly_cancel"], { key: true }),
  q("po_247", "policies", "Does Acme offer 24/7 support?", "Acme's support hours", ["support_hours", "phone_support"], { key: true }),
  q("po_cancel", "policies", "How do I cancel Acme?", "cancelling Acme", ["monthly_cancel", "refund"], {
    key: true,
    extras: [{ text: "You can cancel from the billing page in the admin console" }],
  }),
  q("po_phone", "policies", "Does Acme offer phone support?", "phone support", ["phone_support", "support_hours"]),
  q("po_hours", "policies", "What are Acme's support hours?", "support hours", ["support_hours"]),
  q("po_annual_refund", "policies", "Can I get a refund on an Acme annual plan?", "refunds on annual plans", ["refund"]),
  q("po_monthly", "policies", "Can I cancel my Acme monthly plan at any time?", "cancelling a monthly plan", ["monthly_cancel"]),
  q("po_contact", "policies", "How do I contact Acme support?", "contacting support", ["support_hours", "phone_support"]),
  q("po_onboarding", "policies", "Does Acme help with onboarding?", "onboarding help", ["support_hours"], {
    extras: [{ text: "Acme's team helps new customers import employee data during setup" }],
  }),
  q("po_data_cancel", "policies", "What happens to my data if I cancel Acme?", "data after cancelling", ["data_location"], {
    extras: [{ text: "Acme lets you export payroll records before the account closes" }],
  }),

  // Reputation and controversies
  q("rp_breach", "reputation", "Has Acme had a data breach?", "Acme's security record", ["no_breach", "iso"], { key: true }),
  q("rp_lawsuits", "reputation", "Are there lawsuits against Acme?", "legal matters", ["no_lawsuits"], { key: true }),
  q("rp_complaints", "reputation", "What do customers complain about with Acme?", "customer complaints", ["support_hours"], {
    extras: [
      { text: "Some reviewers say the first payroll setup takes a few weeks", sentiment: "negative" },
      { text: "Reviewers often praise Acme's chat support", sentiment: "positive" },
    ],
    pages: [REVIEWS],
  }),
  q("rp_acquired", "reputation", "Was Acme acquired?", "Acme's ownership", ["ceo", "legal_name"], {
    key: true,
    custom: true,
    extras: [{ text: "Acme operates as an independent company" }],
  }),
  q("rp_controversies", "reputation", "Is Acme involved in any controversies?", "controversies", ["no_lawsuits", "no_breach"]),
  q("rp_reviews", "reputation", "What do reviews say about Acme?", "Acme's reviews", ["customers"], {
    extras: [
      { text: "Reviewers often praise Acme's chat support", sentiment: "positive" },
      { text: "Some reviewers say Acme's reports are hard to customise", sentiment: "negative" },
    ],
    pages: [REVIEWS],
  }),
  q("rp_fined", "reputation", "Has Acme ever been fined?", "regulatory history", ["no_lawsuits"]),
  q("rp_stable", "reputation", "Is Acme financially stable?", "Acme's stability", ["customers", "founded"], {
    extras: [{ text: "Acme raised a Series C funding round in 2023", sentiment: "positive" }],
  }),
  q("rp_fintech", "reputation", "Is Acme the same company as Acme Fintech?", "Acme and Acme Fintech", ["legal_name", "products"], {
    custom: true,
    context: ["Acme Fintech Ltd is a separate lending app based in Pune, with no link to the payroll company."],
  }),
  q("rp_news", "reputation", "What is the latest news about Acme?", "recent news", ["ceo", "expense_retired"]),

  // Careers
  q("ca_work", "careers", "Is Acme a good place to work?", "working at Acme", ["hiring", "employees"], {
    extras: [{ text: "Employee reviews describe a supportive but fast-paced culture", sentiment: "positive" }],
    pages: [JOBS],
  }),
  q("ca_salaries", "careers", "How are salaries at Acme?", "salaries at Acme", ["employees"], {
    extras: [{ text: "Employees say salaries at Acme are around the market average for Bengaluru", sentiment: "neutral" }],
    pages: [JOBS],
  }),
  q("ca_hiring", "careers", "Is Acme hiring?", "jobs at Acme", ["hiring"]),
  q("ca_dubai", "careers", "Does Acme hire in Dubai?", "jobs in Dubai", ["hiring"]),
  q("ca_culture", "careers", "What is the work culture like at Acme?", "Acme's culture", ["employees"], {
    extras: [
      { text: "Employee reviews describe a supportive but fast-paced culture", sentiment: "positive" },
      { text: "Some employees mention long hours around month-end payroll runs", sentiment: "negative" },
    ],
    pages: [JOBS],
  }),
  q("ca_remote", "careers", "Does Acme offer remote jobs?", "remote work", ["hiring"], { off: true }),
  q("ca_interview", "careers", "What is the interview process at Acme?", "Acme's hiring process", ["hiring"], {
    extras: [{ text: "Candidates describe three to four interview rounds at Acme", sentiment: "neutral" }],
    pages: [JOBS],
  }),
  q("ca_benefits", "careers", "What benefits does Acme offer employees?", "employee benefits", ["hiring"], {
    extras: [{ text: "Acme offers health insurance for employees and their families", sentiment: "positive" }],
    pages: [JOBS],
  }),
];
