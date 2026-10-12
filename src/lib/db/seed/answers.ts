import { claimKeyFor } from "@/lib/domain/consistency";
import type { Importance, PlatformId, QuestionCategory, Verdict } from "@/lib/domain/constants";
import { answers, citations, statements } from "../schema";
import { ACME_PAGES, type FactDef, type Sentiment } from "./acme-facts";
import { INTERMITTENT, type IssueDef } from "./acme-issues";
import type { QuestionDef } from "./acme-questions";
import { ANSWER_MODELS, answerCost } from "./settings";
import { rngFor, type Rng } from "./util";

/*
  The answer composer. For every question × platform × run it writes a short,
  plain-prose answer in that assistant's voice from the relevant facts, injects the
  wrong claims of the issues where they were seen, and records each claim as a
  statement whose span is found in the final text with indexOf.
*/

export type FactRef = FactDef & { id: string };
export type QuestionRef = QuestionDef & { id: string };
export type IssueRef = IssueDef & { id: string };

export type ScoredRow = {
  platform: PlatformId;
  category: QuestionCategory;
  verdict: Verdict;
  importance: Importance | null;
  sentiment: Sentiment | null;
};

export type ComposedScan = {
  answers: (typeof answers.$inferInsert)[];
  citations: (typeof citations.$inferInsert)[];
  statements: (typeof statements.$inferInsert)[];
  scored: ScoredRow[];
  /** Answer cost by provider, for usage rows. */
  costByPlatform: Record<PlatformId, { cost: number; tokensIn: number; tokensOut: number; searchCalls: number }>;
  answerCostUsd: number;
  /** First answer text that carries each issue's claim on its main question. */
  excerpts: Map<number, { text: string; platform: PlatformId }>;
};

type Claim = {
  text: string;
  factId: string | null;
  verdict: Verdict;
  confidence: number;
  issueId: string | null;
  intermittent: boolean;
  sentiment: Sentiment | null;
  importance: Importance | null;
};

type Piece = { sentence: string; claim?: Claim; forced?: boolean; kind: "opener" | "claim" | "context" | "closer" };

const SENTIMENT_CATEGORIES: QuestionCategory[] = ["comparisons", "trust", "reputation", "careers"];

const CHATGPT_CLOSERS: Record<QuestionCategory, string> = {
  pricing: "If you tell me your team size, I can help you work out which plan fits.",
  products: "Let me know which countries you run payroll in and I can go into more detail.",
  company: "Let me know if you want more background on the company.",
  trust: "If you are running a vendor review, it is worth asking Acme for its security documents.",
  comparisons: "If you share what matters most to you, I can compare specific features.",
  policies: "The policy page on Acme's site has the exact terms if you need them.",
  reputation: "Let me know if you want me to look into anything specific.",
  careers: "If you are considering a role there, recent employee reviews are worth a read.",
};

const GEMINI_ACTIONS: Record<QuestionCategory, string> = {
  pricing: "check the current prices on Acme's pricing page before you buy",
  products: "ask Acme for a demo to see the features with your own data",
  company: "check Acme's About page for the latest company details",
  trust: "ask Acme for its security documents during your vendor review",
  comparisons: "shortlist two options and run a trial with your own payroll data",
  policies: "read the policy page on Acme's website before you sign up",
  reputation: "check recent news and Acme's own statements for the latest information",
  careers: "read recent employee reviews and the careers page for current openings",
};

const CLAUDE_CLOSERS = [
  "I'd suggest checking Acme's website for the latest details, since this may have changed.",
  "It's worth confirming this directly with Acme, as details like this can change.",
];

const PERPLEXITY_LEADS = ["According to Acme's website, ", "According to its official site, ", "Per Acme's own pages, "];

const NAME_START = /^(Acme|Meera|Rahul|Arjun)\b/;

function correctClaim(fact: FactRef, rng: Rng, category: QuestionCategory): Claim {
  return {
    text: rng.pick(fact.claims),
    factId: fact.id,
    verdict: "correct",
    confidence: Math.round(rng.range(0.9, 0.99) * 100) / 100,
    issueId: null,
    intermittent: false,
    sentiment: SENTIMENT_CATEGORIES.includes(category) ? fact.sentiment : null,
    importance: fact.importance,
  };
}

