import { claimKeyFor } from "@/lib/domain/consistency";
import type {
  ErrorVerdict,
  FactCategory,
  Importance,
  IssueStatus,
  PlatformId,
  QuestionCategory,
  ReviewState,
  Severity,
  SourceType,
} from "@/lib/domain/constants";
import { domainOf } from "@/lib/domain/format";
import type { ErrorType } from "@/lib/domain/playbook";
import {
  answers,
  brands,
  citations,
  competitorSnapshots,
  competitors,
  facts,
  issueEvents,
  issues,
  questions,
  scanJobs,
  scans,
  scoreSnapshots,
  sources,
  statements,
  usageCosts,
} from "../schema";
import type { CategoryBreakdown, PlatformBreakdown } from "../schema";
import { competitorRows, dailyTraceRows, openCountsAt, scanUsageRows, trendScores, type TimelineIssue } from "./history";
import type { OrgKey, People, UserKey } from "./people";
import { ANSWER_MODELS, answerCost } from "./settings";
import { addDays, addMinutes, insertRows, istDay, istTime, round, rngFor, shiftDay, type SeedContext } from "./util";

/*
  The other clients, with lighter data than Acme: enough for the admin pages (clients,
  scans and failed jobs, the review queue from several clients, costs) and for each
  issue's proof view (an answer with the statement marked).
*/

type LightIssue = {
  number: number;
  title: string;
  type: ErrorType;
  verdict: ErrorVerdict;
  severity: Severity;
  status: IssueStatus;
  reviewState: ReviewState;
  claim: string;
  correct: string;
  factKey: string;
  questionKey: string;
  confidence: number;
  assignee?: UserKey;
  /** Scan index (0 = latest completed) where it was first seen. */
  firstScan: number;
  resolvedScan?: number;
  /** Runs in the latest scan, with the answer text for each platform. */
  seen: Partial<Record<PlatformId, { runs: number[]; text: string }>>;
  source?: { url: string; title: string; sourceType: SourceType; published?: string; note?: string };
  approvedNote?: string;
};

type LightClient = {
  org: OrgKey;
  owner: UserKey;
  name: string;
  website: string;
  description: string;
  industry: string;
  markets: ("IN" | "GB" | "AE")[];
  platforms: PlatformId[];
  runs: number;
  frequency: "weekly" | "biweekly";
  createdDaysAgo: number;
  competitors: { name: string; website: string; score: [number, number]; sov: number }[];
  facts: { key: string; category: FactCategory; importance: Importance; statement: string; path: string }[];
  questions: { key: string; text: string; category: QuestionCategory; key_?: boolean }[];
  /** Days before the anchor that each completed scan finished, latest first. */
  scanDays: number[];
  scoreFrom: number;
  scoreTo: number;
  platformOffsets: Partial<Record<PlatformId, number>>;
  costPerScan: [number, number];
  issues: LightIssue[];
  failedJobs?: { questionKeys: string[]; platform: PlatformId; error: string };
  nextScanInDays: number;
};

