/*
  Domain vocabulary for TrueCite. Every label shown in the interface comes from
  here, so the same thing is always called the same name.
*/

export const PLATFORMS = {
  chatgpt: {
    id: "chatgpt",
    name: "ChatGPT",
    provider: "OpenAI",
    access: "OpenAI API with web search",
  },
  gemini: {
    id: "gemini",
    name: "Gemini",
    provider: "Google",
    access: "Gemini API with Google Search grounding",
  },
  perplexity: {
    id: "perplexity",
    name: "Perplexity",
    provider: "Perplexity",
    access: "Perplexity API, which returns citations",
  },
  claude: {
    id: "claude",
    name: "Claude",
    provider: "Anthropic",
    access: "Anthropic API with web search",
  },
} as const;

export type PlatformId = keyof typeof PLATFORMS;
export const PLATFORM_IDS = ["chatgpt", "gemini", "perplexity", "claude"] as const satisfies readonly PlatformId[];

export const IMPORTANCE = {
  critical: { label: "Critical", weight: 10 },
  high: { label: "High", weight: 5 },
  medium: { label: "Medium", weight: 2 },
  low: { label: "Low", weight: 1 },
} as const;

export type Importance = keyof typeof IMPORTANCE;
export type Severity = Importance;
export const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const satisfies readonly Severity[];

export const VERDICTS = {
  correct: { label: "Correct", description: "Matches an approved, current fact" },
  incorrect: { label: "Incorrect", description: "Contradicts a current fact" },
  outdated: { label: "Outdated", description: "Matches a fact that is no longer valid" },
  confused: { label: "Confused", description: "Describes another company" },
  unsupported: {
    label: "Unsupported",
    description: "Not covered by the Fact Sheet and cannot be verified",
  },
  missing: { label: "Missing", description: "AI does not give an important fact it should know" },
} as const;

export type Verdict = keyof typeof VERDICTS;
export const ERROR_VERDICTS = ["incorrect", "outdated", "confused", "missing"] as const satisfies readonly Verdict[];
export type ErrorVerdict = (typeof ERROR_VERDICTS)[number];

export const ISSUE_STATUSES = {
  open: { label: "Open", description: "A confirmed error nobody has acted on yet" },
  in_progress: { label: "In progress", description: "Someone on your team is working on the fix" },
  fixed_rechecking: {
    label: "Fixed, re-checking",
    description: "The fix is done and TrueCite is checking whether AI answers have changed",
  },
  resolved: {
    label: "Resolved",
    description: "AI answers have been correct and consistent for two scans in a row",
  },
  reopened: { label: "Reopened", description: "The error came back after being resolved" },
} as const;

export type IssueStatus = keyof typeof ISSUE_STATUSES;
export const ISSUE_STATUS_ORDER = [
  "open",
  "reopened",
  "in_progress",
  "fixed_rechecking",
  "resolved",
] as const satisfies readonly IssueStatus[];

/** Statuses that still count as a risk: everything except resolved. */
export const UNRESOLVED_STATUSES = ["open", "reopened", "in_progress", "fixed_rechecking"] as const satisfies readonly IssueStatus[];

export const REVIEW_STATES = {
  pending: { label: "Waiting for review" },
  approved: { label: "Approved" },
  rejected: { label: "Rejected" },
} as const;

export type ReviewState = keyof typeof REVIEW_STATES;

