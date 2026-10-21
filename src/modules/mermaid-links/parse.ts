/**
 * Reading the relations out of a mermaid diagram.
 *
 * The decorator only needs the wikilinks (it matches them to rendered text),
 * but the graph layer needs the *edges*: which note points at which. That is
 * what this file recovers, by following each diagram's own arrow syntax back
 * to the notes its endpoints were declared with.
 *
 * Parsing runs on the original source, before wikilinks are stripped, so a
 * node's declared link is known. Nothing here touches the DOM.
 */

import { parseWikilink, type Wikilink } from "./wikilink";

/** A relation between two notes, recovered from a diagram's arrows. */
export interface DiagramEdge {
  /** linktext of the source note. */
  from: string;
  /** linktext of the destination note. */
  to: string;
}

export interface ParsedDiagram {
  /** Every wikilink in the diagram, whether or not it takes part in an edge. */
  links: Wikilink[];
  /** Relations between notes, deduped. */
  edges: DiagramEdge[];
}

const EMPTY: ParsedDiagram = { links: [], edges: [] };

/** First non-empty, non-comment line decides the diagram type. */
export function detectType(source: string): "sequence" | "flowchart" | null {
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("%%")) continue;
    if (/^sequenceDiagram\b/.test(line)) return "sequence";
    if (/^(flowchart|graph)\b/.test(line)) return "flowchart";
    return null;
  }
  return null;
}

/** Strip an inline `%%` comment, which mermaid ignores. */
function stripComment(line: string): string {
  const i = line.indexOf("%%");
  return i === -1 ? line : line.slice(0, i);
}

/** The single wikilink in a piece of text, if it is entirely one. */
function soleWikilink(text: string): Wikilink | null {
  const m = text.trim().match(/^\[\[([^\[\]]+?)\]\]$/);
  return m ? parseWikilink(m[1]) : null;
}

// ---- sequenceDiagram ----

/** `participant A as [[Admin]]` / `actor A as [[Admin]]` / `participant [[Admin]]`. */
const SEQ_DECL = /^\s*(?:participant|actor)\s+(.+)$/;

/**
 * `A->>B: text`. Mermaid's arrows are a small fixed set; the message after the
 * colon is ignored because it is prose, not a relation.
 */
const SEQ_ARROW = /^\s*([^\s:]+?)\s*(?:-{1,2}>>?|-{1,2}x|-{1,2}\)|<<-{1,2}>>?)\s*\+?-?\s*([^\s:]+?)\s*:/;

function parseSequence(source: string): ParsedDiagram {
  // Participant id -> the note it was declared with.
  const byId = new Map<string, Wikilink>();
  const links: Wikilink[] = [];
  const edges: DiagramEdge[] = [];

  const remember = (link: Wikilink | null) => {
    if (link && !links.some((l) => l.linktext === link.linktext)) links.push(link);
  };

  for (const raw of source.split("\n")) {
    const line = stripComment(raw);
    const decl = line.match(SEQ_DECL);
    if (decl) {
      const rest = decl[1].trim();
      // `participant <id> as <label>`, or just `participant <label>`.
      const asSplit = rest.match(/^(\S+)\s+as\s+(.+)$/);
      const id = asSplit ? asSplit[1] : rest;
      const label = asSplit ? asSplit[2] : rest;
      const link = soleWikilink(label);
      if (link) {
        byId.set(id.trim(), link);
        // An undeclared id used in an arrow is its own label, so map that too.
        byId.set(label.trim(), link);
        remember(link);
      }
      continue;
    }

    const arrow = line.match(SEQ_ARROW);
    if (arrow) {
      const from = byId.get(arrow[1].trim());
      const to = byId.get(arrow[2].trim());
      if (from && to && from.linktext !== to.linktext) {
        edges.push({ from: from.linktext, to: to.linktext });
      }
    }
  }

  return { links, edges: dedupe(edges) };
}

// ---- flowchart ----

/**
 * Mermaid's node shapes, as opening/closing bracket pairs. Matching these by
 * scanning rather than with one big regex matters because a wikilink inside a
 * shape nests brackets: `X[[[Admin]]]` is a `[...]` shape whose label is
 * `[[Admin]]`. An alternation would happily read the `[[` as a subroutine
 * shape and capture `"[Admin"`, taking the outer bracket with it.
 */
const SHAPES: ReadonlyArray<readonly [string, string]> = [
  ["([", "])"],
  ["[(", ")]"],
  ["((", "))"],
  ["{{", "}}"],
  ["[[", "]]"],
  ["[", "]"],
  ["(", ")"],
  ["{", "}"],
  [">", "]"],
];

