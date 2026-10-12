import { COMPANY } from "./company";

/*
  The public legal pages: Terms of Service, Privacy Policy, and Refund and
  Cancellation Policy. Plain-language drafts; have them reviewed by a lawyer
  before taking payments. Each section is a heading and a list of blocks: a
  string is a paragraph, { list } is a bulleted list.
*/

export type LegalBlock = string | { list: string[] };
export type LegalSection = { id: string; title: string; blocks: LegalBlock[] };
export type LegalDocumentContent = {
  title: string;
  description: string;
  intro: string;
  sections: LegalSection[];
};

const email = COMPANY.email;

export const TERMS: LegalDocumentContent = {
  title: "Terms of Service",
  description: "The agreement between TrueCite and the companies that use it.",
  intro:
    "These terms apply when your company uses TrueCite, including the free mini-report, the full audit and monitoring plans. By creating an account or ordering a report, you accept them on behalf of your company.",
  sections: [
    {
      id: "service",
      title: "What TrueCite does",
      blocks: [
        "TrueCite asks AI assistants such as ChatGPT, Gemini, Perplexity and Claude questions about your company, compares their answers with the facts you approve, and reports what is wrong, where it most likely came from and how your team can fix it.",
        "TrueCite reports what AI assistants say. It does not control those assistants and cannot guarantee that any assistant will change its answers, or when. Fix steps are guidance: your team decides whether and how to carry them out.",
        "TrueCite is not affiliated with, endorsed by or partnered with OpenAI, Google, Perplexity or Anthropic. Their product names are used only to describe what TrueCite monitors.",
      ],
    },
    {
      id: "accounts",
      title: "Your account",
      blocks: [
        "You must give accurate details when you sign up and keep your login private. The account owner decides who joins the team and what role each person has: owner, member or viewer.",
        "You are responsible for what happens under your account. Tell us straight away at " +
          email +
          " if you think someone has used it without permission.",
      ],
    },
    {
      id: "your-content",
      title: "Your facts and content",
      blocks: [
        "You own the facts, questions and other material you add to TrueCite. You give us permission to use them only to run the service for you, for example to check AI answers against your Fact Sheet.",
        "You are responsible for making sure the facts you approve are accurate and current. TrueCite checks answers against them, so an outdated fact leads to an outdated verdict.",
      ],
    },
    {
      id: "reports",
      title: "Findings and reports",
      blocks: [
        "Findings are reported neutrally, as what an AI assistant stated on a given date. AI answers vary between runs and between the API versions TrueCite uses and the consumer apps people see, and TrueCite's checker can make mistakes. Each report explains its method and limitations.",
        "Reports are information, not legal advice. If a finding has legal consequences, such as a false claim about a lawsuit or a regulator, involve your own lawyers.",
        "You may share your reports inside your company and with your advisers. Share links you create can be switched off at any time.",
      ],
    },
    {
      id: "acceptable-use",
      title: "Acceptable use",
      blocks: [
        "Use TrueCite only to monitor your own company, its products and the competitors you name for comparison. Do not:",
        {
          list: [
            "try to reach other clients' data or test the service's security without written permission",
            "resell the service or its reports without an agreement with us",
            "use findings to make false or misleading claims about another company",
            "overload the service or work around its limits",
          ],
        },
      ],
    },
    {
      id: "fees",
      title: "Fees and payment",
      blocks: [
        "Prices are listed on the pricing page or in your order. Monitoring plans are billed monthly in advance, or yearly in advance for annual plans. Prices in Indian rupees exclude 18% GST, which is added to the invoice.",
        "Invoices are due within 15 days unless your order says otherwise. If a payment is more than 30 days late, we may pause scans after giving you notice. Your data stays available while the account is paused.",
        "Founding prices stay fixed for 12 months from the start of the subscription. After that, we give at least 30 days' notice before any price change.",
        "Refunds and cancellations follow the Refund and Cancellation Policy.",
      ],
    },
    {
      id: "availability",
      title: "Availability and changes",
      blocks: [
        "We work to keep TrueCite available and scans on schedule, but the service depends on AI providers whose systems and terms can change. If a provider becomes unavailable, we will tell you and, where we can, offer another platform for the rest of your plan.",
        "We may improve or change features. If a change removes something your plan clearly includes, we will tell you in advance, and you may cancel without charge for the remaining period.",
      ],
    },
    {
      id: "confidentiality",
      title: "Confidentiality",
      blocks: [
        "We keep your findings, reports and account details confidential and use them only to provide the service. We do not publish your results or name you as a client without your permission.",
      ],
    },
    {
      id: "liability",
      title: "Limitation of liability",
      blocks: [
        "TrueCite is provided with reasonable skill and care, but without any promise that AI assistants will change their answers or that every error will be found.",
        "To the extent the law allows, neither party is liable for indirect or consequential losses, such as lost profits, lost business or harm to reputation, and our total liability for any claim is limited to the fees you paid us in the 12 months before the claim arose.",
        "Nothing in these terms limits liability that cannot be limited by law, such as liability for fraud.",
      ],
    },
    {
      id: "ending",
      title: "Ending the agreement",
      blocks: [
        "You can cancel your subscription at any time from the billing page or by email. Your plan stays active until the end of the period you have paid for.",
        "We may suspend or close an account that breaks these terms, after warning you where that is reasonable. When an account closes, we delete its data as described in the Privacy Policy.",
      ],
    },
    {
      id: "law",
      title: "Governing law",
      blocks: [
        "These terms are governed by the laws of India. Both parties will first try to settle any dispute by talking. If that fails, the courts with jurisdiction over our registered office decide it.",
        "Larger clients may sign their own vendor agreement or a master services agreement with us. Where that agreement and these terms differ, the signed agreement applies.",
      ],
    },
    {
      id: "changes",
      title: "Changes to these terms",
      blocks: [
        "If we change these terms, we update the date at the top of this page and email account owners at least 30 days before a material change takes effect.",
        "Questions about these terms: " + email + ".",
      ],
    },
  ],
};

