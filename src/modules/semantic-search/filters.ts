/**
 * Result filters, and the query syntax for the exact-match box.
 *
 * No Obsidian imports, so it can be tested without a vault. Frontmatter is
 * passed in as a plain object; the view reads it from metadataCache.
 */

export type FileKind = "md" | "canvas";

export interface SearchFilters {
  /** Which file kinds to keep. Empty means everything. */
  kinds: FileKind[];
  /** Path fragments a result must contain (any of). */
  includePaths: string[];
  /** Path fragments that disqualify a result. */
  excludePaths: string[];
  /** Frontmatter matchers, "key" or "key:value". */
  frontmatterInclude: string[];
  frontmatterExclude: string[];
  /** Epoch ms bounds; null means unbounded. */
  createdAfter: number | null;
  createdBefore: number | null;
  updatedAfter: number | null;
  updatedBefore: number | null;
}

export function emptyFilters(): SearchFilters {
  return {
    kinds: [],
    includePaths: [],
    excludePaths: [],
    frontmatterInclude: [],
    frontmatterExclude: [],
    createdAfter: null,
    createdBefore: null,
    updatedAfter: null,
    updatedBefore: null,
  };
}

/** How many filters are actually doing something, for the "N active" badge. */
export function countActiveFilters(filters: SearchFilters): number {
  let count = 0;
  if (filters.kinds.length) count++;
  if (filters.includePaths.length) count++;
  if (filters.excludePaths.length) count++;
  if (filters.frontmatterInclude.length) count++;
  if (filters.frontmatterExclude.length) count++;
  if (filters.createdAfter !== null || filters.createdBefore !== null) count++;
  if (filters.updatedAfter !== null || filters.updatedBefore !== null) count++;
  return count;
}

/** Split a comma-separated setting into usable fragments. */
export function parseList(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Match one frontmatter rule against a note's frontmatter.
 *
 * "status" means the key exists; "status:open" means it also has that value.
 * Matching is case-insensitive, and an array value matches if any element does,
 * because `tags: [a, b]` is the common shape.
 */
export function matchesFrontmatter(
  rule: string,
  frontmatter: Record<string, unknown> | null | undefined,
): boolean {
  const trimmed = (rule ?? "").trim();
  if (!trimmed || !frontmatter) return false;

  const separator = trimmed.indexOf(":");
  const key = (separator === -1 ? trimmed : trimmed.slice(0, separator)).trim().toLowerCase();
  const wanted = separator === -1 ? null : trimmed.slice(separator + 1).trim().toLowerCase();
  if (!key) return false;

  // Keys are compared case-insensitively, so find the real one first.
  const actualKey = Object.keys(frontmatter).find((k) => k.toLowerCase() === key);
  if (actualKey === undefined) return false;
  if (wanted === null) return true;

  const value = frontmatter[actualKey];
  if (Array.isArray(value)) {
    return value.some((entry) => String(entry).trim().toLowerCase() === wanted);
  }
  return String(value).trim().toLowerCase() === wanted;
}

export interface FilterCandidate {
  path: string;
  kind?: FileKind;
  ctime?: number;
  mtime?: number;
  frontmatter?: Record<string, unknown> | null;
}

/** True when a candidate survives every active filter. */
export function passesFilters(candidate: FilterCandidate, filters: SearchFilters): boolean {
  if (filters.kinds.length) {
    // Entries indexed before kinds existed default to markdown.
    const kind = candidate.kind ?? "md";
    if (!filters.kinds.includes(kind)) return false;
  }

  // Exclusions win over inclusions: saying "not here" should always hold.
  if (filters.excludePaths.some((fragment) => candidate.path.includes(fragment))) return false;
  if (
    filters.includePaths.length &&
    !filters.includePaths.some((fragment) => candidate.path.includes(fragment))
  ) {
    return false;
  }

  if (filters.frontmatterExclude.some((rule) => matchesFrontmatter(rule, candidate.frontmatter))) {
    return false;
  }
  if (
    filters.frontmatterInclude.length &&
    !filters.frontmatterInclude.some((rule) => matchesFrontmatter(rule, candidate.frontmatter))
  ) {
    return false;
  }

  if (!withinRange(candidate.ctime, filters.createdAfter, filters.createdBefore)) return false;
  if (!withinRange(candidate.mtime, filters.updatedAfter, filters.updatedBefore)) return false;

  return true;
}

/** A missing timestamp fails a bounded range rather than slipping through. */
function withinRange(value: number | undefined, after: number | null, before: number | null): boolean {
  if (after === null && before === null) return true;
  if (value === undefined) return false;
  if (after !== null && value < after) return false;
  if (before !== null && value > before) return false;
  return true;
}

// --- exact-match query syntax -------------------------------------------------

export interface ParsedQuery {
  /** Terms that must appear. Quoted groups stay whole. */
  include: string[];
  /** Terms that must not appear. */
  exclude: string[];
}

/**
 * Parse the exact box into required and forbidden terms.
 *
 * `"kontrak HVAC" invoice -draft` means: the phrase "kontrak HVAC" and the word
 * "invoice" must appear, and "draft" must not.
 */
export function parseExactQuery(raw: string | null | undefined): ParsedQuery {
  const include: string[] = [];
  const exclude: string[] = [];
  const text = (raw ?? "").trim();
  if (!text) return { include, exclude };

  // Quoted phrases first, then whatever words are left.
  const pattern = /(-?)"([^"]+)"|(-?)(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const negatedQuoted = match[1] === "-";
    const quoted = match[2];
    const negatedBare = match[3] === "-";
    const bare = match[4];

    const term = (quoted ?? bare ?? "").trim();
    if (!term) continue;
    if (negatedQuoted || negatedBare) exclude.push(term);
    else include.push(term);
  }
  return { include, exclude };
}

/**
 * Score a parsed query against text, 0-1.
 *
 * Any excluded term present means 0: the user asked for it not to be there.
 * Otherwise it is the fraction of required terms found.
 */
export function scoreParsedQuery(parsed: ParsedQuery, text: string): number {
  const haystack = (text ?? "").toLowerCase();
  if (!haystack) return 0;

  for (const term of parsed.exclude) {
    if (haystack.includes(term.toLowerCase())) return 0;
  }
  if (!parsed.include.length) {
    // Only exclusions were given, and none matched, so this is a pass.
    return parsed.exclude.length ? 1 : 0;
  }
  const hits = parsed.include.filter((term) => haystack.includes(term.toLowerCase())).length;
  return hits / parsed.include.length;
}