const WOODGROVE: LightClient = {
  org: "woodgrove",
  owner: "arjun",
  name: "Woodgrove Bank",
  website: "https://woodgrove.example",
  description: "Retail and business banking across India.",
  industry: "Banking",
  markets: ["IN"],
  platforms: ["chatgpt", "gemini", "perplexity"],
  runs: 2,
  frequency: "biweekly",
  createdDaysAgo: 149,
  competitors: [
    { name: "Lucerne Bank", website: "https://lucernebank.example", score: [68, 72], sov: 0.31 },
    { name: "Tailspin Bank", website: "https://tailspinbank.example", score: [63, 67], sov: 0.24 },
  ],
  facts: [
    { key: "savings_rate", category: "pricing", importance: "critical", statement: "The Everyday savings account pays 3.5% interest a year on balances up to ₹10 lakh.", path: "/savings" },
    { key: "min_balance", category: "pricing", importance: "high", statement: "The Everyday savings account needs an average monthly balance of ₹10,000.", path: "/savings" },
    { key: "card_fee", category: "pricing", importance: "critical", statement: "The Platinum credit card costs ₹2,500 a year plus GST, waived when yearly spending is above ₹3 lakh.", path: "/cards/platinum" },
    { key: "upi_free", category: "pricing", importance: "high", statement: "Woodgrove Bank charges no fee for UPI payments.", path: "/charges" },
    { key: "phone_banking", category: "support", importance: "high", statement: "Phone banking is available 24 hours a day, every day.", path: "/contact" },
    { key: "ceo", category: "leadership", importance: "high", statement: "Anand Pillai has been Managing Director and Chief Executive Officer since April 2024.", path: "/about/leadership" },
    { key: "hq", category: "company", importance: "low", statement: "Woodgrove Bank is headquartered in Kochi.", path: "/about" },
    { key: "branches", category: "company", importance: "medium", statement: "Woodgrove Bank has 412 branches across India.", path: "/about" },
    { key: "founded", category: "company", importance: "low", statement: "Woodgrove Bank was founded in 1998.", path: "/about" },
    { key: "deposit_insurance", category: "security", importance: "critical", statement: "Deposits are insured up to ₹5 lakh per depositor.", path: "/deposit-insurance" },
    { key: "no_breach", category: "security", importance: "critical", statement: "Woodgrove Bank has never reported a data breach.", path: "/security" },
  ],
  questions: [
    { key: "w_rate", text: "What interest rate does Woodgrove Bank pay on savings accounts?", category: "pricing", key_: true },
    { key: "w_min", text: "What is the minimum balance for a Woodgrove Bank savings account?", category: "pricing", key_: true },
    { key: "w_card", text: "What is the annual fee for the Woodgrove Platinum credit card?", category: "pricing", key_: true },
    { key: "w_upi", text: "Does Woodgrove Bank charge for UPI payments?", category: "pricing" },
    { key: "w_neft", text: "Does Woodgrove Bank charge for NEFT transfers?", category: "pricing" },
    { key: "w_fd", text: "What are Woodgrove Bank's fixed deposit rates?", category: "pricing" },
    { key: "w_accounts", text: "What accounts does Woodgrove Bank offer?", category: "products" },
    { key: "w_home", text: "Does Woodgrove Bank offer home loans?", category: "products" },
    { key: "w_app", text: "Does Woodgrove Bank have a mobile banking app?", category: "products" },
    { key: "w_business", text: "Does Woodgrove Bank offer business current accounts?", category: "products" },
    { key: "w_ceo", text: "Who is the CEO of Woodgrove Bank?", category: "company", key_: true },
    { key: "w_hq", text: "Where is Woodgrove Bank headquartered?", category: "company" },
    { key: "w_branches", text: "How many branches does Woodgrove Bank have?", category: "company" },
    { key: "w_founded", text: "When was Woodgrove Bank founded?", category: "company" },
    { key: "w_safe", text: "Is Woodgrove Bank safe?", category: "trust", key_: true },
    { key: "w_insured", text: "Are deposits at Woodgrove Bank insured?", category: "trust", key_: true },
    { key: "w_breach", text: "Has Woodgrove Bank had a data breach?", category: "trust" },
    { key: "w_vs_lucerne", text: "Woodgrove Bank vs Lucerne Bank, which is better for savings?", category: "comparisons" },
    { key: "w_best", text: "Best banks in India for savings accounts", category: "comparisons" },
    { key: "w_vs_tailspin", text: "Is Woodgrove Bank better than Tailspin Bank?", category: "comparisons" },
    { key: "w_phone", text: "Is Woodgrove Bank phone banking available 24 hours?", category: "policies", key_: true },
    { key: "w_close", text: "How do I close a Woodgrove Bank account?", category: "policies" },
    { key: "w_card_cancel", text: "How do I cancel a Woodgrove Bank credit card?", category: "policies" },
    { key: "w_complaints", text: "Are there complaints about Woodgrove Bank?", category: "reputation" },
    { key: "w_fined", text: "Has Woodgrove Bank been fined?", category: "reputation" },
  ],
  scanDays: [3, 17, 31, 45, 59],
  scoreFrom: 61.2,
  scoreTo: 64.6,
  platformOffsets: { chatgpt: 1.8, gemini: -2.9, perplexity: 1.1 },
  costPerScan: [9.2, 10.1],
  nextScanInDays: 11,
  failedJobs: {
    questionKeys: ["w_fd", "w_home", "w_vs_tailspin"],
    platform: "gemini",
    error: "Gemini API request timed out after 60 s (attempt 3 of 3)",
  },
  issues: [
    {
      number: 101,
      title: "Quotes an old savings interest rate (4%)",
      type: "wrong_price",
      verdict: "outdated",
      severity: "critical",
      status: "in_progress",
      reviewState: "approved",
      claim: "Woodgrove Bank pays 4% interest a year on savings accounts",
      correct: "The Everyday savings account pays 3.5% interest a year on balances up to ₹10 lakh.",
      factKey: "savings_rate",
      questionKey: "w_rate",
      confidence: 0.95,
      assignee: "arjun",
      firstScan: 3,
      approvedNote: "The rate changed from 4% to 3.5% in March 2026.",
      seen: {
        chatgpt: {
          runs: [1, 2],
          text: "Woodgrove Bank pays 4% interest a year on savings accounts. Rates change often, so it is worth checking the bank's rates page before you open an account.",
        },
        perplexity: {
          runs: [1],
          text: "According to a 2024 rate comparison, Woodgrove Bank pays 4% interest a year on savings accounts. The bank's own rates page has the current figures.",
        },
      },
      source: { url: "https://ratewatch.example/savings-rates-2024", title: "Savings account rates compared (2024)", sourceType: "review_site", published: "2024" },
    },
    {
      number: 102,
      title: "Says the credit card fee is never waived",
      type: "wrong_price",
      verdict: "incorrect",
      severity: "critical",
      status: "open",
      reviewState: "pending",
      claim: "the Platinum credit card fee of ₹2,500 is never waived",
      correct: "The Platinum card fee is waived when yearly spending is above ₹3 lakh.",
      factKey: "card_fee",
      questionKey: "w_card",
      confidence: 0.74,
      firstScan: 0,
      seen: {
        gemini: {
          runs: [1, 2],
          text: "Here is a short overview of the Woodgrove Platinum card. Card reviews say the Platinum credit card fee of ₹2,500 is never waived. A sensible next step is to compare it with cards that have no annual fee.",
        },
      },
      source: { url: "https://cardcompare.example/woodgrove-platinum", title: "Woodgrove Platinum card review", sourceType: "review_site", published: "2025" },
    },
    {
      number: 103,
      title: "Says phone banking closes at 8pm",
      type: "wrong_policy",
      verdict: "incorrect",
      severity: "high",
      status: "open",
      reviewState: "pending",
      claim: "Woodgrove Bank's phone banking is available from 8am to 8pm",
      correct: "Phone banking is available 24 hours a day, every day.",
      factKey: "phone_banking",
      questionKey: "w_phone",
      confidence: 0.68,
      firstScan: 0,
      seen: {
        perplexity: { runs: [2], text: "Woodgrove Bank's phone banking is available from 8am to 8pm, according to its contact page. Card blocking is available at any time." },
        chatgpt: { runs: [1], text: "Woodgrove Bank's phone banking is available from 8am to 8pm on most days. Let me know if you want help finding the right number for your query." },
      },
    },
    {
      number: 104,
      title: "Wrong number of branches",
      type: "outdated_facts",
      verdict: "outdated",
      severity: "medium",
      status: "resolved",
      reviewState: "approved",
      claim: "Woodgrove Bank has about 350 branches",
      correct: "Woodgrove Bank has 412 branches across India.",
      factKey: "branches",
      questionKey: "w_branches",
      confidence: 0.92,
      assignee: "arjun",
      firstScan: 4,
      resolvedScan: 1,
      approvedNote: "The About page lists 412 branches.",
      seen: {},
    },
  ],
};

