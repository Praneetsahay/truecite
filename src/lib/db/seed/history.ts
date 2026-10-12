import {
  QUESTION_CATEGORY_IDS,
  type PlatformId,
  type QuestionCategory,
  type ReviewState,
  type Severity,
} from "@/lib/domain/constants";
import { accuracyScore, scoreBy } from "@/lib/domain/score";
import type { CategoryBreakdown, PlatformBreakdown, SentimentSplit } from "../schema";
import { competitorSnapshots, scoreSnapshots, usageCosts } from "../schema";
import type { ScoredRow } from "./answers";
import { ANSWER_MODELS, CHECKER_MODEL } from "./settings";
import { DAY, istDay, round, rngFor, type Rng } from "./util";

/*
  Score history, competitor estimates and API usage. The latest snapshot is computed
  from the latest scan's statements; earlier ones follow a believable upward trend.
*/

export type TimelineIssue = {
  platforms: PlatformId[];
  category: QuestionCategory | null;
  severity: Severity;
  reviewState: ReviewState;
  approvedAt: Date | null;
  dismissedAt: Date | null;
  /** Resolved and reopened events, used to tell whether the issue was open at a time. */
  transitions: { at: Date; kind: "resolved" | "reopened" }[];
};

/** Approved, not dismissed and not resolved at time t. */
export function isOpenAt(issue: TimelineIssue, t: Date): boolean {
  if (issue.reviewState !== "approved" || !issue.approvedAt || issue.approvedAt > t) return false;
  if (issue.dismissedAt && issue.dismissedAt <= t) return false;
  const last = issue.transitions.filter((e) => e.at <= t).sort((a, b) => a.at.getTime() - b.at.getTime()).pop();
  return last?.kind !== "resolved";
}

export type OpenCounts = {
  critical: number;
  high: number;
  total: number;
  byPlatform: Partial<Record<PlatformId, number>>;
  byCategory: Partial<Record<QuestionCategory, number>>;
};

export function openCountsAt(issues: TimelineIssue[], t: Date): OpenCounts {
  const counts: OpenCounts = { critical: 0, high: 0, total: 0, byPlatform: {}, byCategory: {} };
  for (const issue of issues) {
    if (!isOpenAt(issue, t)) continue;
    counts.total++;
    if (issue.severity === "critical") counts.critical++;
    if (issue.severity === "high") counts.high++;
    for (const p of issue.platforms) counts.byPlatform[p] = (counts.byPlatform[p] ?? 0) + 1;
    if (issue.category) counts.byCategory[issue.category] = (counts.byCategory[issue.category] ?? 0) + 1;
  }
  return counts;
}

export type SnapshotValues = {
  accuracyScore: number | null;
  statementsChecked: number;
  byPlatform: PlatformBreakdown;
  byCategory: CategoryBreakdown;
  sentiment: SentimentSplit;
};

function split(positive: number, neutral: number, negative: number): SentimentSplit {
  const total = positive + neutral + negative || 1;
  const p = round(positive / total, 2);
  const n = round(negative / total, 2);
  return { positive: p, neutral: round(1 - p - n, 2), negative: n };
}

/** The latest snapshot, computed with the same accuracyScore() the app uses. */
export function computeSnapshot(scored: ScoredRow[], platforms: PlatformId[], open: OpenCounts): SnapshotValues {
  const byPlatform: PlatformBreakdown = {};
  const platformScores = scoreBy(scored.map((s) => ({ ...s, key: s.platform })));
  for (const p of platforms) {
    const entry = platformScores.get(p);
    byPlatform[p] = { score: entry?.score ?? null, checked: entry?.checked ?? 0, openIssues: open.byPlatform[p] ?? 0 };
  }
  const byCategory: CategoryBreakdown = {};
  const categoryScores = scoreBy(scored.map((s) => ({ ...s, key: s.category })));
  for (const c of QUESTION_CATEGORY_IDS) {
    const entry = categoryScores.get(c);
    if (!entry) continue;
    byCategory[c] = { score: entry.score, checked: entry.checked, openIssues: open.byCategory[c] ?? 0 };
  }
  const withSentiment = scored.filter((s) => s.sentiment);
  return {
    accuracyScore: accuracyScore(scored),
    statementsChecked: scored.filter((s) => s.verdict !== "unsupported").length,
    byPlatform,
    byCategory,
    sentiment: split(
      withSentiment.filter((s) => s.sentiment === "positive").length,
      withSentiment.filter((s) => s.sentiment === "neutral").length,
      withSentiment.filter((s) => s.sentiment === "negative").length,
    ),
  };
}

const WOBBLE = [0.3, 1.1, -1.2, 0.8, 1.4, -1.5, 0.6, 1.0, -0.8, 0.4, 1.2, -0.6, 0.5, -0.4];

