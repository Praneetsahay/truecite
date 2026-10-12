import type { IssueStatus, PlatformId, ReportType, Severity } from "./constants";

/**
 * The frozen content of a report. Monthly reports, full audits, prospect reports
 * and the public sample report all render from this one shape, on the web and in PDF.
 */
export type ReportData = {
  type: ReportType;
  brandName: string;
  website: string;
  /** "September 2026", or "Audit, 1–14 Jul 2026" */
  periodLabel: string;
  /** ISO timestamp of when the report was generated. */
  generatedAt: string;
  /** Two or three sentences for leadership, in plain words. */
  summary: string;
  score: {
    current: number | null;
    previous: number | null;
    /** Oldest first. `date` is YYYY-MM-DD. */
    trend: { date: string; score: number }[];
  };
  openRisks: { critical: number; high: number };
  byPlatform: { platform: PlatformId; score: number | null; openIssues: number }[];
  topRisks: ReportFinding[];
  fixed: { title: string; resolvedOn: string; platforms: PlatformId[] }[];
  nextSteps: string[];
  competitors: {
    name: string;
    /** The client itself appears in this list with `isClient: true`. */
    isClient?: boolean;
    score: number | null;
    /** Competitor scores come from unconfirmed Fact Sheets, so they are estimates. */
    estimate: boolean;
    shareOfVoice: number | null;
    sentiment: { positive: number; neutral: number; negative: number } | null;
  }[];
  method: {
    from: string;
    to: string;
    platforms: PlatformId[];
    questions: number;
    runsPerQuestion: number;
    scans: number;
    notes: string[];
  };
};

export type ReportFinding = {
  issueNumber?: number;
  title: string;
  severity: Severity;
  status: IssueStatus;
  platforms: PlatformId[];
  question: string;
  /** The AI answer excerpt, with the wrong statement located by character offsets. */
  answer: { text: string; wrongStart: number; wrongEnd: number; platform: PlatformId } | null;
  wrong: string;
  correct: string;
  likelySources: string[];
  fix: string[];
};

export const METHOD_NOTES = [
  "Answers were collected through each provider's official API with web search turned on where available. They closely approximate, but do not exactly match, what people see in the consumer apps, which add their own settings and personalization.",
  "Each question was asked several times per platform. A statement counts as an issue only if it appears in at least two runs on a platform, or on more than one platform.",
  "TrueCite reports what AI assistants say. It cannot guarantee when or whether an assistant will change its answer.",
];
