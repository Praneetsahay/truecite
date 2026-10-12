import { QUESTION_CATEGORIES, type FactCategory, type Importance, type IssueStatus, type PlatformId, type ProspectStatus, type QuestionCategory, type Severity } from "@/lib/domain/constants";
import { PLAYBOOK, type ErrorType } from "@/lib/domain/playbook";
import { METHOD_NOTES, type ReportData, type ReportFinding } from "@/lib/domain/report";
import { brands, checkRequests, facts, prospects, questions, reports, scans, usageCosts } from "../schema";
import type { People } from "./people";
import { scanUsageRows } from "./history";
import { addDays, addMinutes, insertRows, istDay, istTime, round, shiftDay, shortDate, tokenFor, type SeedContext } from "./util";

/*
  The sales pipeline: prospects with their internal brands, prospect scans and short
  reports, plus requests from the public free check form.
*/

type FindingSpec = {
  title: string;
  type: ErrorType;
  severity: Severity;
  platform: PlatformId;
  question: string;
  answer: string;
  wrong: string;
  correct: string;
  sources: string[];
};

type ProspectSpec = {
  key: string;
  company: string;
  website: string;
  industry: string;
  description: string;
  contactName: string;
  contactEmail: string;
  contactRole: string;
  status: ProspectStatus;
  source: "outbound" | "free_check";
  notes: string | null;
  createdDaysAgo: number;
  /** Days before the anchor the prospect scan finished; absent when not scanned yet. */
  scannedDaysAgo?: number;
  score?: number;
  platformScores?: Partial<Record<PlatformId, number>>;
  facts?: { category: FactCategory; importance: Importance; statement: string; path: string }[];
  findings?: FindingSpec[];
};