const LITWARE: LightClient = {
  org: "litware",
  owner: "emma",
  name: "Litware Insurance",
  website: "https://litware.example",
  description: "Home, motor and travel insurance in the UK and the UAE.",
  industry: "Insurance",
  markets: ["GB", "AE"],
  platforms: ["chatgpt", "gemini", "perplexity", "claude"],
  runs: 3,
  frequency: "weekly",
  createdDaysAgo: 119,
  competitors: [
    { name: "Humongous Insurance", website: "https://humongous.example", score: [79, 83], sov: 0.34 },
    { name: "Lamna Insurance", website: "https://lamna.example", score: [73, 77], sov: 0.22 },
  ],
  facts: [
    { key: "home_price", category: "pricing", importance: "critical", statement: "Litware home insurance starts at £14 a month.", path: "/home-insurance" },
    { key: "courtesy_car", category: "products", importance: "high", statement: "Litware motor insurance includes a courtesy car as standard.", path: "/motor-insurance" },
    { key: "claims_24h", category: "support", importance: "high", statement: "Claims can be made online or by phone 24 hours a day.", path: "/claims" },
    { key: "claims_days", category: "policies", importance: "medium", statement: "Most home claims are paid within 10 working days.", path: "/claims" },
    { key: "travel_days", category: "products", importance: "medium", statement: "Travel insurance covers single trips of up to 90 days.", path: "/travel-insurance" },
    { key: "uae", category: "company", importance: "high", statement: "Litware has sold insurance in the UAE since 2023.", path: "/uae" },
    { key: "ceo", category: "leadership", importance: "high", statement: "Helen Ward has been Chief Executive Officer since 2022.", path: "/about/leadership" },
    { key: "hq", category: "company", importance: "low", statement: "Litware is headquartered in Leeds.", path: "/about" },
    { key: "founded", category: "company", importance: "low", statement: "Litware was founded in 2006.", path: "/about" },
    { key: "cooling_off", category: "policies", importance: "high", statement: "Policies cancelled within 14 days get a full refund.", path: "/cancellations" },
  ],
  questions: [
    { key: "l_home", text: "How much does Litware home insurance cost?", category: "pricing", key_: true },
    { key: "l_motor_price", text: "Is Litware motor insurance expensive?", category: "pricing" },
    { key: "l_multicar", text: "Does Litware offer multi-car discounts?", category: "pricing" },
    { key: "l_travel_price", text: "How much is Litware travel insurance?", category: "pricing" },
    { key: "l_cancel_fee", text: "Does Litware charge a fee to cancel a policy?", category: "pricing" },
    { key: "l_courtesy", text: "Does Litware motor insurance include a courtesy car?", category: "products", key_: true },
    { key: "l_travel", text: "What does Litware travel insurance cover?", category: "products" },
    { key: "l_uae", text: "Does Litware sell insurance in the UAE?", category: "products", key_: true },
    { key: "l_pet", text: "Does Litware offer pet insurance?", category: "products" },
    { key: "l_types", text: "What types of insurance does Litware sell?", category: "products" },
    { key: "l_flood", text: "Does Litware home insurance cover flood damage?", category: "products" },
    { key: "l_ceo", text: "Who is the CEO of Litware Insurance?", category: "company" },
    { key: "l_hq", text: "Where is Litware Insurance based?", category: "company" },
    { key: "l_founded", text: "When was Litware founded?", category: "company" },
    { key: "l_size", text: "Is Litware a big insurer?", category: "company" },
    { key: "l_legit", text: "Is Litware Insurance legit?", category: "trust", key_: true },
    { key: "l_regulated", text: "Is Litware regulated?", category: "trust" },
    { key: "l_data", text: "Is my data safe with Litware?", category: "trust" },
    { key: "l_reliable", text: "Is Litware Insurance reliable for claims?", category: "trust" },
    { key: "l_vs_humongous", text: "Litware vs Humongous Insurance, which is better?", category: "comparisons" },
    { key: "l_best_home", text: "Best home insurance in the UK", category: "comparisons" },
    { key: "l_best_uae", text: "Best car insurance in the UAE for expats", category: "comparisons" },
    { key: "l_vs_lamna", text: "Is Litware cheaper than Lamna Insurance?", category: "comparisons" },
    { key: "l_claim", text: "How do I make a claim with Litware?", category: "policies", key_: true },
    { key: "l_claim_time", text: "How long do Litware claims take?", category: "policies" },
    { key: "l_cancel", text: "What is Litware's cancellation policy?", category: "policies" },
    { key: "l_night", text: "Can I make a claim with Litware at night?", category: "policies" },
    { key: "l_reviews", text: "What do customers say about Litware claims?", category: "reputation" },
    { key: "l_fined", text: "Has Litware been fined?", category: "reputation" },
    { key: "l_complaints", text: "Are there complaints about Litware?", category: "reputation" },
  ],
  scanDays: [7, 14, 21, 28, 35],
  scoreFrom: 78.4,
  scoreTo: 82.6,
  platformOffsets: { chatgpt: 1.9, gemini: -3.1, perplexity: 2.4, claude: -1.2 },
  costPerScan: [42.5, 46],
  nextScanInDays: 6,
  issues: [
    {
      number: 101,
      title: "Says Litware does not sell in the UAE",
      type: "product_status",
      verdict: "incorrect",
      severity: "high",
      status: "in_progress",
      reviewState: "approved",
      claim: "Litware only sells insurance in the UK",
      correct: "Litware has sold insurance in the UAE since 2023.",
      factKey: "uae",
      questionKey: "l_uae",
      confidence: 0.93,
      assignee: "emma",
      firstScan: 3,
      approvedNote: "Litware has sold in the UAE since 2023. The directory listing predates that.",
      seen: {
        gemini: {
          runs: [1, 2, 3],
          text: "Here is a short overview of Litware's markets. Litware only sells insurance in the UK, so UAE residents would need a local insurer. A sensible next step is to compare insurers licensed in the UAE.",
        },
        claude: {
          runs: [2],
          text: "As far as I know, Litware only sells insurance in the UK. It's worth confirming this directly with Litware, as details like this can change.",
        },
      },
      source: { url: "https://insurancedirectory.example/uk/litware", title: "Litware | Insurance directory", sourceType: "directory", published: "2022", note: "Lists the UK only" },
    },
    {
      number: 102,
      title: "Old home insurance price (£11 a month)",
      type: "wrong_price",
      verdict: "outdated",
      severity: "critical",
      status: "open",
      reviewState: "pending",
      claim: "Litware home insurance starts at £11 a month",
      correct: "Litware home insurance starts at £14 a month.",
      factKey: "home_price",
      questionKey: "l_home",
      confidence: 0.77,
      firstScan: 0,
      seen: {
        chatgpt: {
          runs: [1, 3],
          text: "Litware home insurance starts at £11 a month for buildings and contents cover. If you share your postcode and property type, I can help you think through a quote.",
        },
      },
      source: { url: "https://comparehomes.example/litware-review-2023", title: "Litware home insurance review (2023)", sourceType: "review_site", published: "2023" },
    },
    {
      number: 103,
      title: "Says the courtesy car costs extra",
      type: "wrong_policy",
      verdict: "incorrect",
      severity: "high",
      status: "open",
      reviewState: "approved",
      claim: "a courtesy car costs extra with Litware motor insurance",
      correct: "Litware motor insurance includes a courtesy car as standard.",
      factKey: "courtesy_car",
      questionKey: "l_courtesy",
      confidence: 0.9,
      firstScan: 1,
      approvedNote: "The motor insurance page lists a courtesy car as standard.",
      seen: {
        perplexity: {
          runs: [1, 2],
          text: "According to a comparison site, a courtesy car costs extra with Litware motor insurance. Several UK insurers sell it as an add-on.",
        },
      },
      source: { url: "https://carcover.example/litware-motor", title: "Litware motor insurance compared", sourceType: "review_site", published: "2024" },
    },
  ],
};

