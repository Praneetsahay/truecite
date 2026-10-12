import { IMPORTANCE, type Importance, type Verdict } from "./constants";

export type ScoredStatement = {
  verdict: Verdict;
  /** Importance of the related fact. Statements without a fact count as low. */
  importance: Importance | null;
};

/**
 * Accuracy Score = 100 × (weight of correct statements) ÷ (weight of all checked statements).
 * Weights: critical 10, high 5, medium 2, low 1. Unsupported statements are left out
 * until someone reviews them. Returns null when nothing has been checked yet.
 */
export function accuracyScore(statements: readonly ScoredStatement[]): number | null {
  let correct = 0;
  let total = 0;
  for (const statement of statements) {
    if (statement.verdict === "unsupported") continue;
    const weight = IMPORTANCE[statement.importance ?? "low"].weight;
    total += weight;
    if (statement.verdict === "correct") correct += weight;
  }
  if (total === 0) return null;
  return Math.round((1000 * correct) / total) / 10;
}

/** Scores are stored with one decimal and shown as whole numbers. */
export function displayScore(score: number | null | undefined): string {
  if (score === null || score === undefined || Number.isNaN(score)) return "–";
  return String(Math.round(score));
}

export function scoreDelta(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  return Math.round(current) - Math.round(previous);
}

/** Group statements and score each group, for per-platform and per-category views. */
export function scoreBy<K extends string>(
  statements: readonly (ScoredStatement & { key: K })[],
): Map<K, { score: number | null; checked: number }> {
  const groups = new Map<K, ScoredStatement[]>();
  for (const statement of statements) {
    const list = groups.get(statement.key) ?? [];
    list.push(statement);
    groups.set(statement.key, list);
  }
  const result = new Map<K, { score: number | null; checked: number }>();
  for (const [key, list] of groups) {
    result.set(key, {
      score: accuracyScore(list),
      checked: list.filter((s) => s.verdict !== "unsupported").length,
    });
  }
  return result;
}