/**
 * Earlier snapshots: an upward trend from `start` towards the latest score, with a
 * small wobble so it is not monotonic. Index 0 is the oldest point.
 */
export function trendScores(count: number, start: number, latest: number, seed: string): number[] {
  const rng = rngFor("trend", seed);
  const end = latest - 1.2;
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const base = start + ((end - start) * i) / Math.max(1, count - 1);
    values.push(round(base + WOBBLE[i % WOBBLE.length] + rng.range(-0.3, 0.3)));
  }
  return values;
}

/** A historical snapshot shaped like the latest one, shifted to the given overall score. */
export function historicalValues(latest: SnapshotValues, overall: number, progress: number, rng: Rng): SnapshotValues {
  const shift = (score: number | null) => {
    if (score === null || latest.accuracyScore === null) return score;
    // Gaps between platforms were a little wider early on.
    const gap = (score - latest.accuracyScore) * (1.25 - 0.25 * progress);
    return round(Math.min(98, Math.max(20, overall + gap + rng.range(-1.6, 1.6))));
  };
  const byPlatform: PlatformBreakdown = {};
  for (const [p, v] of Object.entries(latest.byPlatform) as [PlatformId, { score: number | null; checked: number; openIssues: number }][]) {
    byPlatform[p] = { score: shift(v.score), checked: Math.round(v.checked * rng.range(0.93, 1.04)), openIssues: v.openIssues };
  }
  const byCategory: CategoryBreakdown = {};
  for (const [c, v] of Object.entries(latest.byCategory) as [QuestionCategory, { score: number | null; checked: number; openIssues: number }][]) {
    byCategory[c] = { score: shift(v.score), checked: Math.round(v.checked * rng.range(0.92, 1.05)), openIssues: v.openIssues };
  }
  const pos = latest.sentiment.positive - 0.06 * (1 - progress) + rng.range(-0.015, 0.015);
  const neg = latest.sentiment.negative + 0.04 * (1 - progress) + rng.range(-0.01, 0.01);
  return {
    accuracyScore: overall,
    statementsChecked: Math.round(latest.statementsChecked * rng.range(0.94, 1.03)),
    byPlatform,
    byCategory,
    sentiment: split(pos, 1 - pos - neg, neg),
  };
}

export function snapshotRow(input: {
  id: string;
  brandId: string;
  scanId: string;
  takenAt: Date;
  values: SnapshotValues;
  open: OpenCounts;
  shareOfVoice: number;
}): typeof scoreSnapshots.$inferInsert {
  const byPlatform: PlatformBreakdown = {};
  for (const [p, v] of Object.entries(input.values.byPlatform) as [PlatformId, { score: number | null; checked: number }][]) {
    byPlatform[p] = { score: v.score, checked: v.checked, openIssues: input.open.byPlatform[p] ?? 0 };
  }
  const byCategory: CategoryBreakdown = {};
  for (const [c, v] of Object.entries(input.values.byCategory) as [QuestionCategory, { score: number | null; checked: number }][]) {
    byCategory[c] = { score: v.score, checked: v.checked, openIssues: input.open.byCategory[c] ?? 0 };
  }
  return {
    id: input.id,
    brandId: input.brandId,
    scanId: input.scanId,
    takenAt: input.takenAt,
    accuracyScore: input.values.accuracyScore,
    statementsChecked: input.values.statementsChecked,
    openCritical: input.open.critical,
    openHigh: input.open.high,
    openTotal: input.open.total,
    byPlatform,
    byCategory,
    sentiment: input.values.sentiment,
    shareOfVoice: input.shareOfVoice,
  };
}

export type CompetitorProfile = {
  id: string;
  score: [number, number];
  sentiment: SentimentSplit;
  shareOfVoice: number;
};

export function competitorRows(input: {
  brandId: string;
  scans: { id: string; takenAt: Date }[];
  competitors: CompetitorProfile[];
  newId: () => string;
}): (typeof competitorSnapshots.$inferInsert)[] {
  const rows: (typeof competitorSnapshots.$inferInsert)[] = [];
  for (const c of input.competitors) {
    input.scans.forEach((scan, index) => {
      const rng = rngFor("competitor", c.id, index);
      const [lo, hi] = c.score;
      const mid = (lo + hi) / 2;
      const score = round(Math.min(hi, Math.max(lo, mid + (hi - lo) * 0.45 * Math.sin(index * 1.7 + lo) + rng.range(-0.4, 0.4))));
      rows.push({
        id: input.newId(),
        competitorId: c.id,
        brandId: input.brandId,
        scanId: scan.id,
        takenAt: scan.takenAt,
        accuracyScore: score,
        sentiment: split(
          c.sentiment.positive + rng.range(-0.02, 0.02),
          c.sentiment.neutral + rng.range(-0.02, 0.02),
          c.sentiment.negative + rng.range(-0.01, 0.01),
        ),
        shareOfVoice: round(c.shareOfVoice + rng.range(-0.012, 0.012), 3),
      });
    });
  }
  return rows;
}