export const PRIVACY: LegalDocumentContent = {
  title: "Privacy Policy",
  description: "What personal data TrueCite stores, why, for how long and what you can ask us to do with it.",
  intro:
    "TrueCite needs very little personal data. It never needs access to your systems or your customers' data. This policy explains what we store, why, and your rights under India's Digital Personal Data Protection Act, 2023 and, for people in the European Union and the United Kingdom, the GDPR.",
  sections: [
    {
      id: "who",
      title: "Who is responsible",
      blocks: [
        "TrueCite is the data fiduciary under India's Digital Personal Data Protection Act and the controller under the GDPR for the personal data described here. You can reach us at " +
          email +
          ". Our registered business address is listed on the contact page.",
      ],
    },
    {
      id: "what",
      title: "What we store",
      blocks: [
        {
          list: [
            "Account details: names, work email addresses, roles and login records of the people on your team.",
            "Free check requests: the company, website, name, work email, role and message you send us.",
            "Public facts about your company that you approve in your Fact Sheet, and public facts about the competitors you name.",
            "AI answers to the questions we ask, the public web pages those answers cite, and the reports built from them.",
            "Billing details: company name, billing address, tax number and invoices. Card payments are handled by the payment provider; we do not store card numbers.",
          ],
        },
        "We do not ask for, and do not store, your customers' data, your analytics, your CRM or your email. AI answers sometimes mention public figures, such as executives named in the news; we keep these only as part of the answer they appeared in.",
      ],
    },
    {
      id: "why",
      title: "Why we use it",
      blocks: [
        {
          list: [
            "To provide the service you signed up for: running scans, showing issues and sending reports and alerts. Legal basis under the GDPR: performance of a contract.",
            "To reply to a free check request and send the mini-report. Legal basis: your consent, given when you send the form, which you can withdraw at any time.",
            "To keep the service secure, keep an audit log of important actions and prevent abuse. Legal basis: our legitimate interests.",
            "To issue invoices and meet tax and accounting rules. Legal basis: legal obligation.",
          ],
        },
        "We do not sell personal data, use it for advertising or use your data to train AI models.",
      ],
    },
    {
      id: "processors",
      title: "Who processes it for us",
      blocks: [
        "We use a small number of service providers, each under a contract that limits them to processing data on our instructions:",
        {
          list: [
            "a hosting provider, which runs the application",
            "a database provider, which stores data encrypted at rest",
            "an email provider, which delivers alerts, invitations and reports",
            "AI providers, which receive the questions we ask about your company and return their answers; we send them questions and public facts, not your team's personal data",
            "a payment provider, which handles card and bank payments",
          ],
        },
        "Some of these providers process data outside India and outside the European Economic Area. Where the GDPR applies, we rely on adequacy decisions or standard contractual clauses for these transfers.",
      ],
    },
    {
      id: "retention",
      title: "How long we keep it",
      blocks: [
        {
          list: [
            "Account data, findings and reports: for as long as your account is open.",
            "When an account closes: we delete its data within 30 days, and it leaves our backups within a further 30 days.",
            "Free check requests that do not become clients: deleted after 12 months.",
            "Invoices and billing records: kept for 8 years, as Indian tax law requires.",
          ],
        },
      ],
    },
    {
      id: "security",
      title: "How we protect it",
      blocks: [
        "All traffic uses HTTPS, data is encrypted at rest, and each client's data is kept separate. Team members have roles that limit what they can change, and important actions are logged. If a breach affects your personal data, we will notify you and the relevant authorities as the law requires.",
      ],
    },
    {
      id: "rights",
      title: "Your rights",
      blocks: [
        "You can ask us to:",
        {
          list: [
            "tell you what personal data we hold about you and give you a copy",
            "correct data that is wrong or incomplete",
            "delete your data, unless we must keep it by law",
            "withdraw consent you have given, such as for a free check request",
            "object to or restrict some uses, or move your data to another service, where the GDPR applies",
          ],
        },
        "Email " +
          email +
          " with the subject “Privacy request”. We reply within 30 days. Under the Digital Personal Data Protection Act you may also nominate someone to exercise these rights for you. If you are not satisfied with our reply, you can complain to the Data Protection Board of India or, in the EU and UK, to your local data protection authority.",
      ],
    },
    {
      id: "cookies",
      title: "Cookies",
      blocks: [
        "TrueCite uses one essential cookie to keep you signed in. We do not use advertising or tracking cookies, so there is no cookie banner.",
      ],
    },
    {
      id: "changes",
      title: "Changes to this policy",
      blocks: [
        "If we change this policy, we update the date at the top of this page. For significant changes, we email account owners before the change takes effect.",
      ],
    },
  ],
};