export async function seedOtherClients(ctx: SeedContext, people: People): Promise<{ litwareRunningScanId: string }> {
  await seedLightClient(ctx, people, WOODGROVE);
  const litware = await seedLightClient(ctx, people, LITWARE);
  const runningId = await seedLitwareRunningScan(ctx, litware.brandId, litware.questionIds);
  await seedProseware(ctx, people);
  return { litwareRunningScanId: runningId };
}

async function seedLightClient(
  ctx: SeedContext,
  people: People,
  spec: LightClient,
): Promise<{ brandId: string; questionIds: string[] }> {
  const { db, anchor, anchorDay } = ctx;
  const orgId = people.orgs[spec.org];
  const brandId = ctx.newId();
  const created = addDays(anchor, -spec.createdDaysAgo);
  await insertRows(db, brands, [
    {
      id: brandId,
      organizationId: orgId,
      name: spec.name,
      website: spec.website,
      description: spec.description,
      industry: spec.industry,
      markets: spec.markets,
      languages: ["en"],
      platforms: spec.platforms,
      scanFrequency: spec.frequency,
      runsPerQuestion: spec.runs,
      onboardingStep: "done",
      nextScanAt: addDays(anchor, spec.nextScanInDays),
      createdAt: created,
    },
  ]);
  const compIds = spec.competitors.map(() => ctx.newId());
  await insertRows(
    db,
    competitors,
    spec.competitors.map((c, i) => ({ id: compIds[i], brandId, name: c.name, website: c.website, createdAt: created })),
  );

  const factIds = new Map(spec.facts.map((f) => [f.key, ctx.newId()]));
  const owner = people.users[spec.owner];
  await insertRows(
    db,
    facts,
    spec.facts.map((f) => ({
      id: factIds.get(f.key)!,
      brandId,
      category: f.category,
      statement: f.statement,
      importance: f.importance,
      sourceUrl: `${spec.website}${f.path}`,
      status: "approved" as const,
      origin: "website" as const,
      approvedBy: owner.id,
      approvedAt: addDays(created, 2),
      createdAt: addDays(created, 1),
      updatedAt: addDays(created, 2),
    })),
  );
  const questionIds = new Map(spec.questions.map((q) => [q.key, ctx.newId()]));
  await insertRows(
    db,
    questions,
    spec.questions.map((q) => ({
      id: questionIds.get(q.key)!,
      brandId,
      text: q.text,
      category: q.category,
      language: "en" as const,
      priority: q.key_ ? ("key" as const) : ("standard" as const),
      active: true,
      origin: "generated" as const,
      createdAt: addDays(created, 2),
    })),
  );

  // Completed scans, latest first.
  const qCount = spec.questions.length;
  const jobsTotal = qCount * spec.platforms.length * spec.runs;
  const failed = spec.failedJobs ? spec.failedJobs.questionKeys.length * spec.runs : 0;
  const scanIds = spec.scanDays.map(() => ctx.newId());
  const finished = spec.scanDays.map((d) => istTime(shiftDay(anchorDay, -d), 6, 0));
  const costs = spec.scanDays.map((_, i) => round(rngFor("light-cost", spec.name, i).range(...spec.costPerScan), 2));
  await insertRows(
    db,
    scans,
    spec.scanDays.map((_, i) => {
      const startedAt = addMinutes(finished[i], -rngFor("light-scan", spec.name, i).int(18, 30));
      return {
        id: scanIds[i],
        brandId,
        type: "scheduled" as const,
        status: "completed" as const,
        platforms: spec.platforms,
        runsPerQuestion: spec.runs,
        questionCount: qCount,
        jobsTotal,
        jobsDone: i === 0 ? jobsTotal - failed : jobsTotal,
        jobsFailed: i === 0 ? failed : 0,
        totalCostUsd: costs[i],
        simulated: false,
        note: i === 0 && failed ? `${failed} requests to Gemini failed after 3 attempts. The rest of the scan completed.` : null,
        startedAt,
        finishedAt: finished[i],
        createdAt: addMinutes(startedAt, -1),
      };
    }),
  );

  if (spec.failedJobs) {
    const fj = spec.failedJobs;
    await insertRows(
      db,
      scanJobs,
      fj.questionKeys.flatMap((key, qi) =>
        Array.from({ length: spec.runs }, (_, r) => ({
          id: ctx.newId(),
          scanId: scanIds[0],
          questionId: questionIds.get(key)!,
          platform: fj.platform,
          runNumber: r + 1,
          status: "failed" as const,
          attempts: 3,
          lastError: fj.error,
          startedAt: addMinutes(finished[0], -12 + qi * 2 + r),
          finishedAt: addMinutes(finished[0], -9 + qi * 2 + r),
          createdAt: addMinutes(finished[0], -25),
        })),
      ),
    );
  }

  // Issues, with an answer and statement for each latest sighting.
  const issueIds = spec.issues.map(() => ctx.newId());
  const issueRows: (typeof issues.$inferInsert)[] = [];
  const eventRows: (typeof issueEvents.$inferInsert)[] = [];
  const sourceRows: (typeof sources.$inferInsert)[] = [];
  const answerRows: (typeof answers.$inferInsert)[] = [];
  const citationRows: (typeof citations.$inferInsert)[] = [];
  const statementRows: (typeof statements.$inferInsert)[] = [];
  const timelines: TimelineIssue[] = [];

  spec.issues.forEach((issue, index) => {
    const id = issueIds[index];
    const category = spec.questions.find((q) => q.key === issue.questionKey)!.category;
    const platforms = Object.keys(issue.seen) as PlatformId[];
    const firstSeen = finished[issue.firstScan];
    const approvedAt = issue.reviewState === "approved" ? istTime(shiftDay(istDay(firstSeen), 1), 10, 15) : null;
    const resolvedAt = issue.resolvedScan !== undefined ? finished[issue.resolvedScan] : null;
    const allPlatforms = platforms.length ? platforms : (["chatgpt", "gemini"] as PlatformId[]);
    const runsSeen = platforms.reduce((sum, p) => sum + issue.seen[p]!.runs.length, 0);
    const lastSeen = resolvedAt ? finished[(issue.resolvedScan ?? 0) + 2] ?? firstSeen : finished[0];

    const events: (typeof issueEvents.$inferInsert)[] = [];
    const ev = (at: Date, kind: (typeof issueEvents.$inferInsert)["kind"], note: string | null, actor: UserKey | null, extra: Partial<typeof issueEvents.$inferInsert> = {}) =>
      events.push({
        id: ctx.newId(),
        issueId: id,
        kind,
        note,
        actorId: actor ? people.users[actor].id : null,
        actorName: actor ? people.users[actor].name : "TrueCite",
        createdAt: at,
        ...extra,
      });
    ev(firstSeen, "detected", `Seen in ${runsSeen || 2} runs across ${allPlatforms.length === 1 ? "one platform" : `${allPlatforms.length} platforms`}.`, null);
    if (approvedAt) ev(approvedAt, "approved", issue.approvedNote ?? null, "sam");
    if (approvedAt && issue.assignee) {
      ev(addMinutes(approvedAt, 240), "assigned", `Assigned to ${people.users[issue.assignee].name}`, spec.owner);
      ev(addMinutes(approvedAt, 300), "status", null, issue.assignee, { fromStatus: "open", toStatus: "in_progress" });
    }
    for (let s = issue.firstScan - 1; s >= 0; s--) {
      if (resolvedAt && finished[s] >= resolvedAt) break;
      if (issue.resolvedScan !== undefined && s === issue.resolvedScan + 2) {
        ev(addMinutes(finished[s], 300), "status", null, issue.assignee ?? spec.owner, { fromStatus: "in_progress", toStatus: "fixed_rechecking" });
      }
      if (issue.resolvedScan !== undefined && s === issue.resolvedScan + 1) ev(finished[s], "clean", "Not seen in this scan.", null);
      else if (approvedAt) ev(finished[s], "seen", "Still seen in this scan.", null);
    }
    if (resolvedAt) {
      ev(resolvedAt, "resolved", "Correct and consistent for two scans in a row.", null, { fromStatus: "fixed_rechecking", toStatus: "resolved" });
    }
    eventRows.push(...events);

    timelines.push({
      platforms: allPlatforms,
      category,
      severity: issue.severity,
      reviewState: issue.reviewState,
      approvedAt,
      dismissedAt: null,
      transitions: resolvedAt ? [{ at: resolvedAt, kind: "resolved" }] : [],
    });

    issueRows.push({
      id,
      brandId,
      number: issue.number,
      title: issue.title,
      type: issue.type,
      verdict: issue.verdict,
      severity: issue.severity,
      status: issue.status,
      reviewState: issue.reviewState,
      wrongStatement: issue.claim,
      correctStatement: issue.correct,
      factId: factIds.get(issue.factKey)!,
      questionId: questionIds.get(issue.questionKey)!,
      category,
      platforms: allPlatforms,
      origin: "web",
      confidence: issue.confidence,
      runsSeen: runsSeen || 2,
      runsTotal: spec.platforms.length * spec.runs,
      firstSeenAt: firstSeen,
      lastSeenAt: lastSeen,
      resolvedAt,
      assigneeId: issue.assignee ? people.users[issue.assignee].id : null,
      cleanScanStreak: resolvedAt ? (issue.resolvedScan ?? 0) + 2 : 0,
      nextCheckAt: resolvedAt ? null : addDays(anchor, spec.nextScanInDays),
      fixProgress: issue.assignee ? [0] : [],
      createdAt: firstSeen,
      updatedAt: events[events.length - 1].createdAt!,
    });

    if (issue.source) {
      sourceRows.push({
        id: ctx.newId(),
        issueId: id,
        url: issue.source.url,
        title: issue.source.title,
        domain: domainOf(issue.source.url),
        sourceType: issue.source.sourceType,
        containsStatement: true,
        likelihood: "likely",
        publishedLabel: issue.source.published ?? null,
        note: issue.source.note ?? null,
        citedBy: platforms.filter((p) => p !== "claude"),
        checkedAt: addMinutes(finished[0], 240),
      });
    }

    for (const p of platforms) {
      const sighting = issue.seen[p]!;
      for (const run of sighting.runs) {
        const rng = rngFor("light-answer", spec.name, issue.number, p, run);
        const answerId = ctx.newId();
        const usage = { tokensIn: rng.int(400, 1500), tokensOut: rng.int(120, 260), searchCalls: p === "claude" ? 0 : 1 };
        answerRows.push({
          id: answerId,
          scanId: scanIds[0],
          questionId: questionIds.get(issue.questionKey)!,
          brandId,
          platform: p,
          model: ANSWER_MODELS[p].model,
          runNumber: run,
          text: sighting.text,
          settings: { webSearch: true },
          ...usage,
          costUsd: answerCost(p, usage),
          latencyMs: rng.int(2500, 9000),
          createdAt: addMinutes(finished[0], -rng.int(5, 15)),
        });
        if (issue.source && p !== "claude") {
          citationRows.push({ id: ctx.newId(), answerId, url: issue.source.url, title: issue.source.title, position: 1 });
        }
        const start = sighting.text.indexOf(issue.claim);
        if (start < 0) throw new Error(`Claim not found in ${spec.name} answer: ${issue.claim}`);
        const factId = factIds.get(issue.factKey)!;
        statementRows.push({
          id: ctx.newId(),
          answerId,
          brandId,
          text: issue.claim,
          claimKey: claimKeyFor(factId, issue.claim),
          factId,
          verdict: issue.verdict,
          confidence: issue.reviewState === "pending" ? round(rng.range(0.62, 0.8), 2) : round(rng.range(0.9, 0.97), 2),
          spanStart: start,
          spanEnd: start + issue.claim.length,
          issueId: id,
          sentiment: null,
          createdAt: addMinutes(finished[0], -2),
        });
      }
    }
  });
  await insertRows(db, issues, issueRows);
  await insertRows(db, issueEvents, eventRows);
  await insertRows(db, sources, sourceRows);
  await insertRows(db, answers, answerRows);
  await insertRows(db, citations, citationRows);
  await insertRows(db, statements, statementRows);

  // Snapshots, oldest first, ending at the latest completed scan.
  const n = spec.scanDays.length;
  const trend = trendScores(n, spec.scoreFrom, spec.scoreTo + 1.2, spec.name);
  trend[n - 1] = spec.scoreTo;
  const snapshotRows: (typeof scoreSnapshots.$inferInsert)[] = [];
  for (let k = 0; k < n; k++) {
    const i = n - 1 - k;
    const rng = rngFor("light-snapshot", spec.name, k);
    const overall = trend[k];
    const open = openCountsAt(timelines, finished[i]);
    const byPlatform: PlatformBreakdown = {};
    for (const p of spec.platforms) {
      byPlatform[p] = {
        score: round(overall + (spec.platformOffsets[p] ?? 0) + rng.range(-0.8, 0.8)),
        checked: Math.round(qCount * spec.runs * rng.range(1.5, 1.8)),
        openIssues: open.byPlatform[p] ?? 0,
      };
    }
    const byCategory: CategoryBreakdown = {};
    for (const c of [...new Set(spec.questions.map((q) => q.category))]) {
      const perCat = spec.questions.filter((q) => q.category === c).length;
      byCategory[c] = {
        score: round(Math.min(97, overall + rng.range(-7, 7))),
        checked: Math.round(perCat * spec.platforms.length * spec.runs * rng.range(1.4, 1.8)),
        openIssues: open.byCategory[c] ?? 0,
      };
    }
    snapshotRows.push({
      id: ctx.newId(),
      brandId,
      scanId: scanIds[i],
      takenAt: finished[i],
      accuracyScore: overall,
      statementsChecked: Math.round(jobsTotal * rng.range(1.5, 1.7)),
      openCritical: open.critical,
      openHigh: open.high,
      openTotal: open.total,
      byPlatform,
      byCategory,
      sentiment: { positive: round(0.44 + rng.range(-0.03, 0.03), 2), neutral: round(0.45 + rng.range(-0.02, 0.02), 2), negative: 0 },
      shareOfVoice: round(0.25 + k * 0.006 + rng.range(-0.008, 0.008), 3),
    });
  }
  for (const row of snapshotRows) {
    const s = row.sentiment!;
    s.negative = round(1 - s.positive - s.neutral, 2);
  }
  await insertRows(db, scoreSnapshots, snapshotRows);
  await insertRows(
    db,
    competitorSnapshots,
    competitorRows({
      brandId,
      scans: scanIds.map((id, i) => ({ id, takenAt: finished[i] })).reverse(),
      competitors: spec.competitors.map((c, i) => ({
        id: compIds[i],
        score: c.score,
        sentiment: { positive: 0.47, neutral: 0.42, negative: 0.11 },
        shareOfVoice: c.sov,
      })),
      newId: ctx.newId,
    }),
  );

  // API usage
  const usageRows: (typeof usageCosts.$inferInsert)[] = [];
  spec.scanDays.forEach((_, i) => {
    usageRows.push(
      ...scanUsageRows({
        organizationId: orgId,
        brandId,
        scanId: scanIds[i],
        at: finished[i],
        platforms: spec.platforms,
        requestsPerPlatform: qCount * spec.runs,
        totalCostUsd: costs[i],
        newId: ctx.newId,
      }),
    );
  });
  usageRows.push(
    ...dailyTraceRows({
      organizationId: orgId,
      brandId,
      from: addDays(anchor, -Math.min(89, spec.createdDaysAgo - 1)),
      to: anchor,
      skipDays: new Set(finished.map((f) => istDay(f))),
      scale: spec.frequency === "weekly" ? 1.4 : 0.5,
      newId: ctx.newId,
    }),
  );
  await insertRows(db, usageCosts, usageRows);

  return { brandId, questionIds: spec.questions.map((q) => questionIds.get(q.key)!) };
}

