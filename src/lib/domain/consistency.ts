import type { PlatformId } from "./constants";

export type ClaimObservation = {
  /** A normalized key for the claim, so the same wrong statement groups across runs. */
  claimKey: string;
  platform: PlatformId;
  runNumber: number;
};

export type ClaimConsistency = {
  claimKey: string;
  /** Consistent claims become issues; intermittent ones are logged and watched. */
  consistent: boolean;
  platforms: PlatformId[];
  runsByPlatform: Partial<Record<PlatformId, number>>;
  runsSeen: number;
};

/**
 * The consistency rule: a statement becomes an issue only if it appears in at least
 * two runs on one platform, or on more than one platform. One-off statements are
 * intermittent.
 */
export function applyConsistencyRule(observations: readonly ClaimObservation[]): ClaimConsistency[] {
  const byClaim = new Map<string, Map<PlatformId, Set<number>>>();
  for (const observation of observations) {
    const platforms = byClaim.get(observation.claimKey) ?? new Map<PlatformId, Set<number>>();
    const runs = platforms.get(observation.platform) ?? new Set<number>();
    runs.add(observation.runNumber);
    platforms.set(observation.platform, runs);
    byClaim.set(observation.claimKey, platforms);
  }

  const results: ClaimConsistency[] = [];
  for (const [claimKey, platforms] of byClaim) {
    const runsByPlatform: Partial<Record<PlatformId, number>> = {};
    let runsSeen = 0;
    let repeatedOnOnePlatform = false;
    for (const [platform, runs] of platforms) {
      runsByPlatform[platform] = runs.size;
      runsSeen += runs.size;
      if (runs.size >= 2) repeatedOnOnePlatform = true;
    }
    results.push({
      claimKey,
      consistent: repeatedOnOnePlatform || platforms.size > 1,
      platforms: [...platforms.keys()],
      runsByPlatform,
      runsSeen,
    });
  }
  return results;
}

/** Normalize a claim into a grouping key: lowercase, no punctuation, collapsed spaces. */
export function claimKeyFor(factId: string | null, text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}$₹%.\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return factId ? `${factId}:${normalized}` : normalized;
}