/** Typical share of a scan's cost by provider, before normalising over the platforms used. */
const ANSWER_SHARE: Record<PlatformId, number> = { chatgpt: 0.2, gemini: 0.43, perplexity: 0.08, claude: 0.29 };
const AVG_TOKENS_IN: Record<PlatformId, number> = { chatgpt: 1100, gemini: 900, perplexity: 600, claude: 1350 };
const SEARCHES_PER_REQUEST: Record<PlatformId, number> = { chatgpt: 1.35, gemini: 1, perplexity: 1, claude: 1.2 };

type UsageRow = typeof usageCosts.$inferInsert;

/**
 * Usage rows for one scan: an answer row per provider, plus checking and source tracing.
 * When `exact` is given (the latest scan), the answer rows use the real totals.
 */
export function scanUsageRows(input: {
  organizationId: string;
  brandId: string;
  scanId: string;
  at: Date;
  platforms: PlatformId[];
  requestsPerPlatform: number;
  totalCostUsd: number;
  exact?: Partial<Record<PlatformId, { cost: number; tokensIn: number; tokensOut: number; searchCalls: number }>>;
  newId: () => string;
}): UsageRow[] {
  const rng = rngFor("usage", input.scanId);
  const rows: UsageRow[] = [];
  const day = istDay(input.at);
  const checkCost = round(input.totalCostUsd * 0.012, 4);
  const traceCost = round(input.totalCostUsd * 0.008, 4);
  const answerTotal = input.totalCostUsd - checkCost - traceCost;
  const shareTotal = input.platforms.reduce((sum, p) => sum + ANSWER_SHARE[p], 0);
  for (const p of input.platforms) {
    const model = ANSWER_MODELS[p];
    const exact = input.exact?.[p];
    const requests = input.requestsPerPlatform;
    rows.push({
      id: input.newId(),
      organizationId: input.organizationId,
      brandId: input.brandId,
      scanId: input.scanId,
      provider: model.provider,
      model: model.model,
      purpose: "answer",
      tokensIn: exact?.tokensIn ?? Math.round(requests * AVG_TOKENS_IN[p] * rng.range(0.92, 1.08)),
      tokensOut: exact?.tokensOut ?? Math.round(requests * 285 * rng.range(0.92, 1.08)),
      searchCalls: exact?.searchCalls ?? Math.round(requests * SEARCHES_PER_REQUEST[p]),
      costUsd: round(exact?.cost ?? (answerTotal * ANSWER_SHARE[p]) / shareTotal, 4),
      day,
      createdAt: input.at,
    });
  }
  const totalRequests = input.requestsPerPlatform * input.platforms.length;
  rows.push({
    id: input.newId(),
    organizationId: input.organizationId,
    brandId: input.brandId,
    scanId: input.scanId,
    provider: CHECKER_MODEL.provider,
    model: CHECKER_MODEL.model,
    purpose: "check",
    tokensIn: Math.round(totalRequests * 1100),
    tokensOut: Math.round(totalRequests * 180),
    searchCalls: 0,
    costUsd: checkCost,
    day,
    createdAt: input.at,
  });
  rows.push({
    id: input.newId(),
    organizationId: input.organizationId,
    brandId: input.brandId,
    scanId: input.scanId,
    provider: CHECKER_MODEL.provider,
    model: CHECKER_MODEL.model,
    purpose: "trace",
    tokensIn: Math.round(traceCost * 6_000_000),
    tokensOut: Math.round(traceCost * 400_000),
    searchCalls: 0,
    costUsd: traceCost,
    day,
    createdAt: input.at,
  });
  return rows;
}

/** Small daily source-tracing rows on days without a scan, so the cost view has a row per day. */
export function dailyTraceRows(input: {
  organizationId: string;
  brandId: string;
  from: Date;
  to: Date;
  skipDays: Set<string>;
  scale: number;
  newId: () => string;
}): UsageRow[] {
  const rows: UsageRow[] = [];
  for (let t = input.from.getTime(); t <= input.to.getTime(); t += DAY) {
    const at = new Date(t);
    const day = istDay(at);
    if (input.skipDays.has(day)) continue;
    const rng = rngFor("trace-day", input.organizationId, day);
    const cost = round(rng.range(0.01, 0.06) * input.scale, 4);
    rows.push({
      id: input.newId(),
      organizationId: input.organizationId,
      brandId: input.brandId,
      scanId: null,
      provider: CHECKER_MODEL.provider,
      model: CHECKER_MODEL.model,
      purpose: "trace",
      tokensIn: Math.round(cost * 6_000_000),
      tokensOut: Math.round(cost * 400_000),
      searchCalls: 0,
      costUsd: cost,
      day,
      createdAt: at,
    });
  }
  return rows;
}
