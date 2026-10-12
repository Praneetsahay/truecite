import type { PlatformId } from "@/lib/domain/constants";
import { METHOD_NOTES, type ReportData } from "@/lib/domain/report";

/*
  The public sample report: an anonymized monthly report for a mid-size payroll
  software company. Names, people and web addresses are replaced with
  placeholders in square brackets; the numbers are typical of a first quarter
  of monitoring.
*/

/** Locates the wrong statement inside an answer excerpt, so offsets never drift when the text is edited. */
function excerpt(platform: PlatformId, text: string, wrong: string) {
  const wrongStart = text.indexOf(wrong);
  if (wrongStart < 0) throw new Error(`Sample report: "${wrong}" is not in the answer excerpt.`);
  return { platform, text, wrongStart, wrongEnd: wrongStart + wrong.length };
}

const breachAnswer = excerpt(
  "chatgpt",
  "Yes. In March 2024, [Company] disclosed a data breach that exposed the payroll records of about 40,000 employees. The company says it has since added multi-factor login and an external security review.",
  "In March 2024, [Company] disclosed a data breach that exposed the payroll records of about 40,000 employees.",
);

const priceAnswer = excerpt(
  "gemini",
  "[Company] offers three plans. The Basic plan costs $49 per month for up to 25 employees, and the Growth and Enterprise plans are priced on request.",
  "The Basic plan costs $49 per month",
);

const ceoAnswer = excerpt(
  "claude",
  "[Company] was founded in 2012 and is led by its co-founder and CEO, [former CEO], who is often quoted on payroll compliance in India.",
  "is led by its co-founder and CEO, [former CEO]",
);

const securityAnswer = excerpt(
  "perplexity",
  "[Company] does not appear to hold a SOC 2 report. Its security page mentions encryption at rest and regular internal audits, but no third-party certification.",
  "[Company] does not appear to hold a SOC 2 report.",
);

export const SAMPLE_REPORT: ReportData = {
  type: "monthly",
  brandName: "A mid-size payroll software company",
  website: "Website withheld",
  periodLabel: "September 2026",
  generatedAt: "2026-10-01T04:30:00.000Z",
  summary:
    "Accuracy rose from 64 to 72 in September, mainly because Gemini and Perplexity now give the current prices. One critical risk is still open: ChatGPT and Claude confuse the company with another payroll firm that had a data breach in 2024. Three issues were resolved this month.",
  score: {
    current: 72,
    previous: 64,
    trend: [
      { date: "2026-08-29", score: 64 },
      { date: "2026-09-05", score: 66 },
      { date: "2026-09-12", score: 69 },
      { date: "2026-09-19", score: 71 },
      { date: "2026-09-26", score: 72 },
    ],
  },
  openRisks: { critical: 1, high: 3 },
  byPlatform: [
    { platform: "chatgpt", score: 66, openIssues: 4 },
    { platform: "gemini", score: 74, openIssues: 2 },
    { platform: "perplexity", score: 81, openIssues: 1 },
    { platform: "claude", score: 69, openIssues: 3 },
  ],
  topRisks: [
    {
      title: "Confused with another company's data breach",
      severity: "critical",
      status: "in_progress",
      platforms: ["chatgpt", "claude"],
      question: "Has [Company] had a data breach?",
      answer: breachAnswer,
      wrong: "[Company] disclosed a data breach in March 2024.",
      correct:
        "[Company] has never reported a data breach. The March 2024 breach was at a different payroll firm with a similar name.",
      likelySources: [
        "securitynews.example/2024/payroll-breach (about the other firm)",
        "forum.example/payroll/breach-thread (names both companies)",
      ],
      fix: [
        "Ask the news site to name the affected firm in full.",
        "Publish a short security statement on your own site.",
        "Reply on the forum thread with a link to the statement.",
      ],
    },
    {
      title: "Wrong price for Basic plan",
      severity: "high",
      status: "fixed_rechecking",
      platforms: ["chatgpt", "gemini"],
      question: "How much does [Company] cost?",
      answer: priceAnswer,
      wrong: "The Basic plan costs $49 per month.",
      correct: "$79 per month, since 1 March 2026.",
      likelySources: [
        "softwarereviews.example/payroll-tools-2023",
        "[company website]/pricing-2023 (still live until 22 Sep)",
      ],
      fix: [
        "Redirect the old pricing page to the current one.",
        "Ask the review site to update its 2023 comparison.",
      ],
    },
    {
      title: "Names the former CEO",
      severity: "high",
      status: "open",
      platforms: ["claude", "chatgpt"],
      question: "Who is the CEO of [Company]?",
      answer: ceoAnswer,
      wrong: "[Former CEO] is the CEO.",
      correct: "[Current CEO] has been CEO since January 2025. The co-founder stepped down in December 2024.",
      likelySources: [],
      fix: [
        "Update the Wikipedia and Wikidata entries, with a source.",
        "Add a leadership page with dates of appointment.",
        "Expect slower change: this answer comes from AI memory, not cited pages.",
      ],
    },
    {
      title: "Says the company has no SOC 2 report",
      severity: "high",
      status: "open",
      platforms: ["perplexity"],
      question: "Is [Company] SOC 2 certified?",
      answer: securityAnswer,
      wrong: "[Company] does not hold a SOC 2 report.",
      correct: "[Company] completed a SOC 2 Type II audit in June 2026. The report is available on request.",
      likelySources: [
        "[company website]/security (not updated since 2025)",
        "payroll-compare.example/security-checklist",
      ],
      fix: [
        "Add the SOC 2 Type II audit and its date to the security page.",
        "Send the comparison site the updated security details.",
      ],
    },
  ],
  fixed: [
    { title: "Lists a retired expense add-on as available", resolvedOn: "2026-09-26", platforms: ["gemini", "claude"] },
    { title: "Says payroll is not available in the UAE", resolvedOn: "2026-09-19", platforms: ["perplexity", "gemini"] },
    { title: "Gives old support hours (weekdays only)", resolvedOn: "2026-09-12", platforms: ["chatgpt"] },
  ],
  nextSteps: [
    "Publish the security statement this week, then re-check the breach answers on the next scan.",
    "Keep the old pricing page redirected. The price issue resolves after two clean scans in a row.",
    "Update the leadership entries on Wikipedia and Wikidata. Answers from AI memory can take several months to change.",
    "Add the SOC 2 audit to the security page and send it to the two comparison sites that cite the old page.",
  ],
  competitors: [
    {
      name: "This company",
      isClient: true,
      score: 72,
      estimate: false,
      shareOfVoice: 0.31,
      sentiment: { positive: 0.58, neutral: 0.34, negative: 0.08 },
    },
    {
      name: "Competitor A",
      score: 76,
      estimate: true,
      shareOfVoice: 0.29,
      sentiment: { positive: 0.61, neutral: 0.33, negative: 0.06 },
    },
    {
      name: "Competitor B",
      score: 69,
      estimate: true,
      shareOfVoice: 0.24,
      sentiment: { positive: 0.49, neutral: 0.4, negative: 0.11 },
    },
    {
      name: "Competitor C",
      score: 63,
      estimate: true,
      shareOfVoice: 0.16,
      sentiment: { positive: 0.42, neutral: 0.41, negative: 0.17 },
    },
  ],
  method: {
    from: "2026-09-01",
    to: "2026-09-30",
    platforms: ["chatgpt", "gemini", "perplexity", "claude"],
    questions: 100,
    runsPerQuestion: 3,
    scans: 4,
    notes: [
      ...METHOD_NOTES,
      "This sample is anonymized. The company name, people and web addresses are replaced with placeholders in square brackets.",
    ],
  },
};