/** Litware's weekly scan is running now: 240 of 360 jobs done, the rest queued for the engine. */
async function seedLitwareRunningScan(ctx: SeedContext, brandId: string, questionIds: string[]): Promise<string> {
  const { db, anchor, now } = ctx;
  const id = ctx.newId();
  const startedAt = new Date(Math.min(addMinutes(anchor, 60).getTime(), now.getTime() - 25 * 60_000));
  const platforms: PlatformId[] = ["chatgpt", "gemini", "perplexity", "claude"];
  const qs = questionIds.slice(0, 30);
  const jobsTotal = qs.length * platforms.length * 3;
  await insertRows(db, scans, [
    {
      id,
      brandId,
      type: "scheduled",
      status: "running",
      platforms,
      runsPerQuestion: 3,
      questionCount: qs.length,
      jobsTotal,
      jobsDone: 240,
      jobsFailed: 0,
      totalCostUsd: 27.3,
      simulated: false,
      startedAt,
      createdAt: addMinutes(startedAt, -1),
    },
  ]);
  const jobs: (typeof scanJobs.$inferInsert)[] = [];
  let index = 0;
  for (const questionId of qs) {
    for (const platform of platforms) {
      for (let run = 1; run <= 3; run++) {
        const done = index < 240;
        const offset = Math.floor((index / 240) * 20 * 60_000);
        jobs.push({
          id: ctx.newId(),
          scanId: id,
          questionId,
          platform,
          runNumber: run,
          status: done ? "done" : "queued",
          attempts: done ? 1 : 0,
          startedAt: done ? new Date(startedAt.getTime() + offset) : null,
          finishedAt: done ? new Date(startedAt.getTime() + offset + 4_000) : null,
          createdAt: startedAt,
        });
        index++;
      }
    }
  }
  await insertRows(db, scanJobs, jobs);
  return id;
}

