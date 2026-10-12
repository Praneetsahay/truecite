/*
  Small text helpers for the engine: deterministic hashing (the simulator and
  retry jitter never use Math.random), tokens for matching claims with facts,
  and exact spans inside an answer.
*/

/** FNV-1a, 32 bit. Stable across processes and platforms. */
export function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A number in [0, 1) derived from the parts, the same every time. */
export function roll(...parts: (string | number)[]): number {
  return hash32(parts.join("|")) / 0x1_0000_0000;
}

/** Picks one item deterministically. */
export function pick<T>(items: readonly T[], ...parts: (string | number)[]): T {
  return items[hash32(parts.join("|")) % items.length];
}

const STOPWORDS = new Set(
  (
    "a an the and or but if then than of to in on at by for with from as is are was were be been being it its it's this that these those " +
    "there their they them we our you your he she his her i me my do does did has have had not no yes can could would should will may might " +
    "about into over under per via also only just very more most less much many such so what which who whom whose when where why how " +
    "all any each some other one ones up out off new still current currently"
  ).split(" "),
);

/** Sentence starters and filler words that are capitalized but are not names. */
const NOT_NAMES = new Set(
  (
    "The A An It Its This That These Those There Their They We You He She In On At As For From With By According Based Yes No " +
    "However Also Some Many Most Overall Here If When While Since Because Note"
  ).split(" "),
);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}$₹€£%.'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lowercase content words without stopwords, for overlap scores. */
export function contentWords(text: string): string[] {
  return normalize(text)
    .replace(/'s\b/g, "")
    .split(" ")
    .map((word) => word.replace(/^[.']+|[.']+$/g, ""))
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .map(stem);
}

/** A light plural strip, so "costs" matches "cost" and "plans" matches "plan". */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss") && !/\d/.test(word)) return word.slice(0, -1);
  return word;
}

/** Numbers as written, normalized: "$1,200" becomes "$1200", "49" stays "49". */
export function numbersIn(text: string): string[] {
  const matches = text.match(/[$₹€£]?\s?\d[\d,]*(?:\.\d+)?\s?%?/g) ?? [];
  return matches.map((m) => m.replace(/[\s,]/g, "")).filter((m) => /\d/.test(m));
}

/** Bare numeric values, so "$49" and "49" compare equal. */
export function numericValues(text: string): string[] {
  return numbersIn(text).map((n) => n.replace(/[^\d.]/g, "").replace(/\.0+$/, ""));
}

/** Capitalized words that look like names (people, plans, places), without the brand's own name. */
export function namesIn(text: string, brandName = ""): string[] {
  const brandTokens = new Set(contentWords(brandName));
  const words = text.match(/\b[A-Z][a-z]+(?:[-'][A-Za-z]+)?\b/g) ?? [];
  const names: string[] = [];
  for (const word of words) {
    const base = word.replace(/'s$/, "");
    if (NOT_NAMES.has(base)) continue;
    const lower = base.toLowerCase();
    if (brandTokens.has(lower) || STOPWORDS.has(lower)) continue;
    names.push(lower);
  }
  return names;
}

/**
 * The tokens that make a claim specific: numbers first, otherwise names.
 * Used to group the same wrong statement across runs written in different words.
 */
export function keyTokens(text: string, brandName = ""): string[] {
  const numbers = numbersIn(text);
  const tokens = numbers.length > 0 ? numbers : namesIn(text, brandName);
  return [...new Set(tokens)].sort();
}

/** Share of the smaller set's words found in the other text, from 0 to 1. */
export function overlap(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const setA = new Set(a);
  let shared = 0;
  for (const word of setA) if (setB.has(word)) shared += 1;
  return shared / Math.min(setA.size, setB.size);
}

/** Jaccard similarity of two word lists. */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  let shared = 0;
  for (const word of setA) if (setB.has(word)) shared += 1;
  return shared / (setA.size + setB.size - shared);
}

/** Where a claim sits inside the answer: exact first, then ignoring case. */
export function findSpan(answer: string, claim: string): { start: number; end: number } | null {
  if (!claim) return null;
  let index = answer.indexOf(claim);
  if (index < 0) index = answer.toLowerCase().indexOf(claim.toLowerCase());
  if (index < 0) return null;
  return { start: index, end: index + claim.length };
}

const ABBREVIATIONS = new Set(["inc", "ltd", "co", "corp", "st", "dr", "mr", "ms", "mrs", "vs", "approx", "e.g", "i.e", "etc", "no"]);

/** Sentences with their offsets. Keeps abbreviations such as "Inc." and prices such as "$4.50" together. */
export function sentences(text: string): { text: string; start: number; end: number }[] {
  const result: { text: string; start: number; end: number }[] = [];
  let start = 0;
  const push = (end: number) => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const value = raw.trim().replace(/^[-*•]\s+/, "");
    if (value.length >= 3) {
      const from = start + lead + (raw.trim().length - value.length);
      result.push({ text: value, start: from, end: from + value.length });
    }
    start = end;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\n") {
      push(i);
      continue;
    }
    if (char !== "." && char !== "!" && char !== "?") continue;
    const nextChar = text[i + 1];
    if (nextChar !== undefined && !/\s/.test(nextChar)) continue; // "$4.50", "acme.example"
    if (char === ".") {
      const word = text.slice(start, i).split(/\s+/).pop()?.toLowerCase() ?? "";
      if (ABBREVIATIONS.has(word)) continue;
    }
    push(i + 1);
  }
  push(text.length);
  return result;
}

export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** "acme.example" from "https://www.acme.example/pricing" or from "acme.example". */
export function domainFromWebsite(website: string): string {
  const withScheme = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  return hostnameOf(withScheme) ?? website.toLowerCase();
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Runs tasks with at most `limit` at a time, keeping the order of results. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return results;
}

export function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}