const PROSPECTS: ProspectSpec[] = [
  {
    key: "trey",
    company: "Trey Research",
    website: "https://treyresearch.example",
    industry: "Fintech",
    description: "Investment research and model portfolios for retail investors in India.",
    contactName: "Divya Nair",
    contactEmail: "divya.nair@treyresearch.example",
    contactRole: "Head of Communications",
    status: "report_ready",
    source: "outbound",
    notes: "Findings reviewed. Lead with the penalty finding, then the Pro price.",
    createdDaysAgo: 6,
    scannedDaysAgo: 2,
    score: 63.4,
    platformScores: { chatgpt: 66.1, perplexity: 60.8 },
    facts: [
      { category: "pricing", importance: "critical", statement: "Trey Research Pro costs ₹3,999 a year.", path: "/pricing" },
      { category: "leadership", importance: "high", statement: "Shalini Rao has been Chief Executive Officer since February 2026.", path: "/about" },
      { category: "products", importance: "high", statement: "The mutual fund advisory desk closed in January 2026.", path: "/products" },
      { category: "legal", importance: "critical", statement: "Trey Research has never been fined by a regulator.", path: "/about" },
      { category: "company", importance: "low", statement: "Trey Research is headquartered in Mumbai.", path: "/about" },
    ],
    findings: [
      {
        title: "Links Trey Research to another firm's penalty",
        type: "confused_company",
        severity: "critical",
        platform: "perplexity",
        question: "Are there lawsuits against Trey Research?",
        answer: "According to a 2023 news report, Trey Research was fined for misleading investment advice. The report concerned an advisory service for retail investors.",
        wrong: "Trey Research was fined for misleading investment advice",
        correct: "No penalty is on record. The 2023 fine concerned Trey Capital, a different firm.",
        sources: ["newsdaily.example/2023/trey-capital-penalty"],
      },
      {
        title: "Quotes an old price for Trey Research Pro",
        type: "wrong_price",
        severity: "critical",
        platform: "chatgpt",
        question: "How much does Trey Research cost?",
        answer: "Trey Research Pro costs ₹2,499 a year and includes stock research reports and model portfolios. If you tell me what you invest in, I can help you decide whether Pro is worth it.",
        wrong: "Trey Research Pro costs ₹2,499 a year",
        correct: "Trey Research Pro costs ₹3,999 a year.",
        sources: ["moneyreviews.example/trey-research-review-2024"],
      },
      {
        title: "Names the former CEO",
        type: "outdated_facts",
        severity: "high",
        platform: "chatgpt",
        question: "Who is the CEO of Trey Research?",
        answer: "Karthik Bose is the CEO of Trey Research and one of its founders. The company is based in Mumbai.",
        wrong: "Karthik Bose is the CEO of Trey Research",
        correct: "Shalini Rao has been CEO since February 2026.",
        sources: ["wiki.example/wiki/Trey_Research"],
      },
      {
        title: "Says the mutual fund desk is still open",
        type: "product_status",
        severity: "high",
        platform: "perplexity",
        question: "What does Trey Research do?",
        answer: "Trey Research offers stock research and model portfolios for retail investors. According to its website, the mutual fund advisory desk is available to Pro members.",
        wrong: "the mutual fund advisory desk is available to Pro members",
        correct: "The mutual fund advisory desk closed in January 2026.",
        sources: ["treyresearch.example/mutual-funds"],
      },
    ],
  },
  {
    key: "wwi",
    company: "Wide World Importers",
    website: "https://wideworldimporters.example",
    industry: "Logistics and freight",
    description: "Freight forwarding and customs clearance for importers in India.",
    contactName: "Farhan Qureshi",
    contactEmail: "farhan.qureshi@wideworldimporters.example",
    contactRole: "Corporate Communications Lead",
    status: "call_booked",
    source: "outbound",
    notes: "Call booked for next Tuesday. Interested in the full audit.",
    createdDaysAgo: 20,
    scannedDaysAgo: 16,
    score: 68.9,
    platformScores: { chatgpt: 71.4, perplexity: 66.2 },
    findings: [
      {
        title: "Says customs clearance is free",
        type: "wrong_price",
        severity: "critical",
        platform: "chatgpt",
        question: "How much does Wide World Importers charge for customs clearance?",
        answer: "Wide World Importers includes customs clearance free with every shipment. Storage and last-mile delivery are charged separately.",
        wrong: "Wide World Importers includes customs clearance free with every shipment",
        correct: "Customs clearance costs from ₹4,500 per shipment.",
        sources: ["freightguide.example/customs-clearance-costs"],
      },
      {
        title: "Wrong deadline for damage claims",
        type: "wrong_policy",
        severity: "high",
        platform: "chatgpt",
        question: "How do I file a damage claim with Wide World Importers?",
        answer: "Damage claims must be filed within 30 days of delivery. You can file them from the customer portal.",
        wrong: "Damage claims must be filed within 30 days of delivery",
        correct: "Damage claims must be filed within 7 days of delivery.",
        sources: ["wideworldimporters.example/terms-2023.pdf"],
      },
      {
        title: "Old head office address",
        type: "outdated_facts",
        severity: "low",
        platform: "perplexity",
        question: "Where is Wide World Importers headquartered?",
        answer: "According to a business directory, Wide World Importers is headquartered in Chennai.",
        wrong: "Wide World Importers is headquartered in Chennai",
        correct: "The head office moved to Navi Mumbai in 2025.",
        sources: ["bizdirectory.example/companies/wide-world-importers"],
      },
    ],
  },
  {
    key: "adatum",
    company: "Adatum",
    website: "https://adatum.example",
    industry: "Accounting software",
    description: "Cloud accounting and invoicing for small and mid-size businesses in India.",
    contactName: "Meghna Joshi",
    contactEmail: "meghna.joshi@adatum.example",
    contactRole: "Head of Marketing",
    status: "contacted",
    source: "outbound",
    notes: "First email sent. Follow up with the data location finding.",
    createdDaysAgo: 10,
    scannedDaysAgo: 7,
    score: 71.2,
    platformScores: { chatgpt: 69.5, perplexity: 72.8 },
    findings: [
      {
        title: "Says customer data is stored in the United States",
        type: "other",
        severity: "high",
        platform: "chatgpt",
        question: "Where does Adatum store customer data?",
        answer: "Adatum stores customer data in the United States on a major cloud provider. It offers two-factor login for all users.",
        wrong: "Adatum stores customer data in the United States",
        correct: "Customer data is stored in India.",
        sources: ["saasreviews.example/adatum"],
      },
      {
        title: "Says there is a free plan",
        type: "wrong_price",
        severity: "high",
        platform: "perplexity",
        question: "Does Adatum have a free plan?",
        answer: "Adatum has a free plan for freelancers with up to 20 invoices a month, according to a software directory.",
        wrong: "Adatum has a free plan for freelancers",
        correct: "Adatum has no free plan. A 30-day trial is available.",
        sources: ["freetools.example/free-accounting-software-india"],
      },
      {
        title: "Names a retired product",
        type: "product_status",
        severity: "medium",
        platform: "chatgpt",
        question: "Does Adatum offer payroll?",
        answer: "Adatum Payroll Lite is available as an add-on for small teams. It covers PF and ESI calculations.",
        wrong: "Adatum Payroll Lite is available as an add-on",
        correct: "Adatum Payroll Lite was retired in 2025.",
        sources: ["appmarket.example/apps/adatum-payroll-lite"],
      },
    ],
  },
  {
    key: "coho",
    company: "Coho Winery",
    website: "https://cohowinery.example",
    industry: "Wine and beverages",
    description: "Vineyard and wine brand based in Nashik.",
    contactName: "Rohan Kapoor",
    contactEmail: "rohan.kapoor@cohowinery.example",
    contactRole: "Brand Director",
    status: "new",
    source: "outbound",
    notes: null,
    createdDaysAgo: 1,
  },
  {
    key: "relecloud",
    company: "Relecloud",
    website: "https://relecloud.example",
    industry: "Cloud hosting",
    description: "Cloud hosting and managed databases for Indian businesses.",
    contactName: "Ananya Sen",
    contactEmail: "ananya.sen@relecloud.example",
    contactRole: "VP Communications",
    status: "lost",
    source: "outbound",
    notes: "Not a priority this year. Revisit after their next funding round.",
    createdDaysAgo: 52,
    scannedDaysAgo: 48,
    score: 74.6,
    platformScores: { chatgpt: 72.9, perplexity: 76.3 },
    findings: [
      {
        title: "Wrong uptime guarantee",
        type: "wrong_policy",
        severity: "high",
        platform: "chatgpt",
        question: "What uptime does Relecloud guarantee?",
        answer: "Relecloud guarantees 99.9% uptime on all plans, with service credits if it misses that target.",
        wrong: "Relecloud guarantees 99.9% uptime on all plans",
        correct: "Relecloud guarantees 99.99% uptime on Business plans.",
        sources: ["hostingcompare.example/relecloud"],
      },
      {
        title: "Says there is no data centre in India",
        type: "outdated_facts",
        severity: "high",
        platform: "perplexity",
        question: "Does Relecloud have servers in India?",
        answer: "Relecloud has no data centre in India, so Indian customers are usually served from Singapore.",
        wrong: "Relecloud has no data centre in India",
        correct: "Relecloud has run a Mumbai region since 2024.",
        sources: ["techbench.example/relecloud-review-2023"],
      },
      {
        title: "Names the former CEO",
        type: "outdated_facts",
        severity: "medium",
        platform: "chatgpt",
        question: "Who is the CEO of Relecloud?",
        answer: "Vivek Malhotra is the CEO of Relecloud. He founded the company in 2016.",
        wrong: "Vivek Malhotra is the CEO of Relecloud",
        correct: "Nisha Thomas became CEO in 2025.",
        sources: ["wiki.example/wiki/Relecloud"],
      },
    ],
  },
  {
    key: "alpine",
    company: "Alpine Ski House",
    website: "https://alpineskihouse.example",
    industry: "Travel and holidays",
    description: "Ski and snow holidays in Gulmarg and Auli.",
    contactName: "Tara Fernandes",
    contactEmail: "tara@alpineskihouse.example",
    contactRole: "Marketing Manager",
    status: "replied",
    source: "free_check",
    notes: "Came in through the free check form. Replied to the report and asked about pricing.",
    createdDaysAgo: 11,
    scannedDaysAgo: 9,
    score: 66.3,
    platformScores: { chatgpt: 68.7, perplexity: 63.9 },
    findings: [
      {
        title: "Says bookings are non-refundable",
        type: "wrong_policy",
        severity: "high",
        platform: "perplexity",
        question: "What is Alpine Ski House's cancellation policy?",
        answer: "Alpine Ski House bookings are non-refundable, according to a travel forum. Travel insurance is recommended.",
        wrong: "Alpine Ski House bookings are non-refundable",
        correct: "Full refunds are given up to 30 days before departure.",
        sources: ["communityforum.example/t/alpine-ski-house-refund"],
      },
      {
        title: "Quotes last season's package price",
        type: "wrong_price",
        severity: "high",
        platform: "chatgpt",
        question: "How much does an Alpine Ski House trip cost?",
        answer: "Alpine Ski House's week-long Gulmarg package costs ₹65,000 per person, including stays and ski passes.",
        wrong: "Alpine Ski House's week-long Gulmarg package costs ₹65,000 per person",
        correct: "The week-long Gulmarg package costs ₹82,000 per person for the 2026–27 season.",
        sources: ["travelreviews.example/alpine-ski-house-gulmarg"],
      },
      {
        title: "Wrong season dates",
        type: "outdated_facts",
        severity: "medium",
        platform: "chatgpt",
        question: "When does Alpine Ski House run trips?",
        answer: "Alpine Ski House runs trips only in January, when snow is most reliable.",
        wrong: "Alpine Ski House runs trips only in January",
        correct: "Trips run from December to March.",
        sources: ["alpineskihouse.example/2023-season"],
      },
    ],
  },
];