export const REFUNDS: LegalDocumentContent = {
  title: "Refund and Cancellation Policy",
  description: "How cancellations and refunds work for audits and subscriptions.",
  intro:
    "Plans run month to month so that trying TrueCite carries little risk. This policy explains when you can cancel and when you get money back.",
  sections: [
    {
      id: "mini-report",
      title: "Free mini-report",
      blocks: ["The mini-report is free. There is nothing to cancel or refund."],
    },
    {
      id: "audit",
      title: "Full audit",
      blocks: [
        "You can cancel a full audit for a full refund at any time before work starts. Work starts when we begin the first scan, which we confirm to you by email.",
        "Once the scan has started, the audit fee is not refundable, because the AI and review costs have already been incurred. If we cannot deliver the report, we refund the fee in full.",
        "If you subscribe to a monitoring plan within 30 days of receiving the audit, the audit fee is credited toward your first months.",
      ],
    },
    {
      id: "monthly",
      title: "Monthly plans",
      blocks: [
        "Monthly plans have no minimum term. You can cancel at any time from the billing page or by email, and the plan stays active until the end of the month you have paid for.",
        "We do not refund partial months.",
      ],
    },
    {
      id: "annual",
      title: "Annual plans",
      blocks: [
        "Annual plans are paid upfront: pay for 10 months, get 12. You can cancel an annual plan within 14 days of payment for a full refund.",
        "After 14 days, the plan runs to the end of the year you have paid for, and we do not refund the remaining months.",
      ],
    },
    {
      id: "our-side",
      title: "If we fall short",
      blocks: [
        "If scans you have paid for do not run because of a problem on our side and we cannot make them up within the same period, we credit the affected part of the fee to your next invoice, or refund it if you are leaving.",
        "TrueCite reports what AI assistants say and cannot guarantee that their answers will change. A refund is not available because an assistant has not yet changed its answer.",
      ],
    },
    {
      id: "how",
      title: "How refunds are paid",
      blocks: [
        "Refunds go back to the original payment method within 10 working days of approval. For Indian invoices, we issue a GST credit note. Bank or card charges from your side are not refundable.",
      ],
    },
    {
      id: "contact",
      title: "Requests and questions",
      blocks: [
        "Email " + email + " with your company name and invoice number. We reply within one working day.",
      ],
    },
  ],
};