/** Compose one answer. Exported so the reports can reuse the exact same text. */
export function composeAnswer(
  q: QuestionRef,
  platform: PlatformId,
  run: number,
  facts: Map<string, FactRef>,
  issues: IssueRef[],
): { text: string; claims: Claim[]; wrongIssues: IssueRef[] } {
  const rng = rngFor("answer", q.key, platform, run);
  const pieces: Piece[] = [];

  // Wrong claims of issues seen in this run.
  const wrong = issues.filter((issue) =>
    issue.appearances.some((a) => a.q === q.key && a.p === platform && a.runs.includes(run)),
  );
  const replaced = new Set(wrong.flatMap((issue) => issue.replaces));
  const yesNo = /^(Is|Does|Do|Can|Has|Are|Was|Should)\b/.test(q.text);
  for (const issue of wrong) {
    const forms = (issue.forms[platform] ?? issue.forms.default).filter((f) => yesNo || !f.startsWith("Yes, "));
    const form = forms.length ? rng.pick(forms) : "{c}.";
    const pending = issue.reviewState === "pending";
    const fact = issue.factKey ? facts.get(issue.factKey) : undefined;
    pieces.push({
      kind: "claim",
      forced: true,
      sentence: form.replace("{c}", issue.claim),
      claim: {
        text: issue.claim,
        factId: fact?.id ?? null,
        verdict: issue.verdict,
        confidence: Math.round((pending ? rng.range(0.62, 0.8) : rng.range(0.9, 0.98)) * 100) / 100,
        issueId: issue.id,
        intermittent: false,
        sentiment: SENTIMENT_CATEGORIES.includes(q.category) || issue.sentiment === "negative" ? issue.sentiment : null,
        importance: fact?.importance ?? null,
      },
    });
  }

  // Correct claims from the question's facts: the first one always, others sometimes.
  const available = q.facts.filter((key) => !replaced.has(key) && (facts.get(key)?.claims.length ?? 0) > 0);
  const keepOdds = platform === "perplexity" ? 0.35 : platform === "claude" ? 0.4 : 0.45;
  available.forEach((key, index) => {
    if (index > 0 && !rng.chance(keepOdds)) return;
    const fact = facts.get(key)!;
    const claim = correctClaim(fact, rng, q.category);
    let sentence = `${claim.text}.`;
    if (platform === "perplexity" && NAME_START.test(claim.text) && rng.chance(0.5)) {
      sentence = `${rng.pick(PERPLEXITY_LEADS)}${claim.text}.`;
    }
    pieces.push({ kind: "claim", forced: index === 0 && wrong.length === 0, sentence, claim });
  });

  // Claims the Fact Sheet does not cover.
  for (const extra of q.extras ?? []) {
    if (extra.platforms && !extra.platforms.includes(platform)) continue;
    const always = Boolean(extra.platforms);
    if (!always && !rng.chance(0.45)) continue;
    pieces.push({
      kind: "claim",
      forced: always,
      sentence: `${extra.text}.`,
      claim: {
        text: extra.text,
        factId: null,
        verdict: "unsupported",
        confidence: Math.round(rng.range(0.7, 0.9) * 100) / 100,
        issueId: null,
        intermittent: false,
        sentiment: extra.sentiment ?? (SENTIMENT_CATEGORIES.includes(q.category) ? "neutral" : null),
        importance: null,
      },
    });
  }

  // One-off claims, logged as intermittent.
  for (const one of INTERMITTENT) {
    if (one.q !== q.key || one.p !== platform || one.run !== run) continue;
    pieces.push({
      kind: "claim",
      forced: true,
      sentence: one.form.replace("{c}", one.claim),
      claim: {
        text: one.claim,
        factId: null,
        verdict: "unsupported",
        confidence: Math.round(rng.range(0.6, 0.75) * 100) / 100,
        issueId: null,
        intermittent: true,
        sentiment: null,
        importance: null,
      },
    });
  }

  // Runs differ a little: sometimes the order of the claims changes.
  if (pieces.length > 1 && rng.chance(0.4)) {
    const last = pieces.length - 1;
    const i = rng.int(0, last - 1);
    [pieces[i], pieces[i + 1]] = [pieces[i + 1], pieces[i]];
  }

  // Context sentences that make no claim about Acme, such as notes on competitors.
  if (q.context?.length) {
    const sentence = rng.pick(q.context);
    if (q.category === "comparisons" && rng.chance(0.6)) pieces.unshift({ kind: "context", sentence });
    else pieces.push({ kind: "context", sentence, forced: q.category === "comparisons" });
  }

  // Voice: openers and closers.
  if (platform === "gemini") {
    pieces.unshift({
      kind: "opener",
      sentence: rng.pick([`Here is a short overview of ${q.topic}.`, `Here is what you need to know about ${q.topic}.`]),
    });
    const action = GEMINI_ACTIONS[q.category];
    pieces.push({ kind: "closer", sentence: rng.pick([`A sensible next step is to ${action}.`, `Suggestion: ${action}.`]) });
  } else if (platform === "chatgpt") {
    const first = pieces.find((p) => p.kind === "claim");
    if (first && pieces[0] === first && rng.chance(0.25)) first.sentence = `Short answer: ${first.sentence}`;
    if (rng.chance(0.5)) pieces.push({ kind: "closer", sentence: CHATGPT_CLOSERS[q.category] });
  } else if (platform === "claude") {
    const first = pieces[0];
    if (first?.kind === "claim" && first.claim && NAME_START.test(first.sentence) && rng.chance(0.4)) {
      first.sentence = `As of my last update, ${first.sentence}`;
    }
    if (rng.chance(0.6)) pieces.push({ kind: "closer", sentence: rng.pick(CLAUDE_CLOSERS) });
  }

  // Keep answers to two to four sentences.
  const dropOrder: Piece["kind"][] = ["closer", "opener", "context", "claim"];
  for (const kind of dropOrder) {
    while (pieces.length > 4) {
      const index = pieces.map((p) => p.kind === kind && !p.forced).lastIndexOf(true);
      if (index < 0) break;
      pieces.splice(index, 1);
    }
  }
  if (pieces.length < 2) {
    pieces.push({
      kind: "closer",
      sentence: platform === "perplexity" ? "Details are on Acme's website." : CHATGPT_CLOSERS[q.category],
    });
  }

  const text = pieces.map((p) => p.sentence).join(" ");
  const claims = pieces.flatMap((p) => (p.claim ? [p.claim] : []));
  return { text, claims, wrongIssues: wrong };
}