/** Generated questions from the templates that need only the brand name. */
function templateQuestions(brand: string): { text: string; category: QuestionCategory }[] {
  const list: { text: string; category: QuestionCategory }[] = [];
  for (const [category, def] of Object.entries(QUESTION_CATEGORIES) as [QuestionCategory, { templates: readonly string[] }][]) {
    for (const template of def.templates) {
      if (/\{(feature|product|competitor)\}/.test(template)) continue;
      list.push({ text: template.replace("{brand}", brand), category });
    }
  }
  return list;
}

function prospectReport(spec: ProspectSpec, scannedAt: Date, questionCount: number): ReportData {
  const findings = spec.findings ?? [];
  const critical = findings.filter((f) => f.severity === "critical").length;
  const high = findings.filter((f) => f.severity === "high").length;
  const platforms = Object.keys(spec.platformScores ?? {}) as PlatformId[];
  const day = istDay(scannedAt);
  const topRisks: ReportFinding[] = findings.map((f) => {
    const start = f.answer.indexOf(f.wrong);
    if (start < 0) throw new Error(`Prospect finding not in answer: ${f.wrong}`);
    return {
      title: f.title,
      severity: f.severity,
      status: "open" as IssueStatus,
      platforms: [f.platform],
      question: f.question,
      answer: { text: f.answer, wrongStart: start, wrongEnd: start + f.wrong.length, platform: f.platform },
      wrong: f.wrong,
      correct: f.correct,
      likelySources: f.sources,
      fix: [...PLAYBOOK[f.type].steps],
    };
  });
  return {
    type: "prospect",
    brandName: spec.company,
    website: spec.website,
    periodLabel: `Prospect scan, ${shortDate(day)}`,
    generatedAt: addMinutes(scannedAt, 26 * 60).toISOString(),
    summary: `We asked ChatGPT and Perplexity ${questionCount} common questions about ${spec.company}, twice each. ${findings.length} answers contained errors worth fixing, ${critical === 0 ? "none of them critical" : `${critical} of them critical`}. The most serious: ${findings[0].title.charAt(0).toLowerCase()}${findings[0].title.slice(1)}.`,
    score: { current: spec.score ?? null, previous: null, trend: spec.score ? [{ date: day, score: spec.score }] : [] },
    openRisks: { critical, high },
    byPlatform: platforms.map((p) => ({
      platform: p,
      score: spec.platformScores?.[p] ?? null,
      openIssues: findings.filter((f) => f.platform === p).length,
    })),
    topRisks,
    fixed: [],
    nextSteps: [
      "Correct the most serious error first, starting with the pages listed as likely sources.",
      "Approve a short Fact Sheet so every answer can be checked against your own facts.",
      "Run a full audit across all four AI assistants to find the errors this small scan did not cover.",
    ],
    competitors: [{ name: spec.company, isClient: true, score: spec.score ?? null, estimate: false, shareOfVoice: null, sentiment: null }],
    method: {
      from: day,
      to: day,
      platforms,
      questions: questionCount,
      runsPerQuestion: 2,
      scans: 1,
      notes: [...METHOD_NOTES],
    },
  };
}