export const QUESTION_CATEGORIES = {
  pricing: {
    label: "Pricing and plans",
    templates: [
      "How much does {brand} cost?",
      "Does {brand} have a free plan?",
      "What plans does {brand} offer?",
      "Is there a free trial for {brand}?",
    ],
  },
  products: {
    label: "Products and features",
    templates: [
      "What does {brand} do?",
      "Does {brand} offer {feature}?",
      "Is {product} still available?",
      "Which countries does {brand} support?",
    ],
  },
  company: {
    label: "Company facts",
    templates: [
      "Who is the CEO of {brand}?",
      "Where is {brand} headquartered?",
      "When was {brand} founded?",
      "How many employees does {brand} have?",
    ],
  },
  trust: {
    label: "Trust and safety",
    templates: [
      "Is {brand} legit?",
      "Is {brand} safe to use?",
      "Is {brand} SOC 2 certified?",
      "Where does {brand} store customer data?",
    ],
  },
  comparisons: {
    label: "Comparisons",
    templates: [
      "{brand} vs {competitor}, which is better?",
      "Best alternatives to {brand}",
      "Is {brand} cheaper than {competitor}?",
    ],
  },
  policies: {
    label: "Policies and support",
    templates: [
      "What is {brand}'s refund policy?",
      "Does {brand} offer 24/7 support?",
      "How do I cancel {brand}?",
    ],
  },
  reputation: {
    label: "Reputation and controversies",
    templates: [
      "Has {brand} had a data breach?",
      "Are there lawsuits against {brand}?",
      "What do customers complain about with {brand}?",
    ],
  },
  careers: {
    label: "Careers",
    templates: ["Is {brand} a good place to work?", "How are salaries at {brand}?"],
  },
} as const;

export type QuestionCategory = keyof typeof QUESTION_CATEGORIES;
export const QUESTION_CATEGORY_IDS = Object.keys(QUESTION_CATEGORIES) as QuestionCategory[];

export const FACT_CATEGORIES = {
  pricing: { label: "Pricing" },
  products: { label: "Products" },
  leadership: { label: "Leadership" },
  company: { label: "Company" },
  policies: { label: "Policies" },
  support: { label: "Support" },
  security: { label: "Security and compliance" },
  legal: { label: "Legal" },
  careers: { label: "Careers" },
} as const;

export type FactCategory = keyof typeof FACT_CATEGORIES;
export const FACT_CATEGORY_IDS = Object.keys(FACT_CATEGORIES) as FactCategory[];

export const FACT_STATUSES = {
  draft: { label: "Draft" },
  approved: { label: "Approved" },
  archived: { label: "Archived" },
} as const;

export type FactStatus = keyof typeof FACT_STATUSES;

export const LANGUAGES = {
  en: { label: "English", available: true },
  hi: { label: "Hindi", available: false },
  hinglish: { label: "Hinglish", available: false },
} as const;

export type LanguageId = keyof typeof LANGUAGES;

export const MARKETS = {
  IN: { label: "India" },
  US: { label: "United States" },
  GB: { label: "United Kingdom" },
  AE: { label: "United Arab Emirates" },
  AU: { label: "Australia" },
  SG: { label: "Singapore" },
} as const;

export type MarketId = keyof typeof MARKETS;

export const SOURCE_TYPES = {
  own_site: { label: "Your website" },
  news: { label: "News article" },
  review_site: { label: "Review site" },
  forum: { label: "Forum" },
  directory: { label: "Business directory" },
  wikipedia: { label: "Wikipedia or Wikidata" },
  competitor: { label: "Competitor page" },
  social: { label: "Social media" },
  other: { label: "Other website" },
} as const;

export type SourceType = keyof typeof SOURCE_TYPES;

export const SOURCE_LIKELIHOOD = {
  likely: { label: "Likely source" },
  possible: { label: "Possible source" },
  unlikely: { label: "Checked, not the source" },
} as const;

export type SourceLikelihood = keyof typeof SOURCE_LIKELIHOOD;

/** Where an error most likely comes from: live web pages, or what the model learned in training. */
export const ISSUE_ORIGINS = {
  web: { label: "From web pages", description: "The AI cited pages that contain the error." },
  memory: {
    label: "From AI memory",
    description:
      "No citations. The error probably comes from what the model learned during training, which usually takes longer to change.",
  },
} as const;

export type IssueOrigin = keyof typeof ISSUE_ORIGINS;

