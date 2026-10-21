/**
 * Exact and fuzzy scoring, and the weighted combination of all three scorers.
 *
 * No Obsidian imports, so it can be tested without a vault. Every score here is
 * 0-1 so the three are comparable before weighting.
 */

export type ScorerKey = "vector" | "exact" | "fuzzy";

export interface ScorerToggles {
  vector: boolean;
  exact: boolean;
  fuzzy: boolean;
}

export interface ScorerWeights {
  vector: number;
  exact: number;
  fuzzy: number;
}

export interface ScorePart {
  key: ScorerKey;
  /** The raw 0-1 score, or null when this scorer did not apply. */
  score: number | null;
  /** The weight actually used, after renormalizing for disabled scorers. */
  weight: number;
  /** score x weight, i.e. what it contributed to the total. */
  contribution: number;
}

export interface ScoreBreakdown {
  total: number;
  parts: ScorePart[];
}

/**
 * How much of `query` appears verbatim in `text`.
 *
 * Returns 1 for a whole-phrase hit, otherwise the fraction of query words
 * found. Case-insensitive: nobody expects search to care about capitals.
 */
export function exactScore(query: string, text: string): number {
  const needle = (query ?? "").trim().toLowerCase();
  const haystack = (text ?? "").toLowerCase();
  if (!needle || !haystack) return 0;

  // The whole phrase, in order, is the strongest possible signal.
  if (haystack.includes(needle)) return 1;

  const words = needle.split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const hits = words.filter((word) => haystack.includes(word)).length;
  return hits / words.length;
}

/**
 * Typo-tolerant match, 0-1.
 *
 * Scores each query word by the best run of characters it shares, in order,
 * with any word in the text. "kontak" still matches "kontrak", which is the
 * point: catching near-misses the exact scorer drops to zero.
 */
export function fuzzyScore(query: string, text: string): number {
  const needle = (query ?? "").trim().toLowerCase();
  const haystack = (text ?? "").toLowerCase();
  if (!needle || !haystack) return 0;

  const words = needle.split(/\s+/).filter(Boolean);
  if (!words.length) return 0;

  const candidates = haystack.split(/\s+/).filter(Boolean);
  if (!candidates.length) return 0;

  let sum = 0;
  for (const word of words) {
    let best = 0;
    for (const candidate of candidates) {
      best = Math.max(best, subsequenceRatio(word, candidate));
      if (best === 1) break;
    }
    sum += best;
  }
  return sum / words.length;
}

/**
 * Fraction of `needle`'s characters appearing in order within `candidate`,
 * damped by how much longer the candidate is. A short needle inside a very long
 * word is a weak signal, so the length ratio keeps it from scoring high.
 */
function subsequenceRatio(needle: string, candidate: string): number {
  if (!needle || !candidate) return 0;
  if (candidate === needle) return 1;

  let matched = 0;
  let cursor = 0;
  for (const char of needle) {
    const found = candidate.indexOf(char, cursor);
    if (found === -1) continue;
    matched++;
    cursor = found + 1;
  }
  if (!matched) return 0;

  const coverage = matched / needle.length;
  const lengthPenalty = Math.min(needle.length, candidate.length) / Math.max(needle.length, candidate.length);
  return coverage * lengthPenalty;
}

const ALL_SCORERS: ScorerKey[] = ["vector", "exact", "fuzzy"];

/**
 * Share out the weights of disabled scorers among the enabled ones.
 *
 * Without this, turning off fuzzy would drop every score by fuzzy's weight and
 * make results look worse than they are. Always sums to 1 (or 0 when nothing
 * is enabled).
 */
export function normalizeWeights(
  weights: ScorerWeights,
  toggles: ScorerToggles,
): ScorerWeights {
  const enabled = ALL_SCORERS.filter((key) => toggles[key]);
  if (!enabled.length) return { vector: 0, exact: 0, fuzzy: 0 };

  const total = enabled.reduce((sum, key) => sum + Math.max(0, weights[key] ?? 0), 0);
  const result: ScorerWeights = { vector: 0, exact: 0, fuzzy: 0 };

  // All-zero weights would divide by zero, so fall back to an even split.
  if (total <= 0) {
    for (const key of enabled) result[key] = 1 / enabled.length;
    return result;
  }

  for (const key of enabled) result[key] = Math.max(0, weights[key] ?? 0) / total;
  return result;
}

/**
 * Keep the three sliders summing to 1.0.
 *
 * The moved slider keeps its new value and the others absorb the difference in
 * proportion to what they already were, so the total never drifts.
 */
export function rebalanceWeights(
  weights: ScorerWeights,
  moved: ScorerKey,
  value: number,
): ScorerWeights {
  const clamped = Math.min(1, Math.max(0, value));
  const others = ALL_SCORERS.filter((key) => key !== moved);
  const remaining = 1 - clamped;
  const otherTotal = others.reduce((sum, key) => sum + Math.max(0, weights[key] ?? 0), 0);

  const result: ScorerWeights = { ...weights, [moved]: clamped } as ScorerWeights;
  if (otherTotal <= 0) {
    // Nothing to scale, so split what is left evenly.
    for (const key of others) result[key] = remaining / others.length;
    return result;
  }
  for (const key of others) {
    result[key] = (Math.max(0, weights[key] ?? 0) / otherTotal) * remaining;
  }
  return result;
}

/**
 * Weighted total of whichever scorers are enabled and actually produced a score.
 *
 * A null score means that scorer did not apply (for example, no exact query was
 * typed); its weight is redistributed rather than counted as a zero.
 */
export function combineScores(
  scores: Partial<Record<ScorerKey, number | null>>,
  weights: ScorerWeights,
  toggles: ScorerToggles,
): ScoreBreakdown {
  const applicable: ScorerToggles = {
    vector: toggles.vector && scores.vector != null,
    exact: toggles.exact && scores.exact != null,
    fuzzy: toggles.fuzzy && scores.fuzzy != null,
  };
  const effective = normalizeWeights(weights, applicable);

  const parts: ScorePart[] = ALL_SCORERS.map((key) => {
    const score = applicable[key] ? (scores[key] as number) : null;
    const weight = applicable[key] ? effective[key] : 0;
    return {
      key,
      score,
      weight,
      contribution: score == null ? 0 : score * weight,
    };
  });

  const total = parts.reduce((sum, part) => sum + part.contribution, 0);
  return { total, parts };
}