const PROSEWARE_FACTS: { category: FactCategory; importance: Importance; statement: string; path: string }[] = [
  { category: "products", importance: "high", statement: "Proseware is an online learning platform for corporate training.", path: "/" },
  { category: "pricing", importance: "critical", statement: "The Team plan costs ₹1,200 per learner per year plus GST.", path: "/pricing" },
  { category: "pricing", importance: "critical", statement: "The Business plan costs ₹2,000 per learner per year plus GST.", path: "/pricing" },
  { category: "pricing", importance: "high", statement: "Companies with more than 100 learners can run a 30-day free pilot.", path: "/pricing" },
  { category: "products", importance: "medium", statement: "Courses are available in English and Hindi.", path: "/courses" },
  { category: "products", importance: "low", statement: "Proseware connects to HR systems through SCORM and an open API.", path: "/integrations" },
  { category: "company", importance: "low", statement: "Proseware was founded in 2017.", path: "/about" },
  { category: "company", importance: "low", statement: "Proseware is headquartered in Pune.", path: "/about" },
  { category: "leadership", importance: "high", statement: "Ritu Desai is the Chief Executive Officer.", path: "/about" },
  { category: "security", importance: "high", statement: "Customer data is stored in data centres in India.", path: "/security" },
];

const PROSEWARE_QUESTIONS: [QuestionCategory, string][] = [
  ["pricing", "How much does Proseware cost?"],
  ["pricing", "Does Proseware have a free plan?"],
  ["pricing", "What plans does Proseware offer?"],
  ["pricing", "Is there a free trial for Proseware?"],
  ["pricing", "How much is the Proseware Business plan?"],
  ["pricing", "Does Proseware charge per learner?"],
  ["products", "What does Proseware do?"],
  ["products", "Does Proseware offer courses in Hindi?"],
  ["products", "Does Proseware integrate with HR systems?"],
  ["products", "Can I upload my own courses to Proseware?"],
  ["products", "Does Proseware have a mobile app?"],
  ["products", "Does Proseware offer compliance training?"],
  ["company", "Who is the CEO of Proseware?"],
  ["company", "Where is Proseware headquartered?"],
  ["company", "When was Proseware founded?"],
  ["company", "How many employees does Proseware have?"],
  ["company", "Who owns Proseware?"],
  ["trust", "Is Proseware legit?"],
  ["trust", "Is Proseware safe to use?"],
  ["trust", "Where does Proseware store customer data?"],
  ["trust", "Is Proseware SOC 2 certified?"],
  ["trust", "Is Proseware ISO 27001 certified?"],
  ["comparisons", "Proseware vs Wingtip Learning, which is better?"],
  ["comparisons", "Best alternatives to Proseware"],
  ["comparisons", "Is Proseware cheaper than Adventure Works Academy?"],
  ["comparisons", "Best corporate training platforms in India"],
  ["comparisons", "Best learning platforms for companies with 500 employees"],
  ["policies", "What is Proseware's refund policy?"],
  ["policies", "Does Proseware offer 24/7 support?"],
  ["policies", "How do I cancel Proseware?"],
  ["policies", "What are Proseware's support hours?"],
  ["policies", "Can I change my Proseware plan mid-year?"],
  ["reputation", "Has Proseware had a data breach?"],
  ["reputation", "Are there lawsuits against Proseware?"],
  ["reputation", "What do customers complain about with Proseware?"],
  ["reputation", "What do reviews say about Proseware?"],
  ["careers", "Is Proseware a good place to work?"],
  ["careers", "How are salaries at Proseware?"],
  ["careers", "Is Proseware hiring?"],
  ["careers", "Does Proseware offer remote jobs?"],
];

