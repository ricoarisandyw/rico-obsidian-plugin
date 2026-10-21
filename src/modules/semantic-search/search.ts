import {
  passesFilters,
  parseExactQuery,
  scoreParsedQuery,
  type FilterCandidate,
  type SearchFilters,
} from "./filters";
import {
  combineScores,
  exactScore,
  fuzzyScore,
  type ScoreBreakdown,
  type ScorerToggles,
  type ScorerWeights,
} from "./scoring";

/**
 * Pure scoring. No Obsidian imports here on purpose, so it can be unit tested
 * without a vault.
 *
 * Vectors are unit-normalized when they are stored, so cosine similarity is
 * just a dot product. That is the whole trick that keeps this file small.
 */

export interface IndexEntry {
  path: string;
  mtime: number;
  vec: number[];
  /** Bounded snippet kept for exact and fuzzy matching. */
  text?: string;
  /** "md" or "canvas", so results can be filtered and labelled by kind. */
  kind?: "md" | "canvas";
  /** Creation time, for date-range filtering. */
  ctime?: number;
}

export interface SearchResult {
  path: string;
  score: number;
  kind?: "md" | "canvas";
  /** Per-scorer detail, shown when a result is expanded. */
  breakdown?: ScoreBreakdown;
}

export interface SearchOptions {
  limit?: number;
  /** Comma-separated path fragments to drop from results. */
  excludeFilter?: string;
  /** Drop anything scoring below this. */
  minScore?: number;
  /** Literal text for the exact and fuzzy scorers. */
  exactQuery?: string;
  /** Drop results that do not contain the exact term at all. */
  exactRequired?: boolean;
  weights?: ScorerWeights;
  toggles?: ScorerToggles;
  /** Structured filters applied before scoring. */
  filters?: SearchFilters;
  /** Frontmatter lookup, supplied by the view from metadataCache. */
  frontmatterOf?: (path: string) => Record<string, unknown> | null;
}

/** Dot product. Assumes equal length; callers check that first. */
export function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * Scale a vector to length 1 so later comparisons are plain dot products.
 * A zero vector has no direction, so it is returned untouched rather than
 * producing NaN.
 */
export function normalize(vec: number[]): number[] {
  let sumSquares = 0;
  for (const v of vec) sumSquares += v * v;
  const length = Math.sqrt(sumSquares);
  if (!length || !Number.isFinite(length)) return vec.slice();
  return vec.map((v) => v / length);
}

/** Split the comma-separated exclude setting into usable fragments. */
export function parseExcludeFilter(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function isExcluded(path: string, fragments: string[]): boolean {
  return fragments.some((fragment) => path.includes(fragment));
}

/**
 * Rank every indexed note against the target vector.
 *
 * Brute force on purpose: a vault of 10k notes scores in well under 50ms, so
 * an approximate index would add complexity for no real gain.
 */
export function search(
  targetPath: string,
  targetVec: number[],
  entries: IndexEntry[],
  options: SearchOptions = {},
): SearchResult[] {
  const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : 20;
  const minScore = options.minScore ?? 0;
  const fragments = parseExcludeFilter(options.excludeFilter);
  if (!targetVec?.length) return [];

  const exactQuery = (options.exactQuery ?? "").trim();
  // Parsed once, not per entry: the syntax is the same for every candidate.
  const parsedExact = parseExactQuery(exactQuery);
  const filters = options.filters;
  const toggles: ScorerToggles = options.toggles ?? {
    vector: true,
    exact: false,
    fuzzy: false,
  };
  const weights: ScorerWeights = options.weights ?? { vector: 1, exact: 0, fuzzy: 0 };
  // Text scorers need something to look for; without a term they sit out and
  // their weight goes back to whoever is left.
  const hasText = exactQuery.length > 0;
  const hasVector = targetVec.length > 0;

  const results: SearchResult[] = [];
  for (const entry of entries) {
    // A note is not its own connection.
    if (entry.path === targetPath) continue;
    if (fragments.length && isExcluded(entry.path, fragments)) continue;

    if (filters) {
      const candidate: FilterCandidate = {
        path: entry.path,
        kind: entry.kind,
        ctime: entry.ctime,
        mtime: entry.mtime,
        frontmatter: options.frontmatterOf?.(entry.path) ?? null,
      };
      if (!passesFilters(candidate, filters)) continue;
    }

    // Different length means a different model embedded it. Skip rather than
    // compare nonsense.
    const comparable = hasVector && entry.vec?.length === targetVec.length;
    const haystack = `${entry.path}\n${entry.text ?? ""}`;

    // Use the parsed syntax when it carries structure, otherwise plain matching.
    const structured = parsedExact.include.length > 1 || parsedExact.exclude.length > 0;
    const exact =
      hasText && toggles.exact
        ? structured
          ? scoreParsedQuery(parsedExact, haystack)
          : exactScore(exactQuery, haystack)
        : null;
    if (options.exactRequired && hasText && !exact) continue;

    const breakdown = combineScores(
      {
        vector: comparable && toggles.vector ? dot(targetVec, entry.vec) : null,
        exact,
        // Fuzzy ignores the syntax: near-miss matching on "-draft" is nonsense.
        fuzzy:
          hasText && toggles.fuzzy
            ? fuzzyScore(parsedExact.include.join(" ") || exactQuery, haystack)
            : null,
      },
      weights,
      toggles,
    );

    if (breakdown.total < minScore) continue;
    // Nothing scored at all, so this entry has no business in the results.
    if (breakdown.parts.every((part) => part.score == null)) continue;

    results.push({
      path: entry.path,
      score: breakdown.total,
      kind: entry.kind,
      breakdown,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
