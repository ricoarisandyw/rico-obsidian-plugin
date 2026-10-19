/**
 * Block references: put a `^id` on a paragraph so other notes can link or embed it
 * with `[[Note#^id]]` / `![[Note#^id]]`.
 *
 * Where the id goes depends on the kind of block (this is how Obsidian reads it):
 * - paragraph, list item: at the end of the last line, after a space
 * - quote, callout, table, code block: on its own line after the block, with a blank line before
 */

export type BlockKind = "inline" | "separate";

export type BlockRefPlan =
  | {
      ok: true;
      id: string;
      /** The block already had an id, so nothing is written. */
      reused: boolean;
      /** Text to insert at the end of `line` (0-based). Absent when `reused`. */
      insert?: { line: number; text: string };
    }
  | { ok: false; reason: string };

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 6;

const TRAILING_ID = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;
const ID_ONLY = /^\^[A-Za-z0-9-]+\s*$/;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s/;
const HEADING = /^\s{0,3}#{1,6}(?:\s|$)/;
const FENCE = /^\s*(```|~~~)/;

const isBlank = (s: string | undefined): boolean => s === undefined || s.trim() === "";
const isQuote = (s: string): boolean => s.trimStart().startsWith(">");
const isTable = (s: string): boolean => s.trimStart().startsWith("|");

/** Every `^id` already used in the note, so a new one never collides. */
export function collectBlockIds(lines: string[]): Set<string> {
  const ids = new Set<string>();
  for (const line of lines) {
    const match = TRAILING_ID.exec(line);
    if (match) ids.add(match[1]);
  }
  return ids;
}

/** A short random id like Obsidian makes (letters and digits), unique within `taken`. */
export function generateBlockId(taken: Set<string>, random: () => number = Math.random): string {
  for (;;) {
    let id = "";
    for (let i = 0; i < ID_LENGTH; i++) id += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)];
    if (!taken.has(id)) return id;
  }
}

/** Last line of the frontmatter block, or -1 when the note has none. */
function frontmatterEnd(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return i;
  }
  return -1;
}

/** The fenced code block that contains `line`, as [start, end], or null. */
function fenceRange(lines: string[], line: number): [number, number] | null {
  let start = -1;
  let marker = "";
  for (let i = 0; i < lines.length; i++) {
    const match = FENCE.exec(lines[i]);
    if (!match) continue;
    if (start === -1) {
      start = i;
      marker = match[1];
    } else if (match[1] === marker) {
      if (line >= start && line <= i) return [start, i];
      start = -1;
    }
    if (start === -1 && i > line) break;
  }
  // An unclosed fence runs to the end of the note.
  if (start !== -1 && line >= start) return [start, lines.length - 1];
  return null;
}

/** First and last line of a contiguous run around `line` where `keep` holds. */
function runAround(lines: string[], line: number, keep: (s: string) => boolean): [number, number] {
  let start = line;
  let end = line;
  while (start > 0 && !isBlank(lines[start - 1]) && keep(lines[start - 1])) start--;
  while (end < lines.length - 1 && !isBlank(lines[end + 1]) && keep(lines[end + 1])) end++;
  return [start, end];
}

/** The list item at `line`, including its indented continuation lines, or null. */
function listItemRange(lines: string[], line: number): [number, number] | null {
  let start = line;
  while (start >= 0 && !isBlank(lines[start]) && !LIST_MARKER.test(lines[start])) {
    if (!/^\s/.test(lines[start])) return null;
    start--;
  }
  if (start < 0 || isBlank(lines[start])) return null;

  let end = start;
  while (
    end < lines.length - 1 &&
    !isBlank(lines[end + 1]) &&
    !LIST_MARKER.test(lines[end + 1]) &&
    /^\s/.test(lines[end + 1])
  ) {
    end++;
  }
  return start <= line && line <= end ? [start, end] : null;
}

/** The block that holds `line`, or why there is none. */
function findBlock(
  lines: string[],
  line: number
): { start: number; end: number; kind: BlockKind } | { reason: string } {
  const fmEnd = frontmatterEnd(lines);
  if (fmEnd !== -1 && line <= fmEnd) return { reason: "Properties can't have a block reference" };

  const fence = fenceRange(lines, line);
  if (fence) return { start: fence[0], end: fence[1], kind: "separate" };

  const text = lines[line];
  if (isBlank(text)) return { reason: "Put the cursor inside a paragraph first" };
  if (HEADING.test(text)) return { reason: "Headings can be linked directly with [[Note#Heading]]" };

  const item = listItemRange(lines, line);
  if (item) return { start: item[0], end: item[1], kind: "inline" };

  if (isQuote(text)) {
    const [start, end] = runAround(lines, line, isQuote);
    return { start, end, kind: "separate" };
  }
  if (isTable(text)) {
    const [start, end] = runAround(lines, line, isTable);
    return { start, end, kind: "separate" };
  }

  const [start, end] = runAround(
    lines,
    line,
    (s) => !LIST_MARKER.test(s) && !HEADING.test(s) && !FENCE.test(s) && !isQuote(s) && !isTable(s)
  );
  return { start, end, kind: "inline" };
}

/** The id already attached to a separate-line block (`^id` right after it), if any. */
function trailingSeparateId(lines: string[], end: number): string | null {
  let next = end + 1;
  if (isBlank(lines[next])) next++;
  const candidate = lines[next];
  return candidate !== undefined && ID_ONLY.test(candidate) ? candidate.trim().slice(1) : null;
}

/**
 * Work out what to write so the block holding `line` (0-based) gets an id.
 * Reuses the block's own id if it has one, so asking twice never stacks ids.
 */
export function planBlockReference(
  lines: string[],
  line: number,
  random: () => number = Math.random
): BlockRefPlan {
  if (line < 0 || line >= lines.length) return { ok: false, reason: "Put the cursor inside a paragraph first" };

  // The cursor is on a separate `^id` line: it belongs to the block above it.
  let target = line;
  if (ID_ONLY.test(lines[target])) {
    target--;
    while (target >= 0 && isBlank(lines[target])) target--;
    if (target < 0) return { ok: false, reason: "Put the cursor inside a paragraph first" };
  }

  const block = findBlock(lines, target);
  if ("reason" in block) return { ok: false, reason: block.reason };

  if (block.kind === "inline") {
    const existing = TRAILING_ID.exec(lines[block.end]);
    if (existing) return { ok: true, id: existing[1], reused: true };
  } else {
    const existing = trailingSeparateId(lines, block.end);
    if (existing) return { ok: true, id: existing, reused: true };
  }

  const id = generateBlockId(collectBlockIds(lines), random);
  const text = block.kind === "inline" ? ` ^${id}` : `\n\n^${id}`;
  return { ok: true, id, reused: false, insert: { line: block.end, text } };
}

/** The line a selection should be judged by: its last line, ignoring a trailing newline. */
export function anchorLine(from: { line: number; ch: number }, to: { line: number; ch: number }): number {
  return to.line > from.line && to.ch === 0 ? to.line - 1 : to.line;
}