export const ROLES = {
  owner: { label: "Owner", description: "Manages billing, the team and every setting" },
  member: { label: "Member", description: "Works on issues, facts and questions" },
  viewer: { label: "Viewer", description: "Sees results and reports" },
} as const;

export type Role = keyof typeof ROLES;

export const SCAN_TYPES = {
  scheduled: { label: "Scheduled" },
  manual: { label: "Manual" },
  audit: { label: "Full audit" },
  prospect: { label: "Prospect" },
  recheck: { label: "Re-check" },
  competitor: { label: "Competitor" },
} as const;

export type ScanType = keyof typeof SCAN_TYPES;

export const SCAN_STATUSES = {
  queued: { label: "Queued" },
  running: { label: "Asking AI assistants" },
  checking: { label: "Checking answers" },
  completed: { label: "Completed" },
  failed: { label: "Failed" },
  cancelled: { label: "Cancelled" },
} as const;

export type ScanStatus = keyof typeof SCAN_STATUSES;

export const JOB_STATUSES = {
  queued: { label: "Queued" },
  running: { label: "Running" },
  done: { label: "Done" },
  failed: { label: "Failed" },
} as const;

export type JobStatus = keyof typeof JOB_STATUSES;

export const SCAN_FREQUENCIES = {
  weekly: { label: "Weekly", perMonth: 4.33 },
  biweekly: { label: "Every 2 weeks", perMonth: 2.17 },
  monthly: { label: "Monthly", perMonth: 1 },
  manual: { label: "Only when started by hand", perMonth: 0 },
} as const;

export type ScanFrequency = keyof typeof SCAN_FREQUENCIES;

export const ONBOARDING_STEPS = {
  company: { label: "Company details", step: 1 },
  facts: { label: "Fact Sheet review", step: 2 },
  questions: { label: "Question Set review", step: 3 },
  scan: { label: "First scan", step: 4 },
  done: { label: "Done", step: 5 },
} as const;

export type OnboardingStep = keyof typeof ONBOARDING_STEPS;

export const ALERT_CHANNELS = {
  email: { label: "Email", available: true },
  slack: { label: "Slack", available: false },
  teams: { label: "Microsoft Teams", available: false },
  whatsapp: { label: "WhatsApp", available: false },
} as const;

export type AlertChannel = keyof typeof ALERT_CHANNELS;

export const ALERT_FREQUENCIES = {
  instant: { label: "Straight away" },
  weekly: { label: "Weekly digest" },
} as const;

export type AlertFrequency = keyof typeof ALERT_FREQUENCIES;

export const PROSPECT_STATUSES = {
  new: { label: "New" },
  scanning: { label: "Scanning" },
  reviewing: { label: "Reviewing findings" },
  report_ready: { label: "Report ready" },
  contacted: { label: "Contacted" },
  replied: { label: "Replied" },
  call_booked: { label: "Call booked" },
  audit_sold: { label: "Audit sold" },
  won: { label: "Subscribed" },
  lost: { label: "Not interested" },
} as const;

export type ProspectStatus = keyof typeof PROSPECT_STATUSES;

export const CHECK_REQUEST_STATUSES = {
  new: { label: "New" },
  accepted: { label: "Accepted" },
  declined: { label: "Declined" },
} as const;

export type CheckRequestStatus = keyof typeof CHECK_REQUEST_STATUSES;

export const REPORT_TYPES = {
  monthly: { label: "Monthly report" },
  audit: { label: "Full audit" },
  prospect: { label: "Prospect report" },
} as const;

export type ReportType = keyof typeof REPORT_TYPES;

export const SUBSCRIPTION_STATUSES = {
  trialing: { label: "Trial" },
  active: { label: "Active" },
  past_due: { label: "Payment overdue" },
  cancelled: { label: "Cancelled" },
} as const;

export type SubscriptionStatus = keyof typeof SUBSCRIPTION_STATUSES;

