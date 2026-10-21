/**
 * Pulling wikilinks out of a mermaid diagram, and putting plain text back in.
 *
 * Mermaid's own parsers choke on `[[...]]` inside a node label — `A[[[Note]]]`
 * is a parse error, because `[[` already means a subroutine shape. So the
 * diagram mermaid sees never contains a wikilink: this module strips them to
 * plain text first, remembers what each label pointed at, and the decorator
 * puts the links back onto the rendered SVG afterwards.
 *
 * Nothing here touches the DOM or Obsidian, so it is all directly testable.
 */

/** One `[[Note|Alias]]` found in a diagram. */
export interface Wikilink {
  /** Note name, without the `#heading` part. */
  path: string;
  /** `#heading` / `#^block`, or "" when there is none. */
  subpath: string;
  /** What `openLinkText` should be given: path + subpath. */
  linktext: string;
  /** The text shown in the diagram: the alias if given, else the path. */
  display: string;
}

/** A diagram with its wikilinks replaced by plain text. */
export interface StrippedSource {
  /** Mermaid-safe source: every `[[...]]` replaced by its display text. */
  source: string;
  /** Every wikilink found, keyed by the display text left in the diagram. */
  byDisplay: Map<string, Wikilink>;
}

/**
 * `[[Note]]`, `[[Note|Alias]]`, `[[Note#Heading]]`.
 *
 * Brackets are banned inside the match for two reasons. It keeps `[[a]] [[b]]`
 * two links rather than one, and — the subtle one — it makes the match land on
 * the *innermost* `[[` when a wikilink sits inside a flowchart node shape.
 * Allowing `[` would make `X[[[Admin]]]` capture `"[Admin"`, taking the shape's
 * own bracket with it.
 */
const WIKILINK_RE = /\[\[([^\[\]]+?)\]\]/g;

/**
 * `A[[Subroutine]]` is a real mermaid node shape, not a wikilink, and the two
 * are written identically. We treat `[[...]]` as a shape when it is attached
 * to a node id (`A[[x]]`) and as a wikilink when it stands alone (`[[x]]`) or
 * is nested in another shape (`A[[[x]]]`, already handled by the bracket ban).
 *
 * The character before the `[[` tells them apart: part of an identifier means
 * the author wrote a shape.
 */
function isSubroutineShape(source: string, matchStart: number): boolean {
  const before = source.slice(0, matchStart).match(/[\w\u00C0-\uFFFF]$/);
  return before !== null;
}

/** Split `Note#Heading` into its file part and its in-note part. */
export function splitSubpath(linktext: string): { path: string; subpath: string } {
  const hash = linktext.indexOf("#");
  if (hash === -1) return { path: linktext.trim(), subpath: "" };
  return { path: linktext.slice(0, hash).trim(), subpath: linktext.slice(hash).trim() };
}

/** Parse the inside of a `[[...]]` into a Wikilink, or null if it names nothing. */
export function parseWikilink(inner: string): Wikilink | null {
  const pipe = inner.indexOf("|");
  const targetRaw = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
  const alias = pipe === -1 ? "" : inner.slice(pipe + 1).trim();
  if (!targetRaw) return null;

  const { path, subpath } = splitSubpath(targetRaw);
  if (!path && !subpath) return null;

  return {
    path,
    subpath,
    linktext: path + subpath,
    // A link with only a subpath (`[[#Heading]]`) shows the heading itself.
    display: alias || path || subpath,
  };
}

/** Is there anything for this module to do? Agrees with `stripWikilinks`. */
export function hasWikilink(source: string): boolean {
  WIKILINK_RE.lastIndex = 0;
  for (const m of source.matchAll(WIKILINK_RE)) {
    if (isSubroutineShape(source, m.index ?? 0)) continue;
    if (parseWikilink(m[1])) return true;
  }
  return false;
}

/**
 * Replace every `[[...]]` with its display text so mermaid can parse the
 * diagram, keeping a map from that display text back to the link.
 *
 * Two different links that would show the same text collapse to one entry:
 * the rendered SVG only gives us the text back, so they are indistinguishable
 * by then. First one wins, which keeps the behaviour predictable.
 */
export function stripWikilinks(source: string): StrippedSource {
  const byDisplay = new Map<string, Wikilink>();

  const stripped = source.replace(WIKILINK_RE, (whole, inner: string, offset: number) => {
    // `A[[Sub]]` is a node shape mermaid already understands; leave it alone.
    if (isSubroutineShape(source, offset)) return whole;
    const link = parseWikilink(inner);
    // Leave something we could not parse exactly as it was.
    if (!link) return whole;
    if (!byDisplay.has(link.display)) byDisplay.set(link.display, link);
    return link.display;
  });

  return { source: stripped, byDisplay };
}
