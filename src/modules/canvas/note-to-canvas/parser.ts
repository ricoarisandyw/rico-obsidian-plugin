/**
 * Markdown -> section tree. Pure text work: no Obsidian APIs, so it is easy to test.
 *
 * A heading starts a new section; everything up to the next heading of the same or a
 * higher level is its body. Headings deeper than `maxDepth` are folded back into the
 * body of the nearest section that is allowed to split.
 */

export interface Section {
  /** Stable id derived from the heading path, e.g. "rico-n2c:Plan/Goals". */
  id: string;
  /** Heading text without the leading #s ("(intro)" for text before the first heading). */
  title: string;
  /** Heading level 1-6; 0 for the intro / a note with no headings. */
  level: number;
  /** Body text under this heading, trimmed, folded sub-headings included. */
  body: string;
  /** Id of the parent section, or null at the top. */
  parentId: string | null;
  children: Section[];
}

export const ID_PREFIX = "rico-n2c:";

/** Title used for text that sits before the very first heading. */
export const INTRO_TITLE = "(intro)";

interface RawHeading {
  level: number;
  title: string;
  line: number;
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.*)$/;

/**
 * Headings in the note, skipping anything inside a fenced code block.
 * A fence closes on the next line that starts a fence of the same marker.
 */
export function findHeadings(lines: string[]): RawHeading[] {
  const out: RawHeading[] = [];
  let fence: string | null = null;

  lines.forEach((line, index) => {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      return;
    }
    if (fence !== null) return;

    const match = HEADING.exec(line);
    if (match) out.push({ level: match[1].length, title: match[2].trim(), line: index });
  });

  return out;
}

/** Slugify a heading for the id path: keep it readable but free of "/" and whitespace runs. */
function slug(title: string): string {
  return title.replace(/[/\\]/g, "-").replace(/\s+/g, " ").trim() || "untitled";
}

/**
 * Split a note into a section tree.
 *
 * @param markdown the note's full text
 * @param maxDepth deepest heading level that gets its own card (1-6); deeper headings
 *                 stay in their parent's body
 */
export function parseSections(markdown: string, maxDepth = 6): Section[] {
  const depth = Math.min(6, Math.max(1, Math.floor(maxDepth) || 6));
  const lines = markdown.split(/\r?\n/);
  const headings = findHeadings(lines).filter((h) => h.level <= depth);

  // No headings at all (or none shallow enough): the whole note is one card.
  if (headings.length === 0) {
    const body = markdown.trim();
    if (!body) return [];
    return [{ id: `${ID_PREFIX}${INTRO_TITLE}`, title: INTRO_TITLE, level: 0, body, parentId: null, children: [] }];
  }

  const roots: Section[] = [];
  const stack: Section[] = [];
  const used = new Set<string>();

  /** Unique id for a section, given the path of its ancestors. */
  const makeId = (path: string[]): string => {
    const base = `${ID_PREFIX}${path.map(slug).join("/")}`;
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    let n = 2;
    while (used.has(`${base} (${n})`)) n += 1;
    const id = `${base} (${n})`;
    used.add(id);
    return id;
  };

  const attach = (section: Section): void => {
    while (stack.length > 0 && stack[stack.length - 1].level >= section.level) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) {
      section.parentId = parent.id;
      parent.children.push(section);
    } else {
      roots.push(section);
    }
    stack.push(section);
  };

  // Text before the first heading becomes an intro section at the top.
  const preamble = lines.slice(0, headings[0].line).join("\n").trim();
  if (preamble) {
    const intro: Section = {
      id: makeId([INTRO_TITLE]),
      title: INTRO_TITLE,
      level: headings[0].level,
      body: preamble,
      parentId: null,
      children: [],
    };
    roots.push(intro);
  }

  headings.forEach((heading, i) => {
    const next = headings[i + 1];
    const body = lines
      .slice(heading.line + 1, next ? next.line : lines.length)
      .join("\n")
      .trim();

    const ancestors = stack.filter((s) => s.level < heading.level).map((s) => s.title);
    const section: Section = {
      id: makeId([...ancestors, heading.title]),
      title: heading.title,
      level: heading.level,
      body,
      parentId: null,
      children: [],
    };
    attach(section);
  });

  return roots;
}

/** Walk the tree depth-first, parents before children. */
export function flatten(sections: Section[]): Section[] {
  const out: Section[] = [];
  const visit = (list: Section[]): void => {
    for (const section of list) {
      out.push(section);
      visit(section.children);
    }
  };
  visit(sections);
  return out;
}