export async function seedProspects(ctx: SeedContext, people: People): Promise<void> {
  const { db, anchor, anchorDay } = ctx;
  const orgId = people.orgs.prospects;
  const prospectIds = new Map<string, string>();

  for (const spec of PROSPECTS) {
    const created = istTime(shiftDay(anchorDay, -spec.createdDaysAgo), 11, 30);
    let brandId: string | null = null;
    let reportId: string | null = null;

    if (spec.scannedDaysAgo !== undefined && spec.findings) {
      brandId = ctx.newId();
      const scannedAt = istTime(shiftDay(anchorDay, -spec.scannedDaysAgo), 16, 40);
      await insertRows(db, brands, [
        {
          id: brandId,
          organizationId: orgId,
          name: spec.company,
          website: spec.website,
          description: spec.description,
          industry: spec.industry,
          markets: ["IN"],
          languages: ["en"],
          platforms: ["chatgpt", "perplexity"],
          scanFrequency: "manual",
          runsPerQuestion: 2,
          onboardingStep: "done",
          createdAt: addMinutes(created, 10),
        },
      ]);
      if (spec.facts) {
        await insertRows(
          db,
          facts,
          spec.facts.map((f) => ({
            id: ctx.newId(),
            brandId: brandId!,
            category: f.category,
            statement: f.statement,
            importance: f.importance,
            sourceUrl: `${spec.website}${f.path}`,
            status: "approved" as const,
            origin: "website" as const,
            approvedBy: people.users.sam.id,
            approvedAt: addMinutes(created, 40),
            createdAt: addMinutes(created, 15),
            updatedAt: addMinutes(created, 40),
          })),
        );
      }
      const qs = templateQuestions(spec.company);
      await insertRows(
        db,
        questions,
        qs.map((q) => ({
          id: ctx.newId(),
          brandId: brandId!,
          text: q.text,
          category: q.category,
          language: "en" as const,
          priority: "key" as const,
          active: true,
          origin: "generated" as const,
          createdAt: addMinutes(created, 20),
        })),
      );
      const scanId = ctx.newId();
      const jobs = qs.length * 2 * 2;
      const cost = round(1.2 + spec.findings.length * 0.45 + (spec.score ?? 70) / 100, 2);
      await insertRows(db, scans, [
        {
          id: scanId,
          brandId,
          type: "prospect",
          status: "completed",
          platforms: ["chatgpt", "perplexity"],
          runsPerQuestion: 2,
          questionCount: qs.length,
          jobsTotal: jobs,
          jobsDone: jobs,
          jobsFailed: 0,
          totalCostUsd: cost,
          simulated: false,
          triggeredBy: people.users.sam.id,
          startedAt: addMinutes(scannedAt, -9),
          finishedAt: scannedAt,
          createdAt: addMinutes(scannedAt, -10),
        },
      ]);
      await insertRows(
        db,
        usageCosts,
        scanUsageRows({
          organizationId: orgId,
          brandId,
          scanId,
          at: scannedAt,
          platforms: ["chatgpt", "perplexity"],
          requestsPerPlatform: qs.length * 2,
          totalCostUsd: cost,
          newId: ctx.newId,
        }),
      );

      reportId = ctx.newId();
      const data = prospectReport(spec, scannedAt, qs.length);
      const reportCreated = new Date(data.generatedAt);
      await insertRows(db, reports, [
        {
          id: reportId,
          brandId,
          type: "prospect",
          title: `${spec.company}: what AI gets wrong`,
          period: null,
          status: spec.status === "report_ready" ? "ready" : "sent",
          data,
          shareToken: tokenFor(`prospect-${spec.key}`),
          shareExpiresAt: spec.key === "trey" ? addDays(anchor, 30) : addDays(reportCreated, 30),
          createdAt: reportCreated,
        },
      ]);
    }

    const id = ctx.newId();
    prospectIds.set(spec.key, id);
    await insertRows(db, prospects, [
      {
        id,
        company: spec.company,
        website: spec.website,
        industry: spec.industry,
        contactName: spec.contactName,
        contactEmail: spec.contactEmail,
        contactRole: spec.contactRole,
        brandId,
        reportId,
        status: spec.status,
        source: spec.source,
        notes: spec.notes,
        createdAt: created,
        updatedAt: istTime(shiftDay(anchorDay, -Math.max(0, Math.min(spec.createdDaysAgo, (spec.scannedDaysAgo ?? 1) - 1))), 17, 5),
      },
    ]);
  }

  await insertRows(db, checkRequests, [
    {
      id: ctx.newId(),
      company: "Tailspin Toys",
      website: "https://tailspintoys.example",
      name: "Kavya Reddy",
      email: "kavya.reddy@tailspintoys.example",
      role: "Brand Manager",
      message: "ChatGPT keeps quoting our 2023 prices. Can you check what the other assistants say about us?",
      status: "new",
      createdAt: addMinutes(anchor, -21 * 60),
    },
    {
      id: ctx.newId(),
      company: "Fourth Coffee",
      website: "https://fourthcoffee.example",
      name: "Imran Sheikh",
      email: "imran@fourthcoffee.example",
      role: "Head of Marketing",
      message: "Customers tell us Gemini says we closed our Pune cafes, which is not true. We would like a check.",
      status: "new",
      createdAt: addMinutes(anchor, -9 * 60),
    },
    {
      id: ctx.newId(),
      company: "Alpine Ski House",
      website: "https://alpineskihouse.example",
      name: "Tara Fernandes",
      email: "tara@alpineskihouse.example",
      role: "Marketing Manager",
      message: "Perplexity tells people our trips are non-refundable. We would like to see what else is wrong.",
      status: "accepted",
      prospectId: prospectIds.get("alpine") ?? null,
      createdAt: istTime(shiftDay(anchorDay, -12), 19, 15),
    },
    {
      id: ctx.newId(),
      company: "Ravi's travel notes",
      website: "https://ravitravels.example",
      name: "Ravi Kumar",
      email: "ravi.kumar@mail.example",
      role: null,
      message: "Can you check what AI says about my travel blog?",
      status: "declined",
      createdAt: istTime(shiftDay(anchorDay, -6), 22, 40),
    },
  ]);
}