/** Proseware is mid-onboarding: facts approved, questions generated but not yet reviewed, no scans. */
async function seedProseware(ctx: SeedContext, people: People): Promise<void> {
  const { db, anchor } = ctx;
  const orgId = people.orgs.proseware;
  const brandId = ctx.newId();
  const created = addDays(anchor, -2);
  await insertRows(db, brands, [
    {
      id: brandId,
      organizationId: orgId,
      name: "Proseware",
      website: "https://proseware.example",
      description: "Online learning platform for corporate training in India.",
      industry: "Corporate training software",
      markets: ["IN"],
      languages: ["en"],
      platforms: ["chatgpt", "perplexity"],
      scanFrequency: "manual",
      runsPerQuestion: 2,
      onboardingStep: "questions",
      createdAt: created,
    },
  ]);
  await insertRows(db, competitors, [
    { id: ctx.newId(), brandId, name: "Wingtip Learning", website: "https://wingtiplearning.example", createdAt: created },
    { id: ctx.newId(), brandId, name: "Adventure Works Academy", website: "https://adventureworks.example", createdAt: created },
  ]);
  await insertRows(
    db,
    facts,
    PROSEWARE_FACTS.map((f) => ({
      id: ctx.newId(),
      brandId,
      category: f.category,
      statement: f.statement,
      importance: f.importance,
      sourceUrl: `https://proseware.example${f.path === "/" ? "" : f.path}`,
      status: "approved" as const,
      origin: "website" as const,
      approvedBy: people.users.vikram.id,
      approvedAt: addMinutes(created, 95),
      createdAt: addMinutes(created, 20),
      updatedAt: addMinutes(created, 95),
    })),
  );
  await insertRows(
    db,
    questions,
    PROSEWARE_QUESTIONS.map(([category, text], i) => ({
      id: ctx.newId(),
      brandId,
      text,
      category,
      language: "en" as const,
      priority: i % 4 === 0 ? ("key" as const) : ("standard" as const),
      // The trial plan allows 30 active questions; the rest wait switched off.
      active: i < 30,
      origin: "generated" as const,
      createdAt: addMinutes(created, 100),
    })),
  );
  await insertRows(db, usageCosts, [
    {
      id: ctx.newId(),
      organizationId: orgId,
      brandId,
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      purpose: "facts",
      tokensIn: 48200,
      tokensOut: 3900,
      searchCalls: 0,
      costUsd: 0.1354,
      day: istDay(addMinutes(created, 20)),
      createdAt: addMinutes(created, 20),
    },
    {
      id: ctx.newId(),
      organizationId: orgId,
      brandId,
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      purpose: "questions",
      tokensIn: 6100,
      tokensOut: 2400,
      searchCalls: 0,
      costUsd: 0.0362,
      day: istDay(addMinutes(created, 100)),
      createdAt: addMinutes(created, 100),
    },
  ]);
}