function citationUrls(
  q: QuestionRef,
  platform: PlatformId,
  claims: Claim[],
  wrongIssues: IssueRef[],
  factsById: Map<string, FactRef>,
  rng: Rng,
): { url: string; title: string }[] {
  const memory = wrongIssues.some((issue) => issue.origin === "memory" && issue.platforms.includes(platform));
  let count: number;
  if (platform === "perplexity") count = rng.int(2, 4);
  else if (platform === "claude") count = memory ? 0 : rng.int(0, 2);
  else count = rng.chance(0.08) ? 0 : rng.int(1, 3);
  if (memory && platform !== "claude") count = Math.max(count, 1);
  if (count === 0) return [];

  const list: { url: string; title: string }[] = [];
  const add = (url: string, title: string) => {
    if (!list.some((c) => c.url === url)) list.push({ url, title });
  };
  for (const issue of wrongIssues) {
    for (const source of issue.sources) {
      if (source.citedBy.includes(platform)) add(source.url, source.title);
    }
  }
  const forcedCount = list.length;
  for (const claim of claims) {
    if (claim.verdict !== "correct" || !claim.factId) continue;
    const url = factsById.get(claim.factId)?.sourceUrl;
    if (url) add(url, ACME_PAGES[url] ?? "Acme");
  }
  for (const page of q.pages ?? []) add(page.url, page.title);
  add("https://acme.example/about", ACME_PAGES["https://acme.example/about"]);
  return list.slice(0, Math.max(count, Math.min(forcedCount, 4)));
}

const RESPONSE_PREFIX: Record<PlatformId, string> = { chatgpt: "resp", gemini: "gen", perplexity: "pplx", claude: "msg" };

