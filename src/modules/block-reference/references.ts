/**
 * Pure data logic behind the Block References panels: what each `^id` says,
 * which notes cite it, and which `[[Note#^id]]` links point at nothing.
 */

/** A block that has a `^id`. */
export interface BlockInfo {
  /** Vault path of the note that holds the block. */
  path: string;
  id: string;
  /** 0-based line where the block starts. */
  line: number;
  snippet: string;
}

/** One `[[Note#^id]]` link or `![[Note#^id]]` embed, with its target note already resolved. */
export interface BlockRef {
  /** Note that contains the link. */
  source: string;
  /** Note the link points into. */
  target: string;
  id: string;
}

export interface Citation {
  source: string;
  count: number;
}

export interface BlockRow extends BlockInfo {
  /** Notes that link or embed this block, most citations first. */
  cited: Citation[];
}

export interface BrokenRef extends BlockRef {
  count: number;
}

export interface BlockSummary {
  rows: BlockRow[];
  broken: BrokenRef[];
}

const SNIPPET_MAX = 160;
const BLOCK_LINK = /^(.*?)#\^([A-Za-z0-9-]+)$/;

/** Obsidian treats block ids case-insensitively, so keys are lower-cased. */
export function blockKey(path: string, id: string): string {
  return `${path}#^${id.toLowerCase()}`;
}

/**
 * Split the link text of a link/embed (`Note#^id`, without any `|alias`) into note and id.
 * `path` is empty for a link inside the same note (`#^id`). Heading links and plain links give null.
 */
export function parseBlockLink(link: string): { path: string; id: string } | null {
  const match = BLOCK_LINK.exec(link.trim());
  return match ? { path: match[1], id: match[2] } : null;
}

/** Plain, one-line text of a block for the list. Quote marks and list bullets are dropped. */
export function tidySnippet(text: string): string {
  const plain = text
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?/, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > SNIPPET_MAX ? `${plain.slice(0, SNIPPET_MAX - 1).trimEnd()}…` : plain;
}

/**
 * The text a `^id` belongs to. The id is cut off the end. When the id sits alone on the line
 * after a quote or table, the block above it is used instead.
 */
export function snippetFor(content: string, start: number, end: number, id: string): string {
  const idAtEnd = new RegExp(`\\s*\\^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  const own = content.slice(start, end).replace(idAtEnd, "");
  if (own.trim()) return tidySnippet(own);

  const above = content.slice(0, start).trimEnd();
  const blocks = above.split(/\n[ \t]*\n/);
  return tidySnippet(blocks[blocks.length - 1] ?? "");
}

const byCountThenName = (a: Citation, b: Citation): number =>
  b.count - a.count || a.source.localeCompare(b.source);

/**
 * Join blocks with the links that point at them.
 * `existing` holds the key of every block in the vault, so a link into a note that
 * only some of its blocks are listed for is not mistaken for a broken one.
 */
export function summarize(blocks: BlockInfo[], refs: BlockRef[], existing: Set<string>): BlockSummary {
  const cited = new Map<string, Map<string, number>>();
  const broken = new Map<string, BrokenRef>();

  for (const ref of refs) {
    const key = blockKey(ref.target, ref.id);
    if (existing.has(key)) {
      const sources = cited.get(key) ?? new Map<string, number>();
      sources.set(ref.source, (sources.get(ref.source) ?? 0) + 1);
      cited.set(key, sources);
    } else {
      const brokenKey = `${ref.source}|${key}`;
      const entry = broken.get(brokenKey);
      if (entry) entry.count++;
      else broken.set(brokenKey, { ...ref, count: 1 });
    }
  }

  const rows = [...blocks]
    .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
    .map((block) => ({
      ...block,
      cited: [...(cited.get(blockKey(block.path, block.id))?.entries() ?? [])]
        .map(([source, count]) => ({ source, count }))
        .sort(byCountThenName),
    }));

  const brokenRefs = [...broken.values()].sort(
    (a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.id.localeCompare(b.id)
  );

  return { rows, broken: brokenRefs };
}

export const totalCitations = (row: BlockRow): number => row.cited.reduce((sum, c) => sum + c.count, 0);

/** Keep rows whose id, text or note path contains every word typed, optionally only the never-cited ones. */
export function filterRows(rows: BlockRow[], query: string, uncitedOnly: boolean): BlockRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (uncitedOnly && row.cited.length > 0) return false;
    const haystack = `${row.id} ${row.snippet} ${row.path}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}
