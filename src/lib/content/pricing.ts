/*
  Copy for the public pricing page. Prices themselves live in
  src/lib/domain/constants.ts (PRICES, PLAN_FEATURES).
*/

export const PLAN_SUMMARIES = {
  starter: "One brand, checked every two weeks on three AI assistants. For a first, steady view of what AI says.",
  professional: "Weekly checks on all four AI assistants, instant alerts and a quarterly review call.",
  enterprise: "Several brands, more languages, daily crisis mode and reports with your own logo.",
} as const;

/** Months charged for a year paid upfront: pay for 10 months, get 12. */
export const ANNUAL_MONTHS_CHARGED = 10;

/** The full audit fee is credited toward a subscription started within this many days. */
export const AUDIT_CREDIT_DAYS = 30;

/** Founding prices stay fixed for this many months. */
export const FOUNDING_LOCK_MONTHS = 12;

export const PRICING_FAQ: { question: string; answer: string }[] = [
  {
    question: "Do you need access to our systems?",
    answer:
      "No. TrueCite only uses AI answers, your public website and the public pages AI assistants cite. It never needs your analytics, CRM, email, website backend or customer data, so there is very little for your security team to review.",
  },
  {
    question: "Can you guarantee that AI answers will change?",
    answer:
      "No one can. TrueCite shows what AI assistants say, where the errors most likely come from and how to fix them, then re-checks after every fix. Assistants that search the web live usually change within weeks; answers that come from what a model learned in training can take months.",
  },
  {
    question: "Who makes the fixes?",
    answer:
      "Your team. Each issue comes with step-by-step guidance, such as which page to update or which publisher to contact. TrueCite tracks the result on every scan and shows progress per AI assistant.",
  },
  {
    question: "Can we start with the audit and subscribe later?",
    answer:
      "Yes. If you subscribe within 30 days of the audit, the audit fee is credited toward your first months. Plans run month to month, and you can cancel at any time.",
  },
  {
    question: "Which AI assistants do you check?",
    answer:
      "ChatGPT, Gemini, Perplexity and Claude, through each provider's official API with web search turned on where available. TrueCite is not affiliated with or endorsed by any of these companies.",
  },
  {
    question: "Can we pay by invoice?",
    answer:
      "Yes. Annual plans and Enterprise plans are invoiced. Indian companies receive GST invoices so they can claim input tax credit.",
  },
];