export function composeScan(input: {
  scanId: string;
  brandId: string;
  startedAt: Date;
  finishedAt: Date;
  platforms: PlatformId[];
  runs: number;
  questions: QuestionRef[];
  facts: FactRef[];
  issues: IssueRef[];
  newId: () => string;
}): ComposedScan {
  const facts = new Map(input.facts.map((f) => [f.key, f]));
  const factsById = new Map(input.facts.map((f) => [f.id, f]));
  const out: ComposedScan = {
    answers: [],
    citations: [],
    statements: [],
    scored: [],
    costByPlatform: {
      chatgpt: { cost: 0, tokensIn: 0, tokensOut: 0, searchCalls: 0 },
      gemini: { cost: 0, tokensIn: 0, tokensOut: 0, searchCalls: 0 },
      perplexity: { cost: 0, tokensIn: 0, tokensOut: 0, searchCalls: 0 },
      claude: { cost: 0, tokensIn: 0, tokensOut: 0, searchCalls: 0 },
    },
    answerCostUsd: 0,
    excerpts: new Map(),
  };
  const window = input.finishedAt.getTime() - input.startedAt.getTime() - 5 * 60_000;
  const checkedAt = new Date(input.finishedAt.getTime() - 3 * 60_000);

  for (const q of input.questions) {
    if (!q.active) continue;
    for (const platform of input.platforms) {
      for (let run = 1; run <= input.runs; run++) {
        const { text, claims, wrongIssues } = composeAnswer(q, platform, run, facts, input.issues);
        const rng = rngFor("metrics", q.key, platform, run);
        const answerId = input.newId();
        const model = ANSWER_MODELS[platform];
        const cites = citationUrls(q, platform, claims, wrongIssues, factsById, rng);

        const tokensIn =
          platform === "chatgpt" ? rng.int(700, 1500) : platform === "gemini" ? rng.int(500, 1300) : platform === "perplexity" ? rng.int(300, 900) : rng.int(900, 1800);
        const tokensOut = Math.min(450, Math.max(120, Math.round(text.length / 4) + rng.int(20, 110)));
        const searchCalls =
          platform === "perplexity" ? 1 : platform === "gemini" ? (rng.chance(0.2) ? 2 : 1) : platform === "claude" ? (cites.length === 0 ? 0 : rng.int(1, 2)) : rng.chance(0.1) ? 0 : rng.int(1, 2);
        const usage = { tokensIn, tokensOut, searchCalls };
        const costUsd = answerCost(platform, usage);
        const totals = out.costByPlatform[platform];
        totals.cost += costUsd;
        totals.tokensIn += tokensIn;
        totals.tokensOut += tokensOut;
        totals.searchCalls += searchCalls;
        out.answerCostUsd += costUsd;
        const createdAt = new Date(input.startedAt.getTime() + Math.floor(rng.float() * window));

        out.answers.push({
          id: answerId,
          scanId: input.scanId,
          questionId: q.id,
          brandId: input.brandId,
          platform,
          model: model.model,
          runNumber: run,
          text,
          rawResponse: {
            id: `${RESPONSE_PREFIX[platform]}_${answerId.replace(/-/g, "").slice(0, 20)}`,
            model: model.model,
            finishReason: "stop",
            usage: { inputTokens: tokensIn, outputTokens: tokensOut },
            citations: cites.map((c) => c.url),
          },
          settings: model.effort ? { webSearch: true, effort: model.effort } : { webSearch: true },
          tokensIn,
          tokensOut,
          searchCalls,
          costUsd,
          latencyMs:
            platform === "chatgpt" ? rng.int(3000, 9000) : platform === "gemini" ? rng.int(2000, 6500) : platform === "perplexity" ? rng.int(2000, 5000) : rng.int(5000, 14000),
          simulated: false,
          createdAt,
        });

        cites.forEach((c, index) => {
          out.citations.push({ id: input.newId(), answerId, url: c.url, title: c.title, position: index + 1 });
        });

        let cursor = 0;
        for (const claim of claims) {
          let start = text.indexOf(claim.text, cursor);
          if (start < 0) start = text.indexOf(claim.text);
          if (start < 0) throw new Error(`Claim not found in answer: ${claim.text}`);
          cursor = start + claim.text.length;
          out.statements.push({
            id: input.newId(),
            answerId,
            brandId: input.brandId,
            text: claim.text,
            claimKey: claimKeyFor(claim.factId, claim.text),
            factId: claim.factId,
            verdict: claim.verdict,
            confidence: claim.confidence,
            spanStart: start,
            spanEnd: start + claim.text.length,
            issueId: claim.issueId,
            intermittent: claim.intermittent,
            sentiment: claim.sentiment,
            createdAt: checkedAt,
          });
          out.scored.push({
            platform,
            category: q.category,
            verdict: claim.verdict,
            importance: claim.importance,
            sentiment: claim.sentiment,
          });
        }

        for (const issue of wrongIssues) {
          if (issue.questionKey === q.key && !out.excerpts.has(issue.number)) out.excerpts.set(issue.number, { text, platform });
        }
      }
    }
  }
  return out;
}