/**
 * Characters a node id may contain. `-` is deliberately excluded: it is also
 * the body of every arrow (`-->`, `-.->`), so allowing it would make the
 * scanner read `A[x] --> B[y]` as an id of `--` and lose the second node.
 * Ids with hyphens are rare, and mermaid itself discourages them.
 */
const ID_CHAR = /[A-Za-z0-9_]/;

interface FlowNode {
  id: string;
  label: string;
  /** Index just past the node's closing bracket. */
  end: number;
  /** Index where the node's id starts. */
  start: number;
}

/**
 * Find the node declarations on one line by walking it: read an id, then the
 * shape that follows, tracking bracket depth so the label's own brackets do
 * not end it early.
 */
function scanNodes(line: string): FlowNode[] {
  const nodes: FlowNode[] = [];
  let i = 0;

  while (i < line.length) {
    if (!ID_CHAR.test(line[i])) {
      i++;
      continue;
    }
    const idStart = i;
    while (i < line.length && ID_CHAR.test(line[i])) i++;
    const id = line.slice(idStart, i);

    // Several shapes can match at one position: `A[[[x]]]` starts with both
    // `[[` and `[`. Read each candidate fully and prefer the one whose label
    // is a whole wikilink, so the shape's own bracket is not swallowed.
    let best: { label: string; end: number } | null = null;

    for (const [openTok, closeTok] of SHAPES) {
      if (!line.startsWith(openTok, i)) continue;

      const labelStart = i + openTok.length;
      // Depth counts the label's own brackets so `[[Admin]]` inside `[...]`
      // does not look like the end of the shape.
      let depth = 1;
      let j = labelStart;
      while (j < line.length && depth > 0) {
        if (line.startsWith(closeTok, j)) {
          depth--;
          if (depth === 0) break;
          j += closeTok.length;
          continue;
        }
        if (line.startsWith(openTok, j)) {
          depth++;
          j += openTok.length;
          continue;
        }
        j++;
      }
      if (depth !== 0) continue;

      const candidate = { label: line.slice(labelStart, j), end: j + closeTok.length };
      if (soleWikilink(candidate.label)) {
        best = candidate;
        break;
      }
      // Keep the first well-formed shape as a fallback, so a plain node is
      // still recognised (and still consumed) when no wikilink is involved.
      if (!best) best = candidate;
    }

    if (!best) continue;
    const { label, end } = best;

    nodes.push({ id, label, start: idStart, end });
    i = end;
  }

  return nodes;
}

/** Mermaid's link operators, e.g. `-->`, `---`, `-.->`, `==>`, with optional `|label|`. */
const FLOW_ARROW = /\s*(?:<?(?:-{2,}|-\.-|={2,}|-\.)[->ox]?>?|<-->)\s*(?:\|[^|]*\|\s*)?/;

function parseFlowchart(source: string): ParsedDiagram {
  const byId = new Map<string, Wikilink>();
  const links: Wikilink[] = [];
  const edges: DiagramEdge[] = [];

  const remember = (link: Wikilink) => {
    if (!links.some((l) => l.linktext === link.linktext)) links.push(link);
  };

  const lines = source.split("\n").map(stripComment);

  // Pass 1: every node declaration anywhere in the diagram.
  for (const line of lines) {
    for (const node of scanNodes(line)) {
      const link = soleWikilink(node.label);
      if (link) {
        byId.set(node.id, link);
        remember(link);
      }
    }
  }

  // Pass 2: edges, now that every id's note is known.
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !FLOW_ARROW.test(trimmed)) continue;

    // Reduce `A[label] --> B[label]` to `A --> B` before splitting, since a
    // label may itself contain something that looks like an arrow.
    let skeleton = "";
    let cursor = 0;
    for (const node of scanNodes(line)) {
      skeleton += line.slice(cursor, node.start) + node.id;
      cursor = node.end;
    }
    skeleton += line.slice(cursor);

    const parts = skeleton.split(FLOW_ARROW).map((p) => p.trim()).filter(Boolean);

    // `A --> B --> C` is a chain of consecutive pairs.
    for (let i = 0; i + 1 < parts.length; i++) {
      const from = byId.get(parts[i]);
      const to = byId.get(parts[i + 1]);
      if (from && to && from.linktext !== to.linktext) {
        edges.push({ from: from.linktext, to: to.linktext });
      }
    }
  }

  return { links, edges: dedupe(edges) };
}

function dedupe(edges: DiagramEdge[]): DiagramEdge[] {
  const seen = new Set<string>();
  const out: DiagramEdge[] = [];
  for (const e of edges) {
    const key = `${e.from}\u0000${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** Parse a diagram, or return nothing for a type we do not handle yet. */
export function parseDiagram(source: string): ParsedDiagram {
  switch (detectType(source)) {
    case "sequence":
      return parseSequence(source);
    case "flowchart":
      return parseFlowchart(source);
    default:
      return EMPTY;
  }
}