export const INVOICE_STATUSES = {
  paid: { label: "Paid" },
  due: { label: "Due" },
  overdue: { label: "Overdue" },
  void: { label: "Void" },
} as const;

export type InvoiceStatus = keyof typeof INVOICE_STATUSES;

export type Currency = "USD" | "INR";

export const PLAN_IDS = ["trial", "starter", "professional", "enterprise"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export type PlanLimits = {
  label: string;
  brands: number | "several";
  questions: number | "custom";
  platforms: number | "all";
  runsPerQuestion: number;
  frequency: ScanFrequency | "custom";
  competitors: number | "custom";
  teamMembers: number | "custom";
};

export const PLANS: Record<PlanId, PlanLimits> = {
  trial: {
    label: "Trial",
    brands: 1,
    questions: 30,
    platforms: 2,
    runsPerQuestion: 2,
    frequency: "manual",
    competitors: 2,
    teamMembers: 3,
  },
  starter: {
    label: "Starter",
    brands: 1,
    questions: 50,
    platforms: 3,
    runsPerQuestion: 2,
    frequency: "biweekly",
    competitors: 2,
    teamMembers: 3,
  },
  professional: {
    label: "Professional",
    brands: 1,
    questions: 100,
    platforms: 4,
    runsPerQuestion: 3,
    frequency: "weekly",
    competitors: 5,
    teamMembers: 10,
  },
  enterprise: {
    label: "Enterprise",
    brands: "several",
    questions: "custom",
    platforms: "all",
    runsPerQuestion: 3,
    frequency: "custom",
    competitors: "custom",
    teamMembers: "custom",
  },
};

/** The plan comparison shown on the pricing page, row by row, as in the product plan. */
export const PLAN_FEATURES: { feature: string; starter: string; professional: string; enterprise: string }[] = [
  { feature: "Brands monitored", starter: "1", professional: "1", enterprise: "Several" },
  { feature: "Questions", starter: "50", professional: "100", enterprise: "Custom" },
  { feature: "AI platforms", starter: "3", professional: "4", enterprise: "All available" },
  { feature: "Runs per question", starter: "2", professional: "3", enterprise: "3 or more" },
  {
    feature: "Scan frequency",
    starter: "Every 2 weeks",
    professional: "Weekly",
    enterprise: "Custom, plus daily crisis mode",
  },
  { feature: "Competitors", starter: "2", professional: "5", enterprise: "Custom" },
  { feature: "Languages", starter: "English", professional: "English", enterprise: "English, Hindi, Hinglish and more" },
  {
    feature: "Alerts",
    starter: "Weekly email digest",
    professional: "Instant email alerts and digest",
    enterprise: "Email, Slack, Teams, WhatsApp",
  },
  {
    feature: "Reports",
    starter: "Monthly",
    professional: "Monthly, plus a quarterly review call",
    enterprise: "Custom, with your own logo",
  },
  { feature: "Team members", starter: "3", professional: "10", enterprise: "Custom" },
];

/**
 * Public prices. These are starting points to test with real buyers; change them here.
 * INR prices exclude 18% GST.
 */
export const PRICES = {
  USD: {
    audit: 400,
    starter: 400,
    starterRegular: 1000,
    professional: 2500,
    enterpriseFrom: 5000,
  },
  INR: {
    audit: 15000,
    starter: 12000,
    starterRegular: 20000,
    professional: 35000,
    enterpriseFrom: 50000,
  },
} as const satisfies Record<Currency, Record<string, number>>;

export const GST_RATE = 0.18;

/** Keep API costs below this share of what each client pays. */
export const MARGIN_LIMIT = 0.2;

/** An issue moves to Resolved after this many clean scans in a row. */
export const CLEAN_SCANS_TO_RESOLVE = 2;

/** Prospect report links stop working after this many days. */
export const PROSPECT_LINK_DAYS = 30;

export const SYSTEM_ACTOR = "TrueCite";
