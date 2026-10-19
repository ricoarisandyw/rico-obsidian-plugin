import { nodeIcon, nodeLabel } from "../layers";
import type { CanvasNodeData } from "../layers";
import type { CanvasData, CanvasDataEdge, CanvasDataNode } from "../../../shared/utils/canvas";

/** How another node is connected to this one. */
export interface OutlineRelation {
  /** The other node. */
  id: string;
  label: string;
  /** → this node points to it, ← it points to this node, ↔ both ways, — no arrowheads. */
  arrow: "→" | "←" | "↔" | "—";
  /** Text written on the arrow, if any. */
  edgeLabel?: string;
}

/** One block of the outline. `children` are the nodes inside a group. */
export interface OutlineItem {
  id: string;
  type: string;
  label: string;
  icon: string;
  /** Raw content of the node, used to build the markdown view. */
  text?: string;
  file?: string;
  url?: string;
  /** Every arrow that touches this node, so loops and tangles are never hidden. */
  relations: OutlineRelation[];
  children: OutlineItem[];
}

/** Longest text node (in lines) shown in the outline. */
export const MAX_NODE_LINES = 12;

const area = (n: CanvasDataNode): number => (n.width ?? 0) * (n.height ?? 0);

/** Is the centre of `n` inside the box of `g`? */
function insideBox(n: CanvasDataNode, g: CanvasDataNode): boolean {
  const cx = (n.x ?? 0) + (n.width ?? 0) / 2;
  const cy = (n.y ?? 0) + (n.height ?? 0) / 2;
  const gx = g.x ?? 0;
  const gy = g.y ?? 0;
  return cx >= gx && cx <= gx + (g.width ?? 0) && cy >= gy && cy <= gy + (g.height ?? 0);
}

/** Reading order: top to bottom, then left to right. */
function readingOrder(a: CanvasDataNode, b: CanvasDataNode): number {
  return (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0);
}

/** The smallest group that holds `n` (a group only nests inside a larger group). */
function findParentGroup(n: CanvasDataNode, groups: CanvasDataNode[]): string | null {
  let best: CanvasDataNode | null = null;
  for (const g of groups) {
    if (g.id === n.id || !insideBox(n, g)) continue;
    if (n.type === "group" && area(g) <= area(n)) continue;
    if (!best || area(g) < area(best)) best = g;
  }
  return best ? best.id : null;
}

const ARROW_ORDER: OutlineRelation["arrow"][] = ["→", "←", "↔", "—"];

/** Every arrow of the canvas, written once from each end. Nothing is dropped. */
function buildRelations(
  nodes: CanvasDataNode[],
  edges: CanvasDataEdge[],
  labelOf: Map<string, string>,
): Map<string, OutlineRelation[]> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const relations = new Map<string, OutlineRelation[]>(nodes.map((n) => [n.id, []]));

  for (const edge of edges) {
    const a = byId.get(edge.fromNode);
    const b = byId.get(edge.toNode);
    if (!a || !b) continue;
    const edgeLabel = typeof edge.label === "string" && edge.label.trim() ? edge.label.trim() : undefined;
    const add = (owner: CanvasDataNode, other: CanvasDataNode, arrow: OutlineRelation["arrow"]): void => {
      relations.get(owner.id)!.push({ id: other.id, label: labelOf.get(other.id) ?? "Node", arrow, edgeLabel });
    };

    if (a.id === b.id) {
      add(a, a, "↔");
      continue;
    }
    const fromArrow = edge.fromEnd === "arrow";
    const toArrow = edge.toEnd !== "none"; // Obsidian draws an arrowhead at the end by default
    if (fromArrow && toArrow) {
      add(a, b, "↔");
      add(b, a, "↔");
    } else if (toArrow) {
      add(a, b, "→");
      add(b, a, "←");
    } else if (fromArrow) {
      add(a, b, "←");
      add(b, a, "→");
    } else {
      add(a, b, "—");
      add(b, a, "—");
    }
  }

  // Outgoing first, then incoming; inside each kind, reading order of the other node.
  for (const list of relations.values()) {
    list.sort(
      (x, y) =>
        ARROW_ORDER.indexOf(x.arrow) - ARROW_ORDER.indexOf(y.arrow) ||
        readingOrder(byId.get(x.id)!, byId.get(y.id)!),
    );
  }
  return relations;
}

/**
 * Turn a canvas into an outline (pure, never touches the canvas).
 *   - a node inside a group's box becomes a child of the smallest such group
 *   - every arrow is listed as a relation on both nodes it connects, even loops
 * Siblings are listed in reading order.
 */
export function buildOutline(data: Pick<CanvasData, "nodes" | "edges">): OutlineItem[] {
  const nodes = data.nodes ?? [];
  const edges = data.edges ?? [];
  const groups = nodes.filter((n) => n.type === "group");
  const container = new Map(nodes.map((n) => [n.id, findParentGroup(n, groups)]));

  const labelOf = new Map(nodes.map((n) => [n.id, nodeLabel(n as CanvasNodeData)]));
  const relations = buildRelations(nodes, edges, labelOf);

  const items = new Map<string, OutlineItem>();
  for (const n of nodes) {
    items.set(n.id, {
      id: n.id,
      type: n.type ?? "node",
      label: labelOf.get(n.id)!,
      icon: nodeIcon(n as CanvasNodeData),
      text: typeof n.text === "string" ? n.text : undefined,
      file: typeof n.file === "string" ? n.file : undefined,
      url: typeof n.url === "string" ? n.url : undefined,
      relations: relations.get(n.id) ?? [],
      children: [],
    });
  }

  const roots: OutlineItem[] = [];
  for (const n of [...nodes].sort(readingOrder)) {
    const item = items.get(n.id)!;
    const parentId = container.get(n.id);
    (parentId ? items.get(parentId)!.children : roots).push(item);
  }
  return roots;
}

/**
 * Keep the items whose label matches `query`, plus their ancestors.
 * A matching item keeps all of its children, so searching a group shows its content.
 */
export function filterOutline(items: OutlineItem[], query: string): OutlineItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const walk = (list: OutlineItem[]): OutlineItem[] =>
    list.flatMap((item) => {
      if (`${item.label}\n${item.text ?? ""}`.toLowerCase().includes(q)) return [item];
      const children = walk(item.children);
      return children.length ? [{ ...item, children }] : [];
    });
  return walk(items);
}

/** Total number of items in the tree. */
export function countItems(items: OutlineItem[]): number {
  return items.reduce((sum, item) => sum + 1 + countItems(item.children), 0);
}

/** Push every markdown heading in `text` down by `shift` levels (max `######`). */
function shiftHeadings(text: string, shift: number): string {
  if (shift <= 0) return text;
  let inFence = false;
  return text
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      if (inFence) return line;
      return line.replace(/^(#{1,6})(\s)/, (_, hashes: string, space: string) => "#".repeat(Math.min(6, hashes.length + shift)) + space);
    })
    .join("\n");
}

/** Cut long text to MAX_NODE_LINES lines. */
function clipLines(text: string): string {
  const lines = text.split("\n");
  return lines.length > MAX_NODE_LINES ? `${lines.slice(0, MAX_NODE_LINES).join("\n")}\n…` : text;
}

/** Bullet list of every relation of an item ("" when it has none). */
export function relationsMarkdown(item: OutlineItem): string {
  return item.relations
    .map((r) => `- ${r.arrow} ${r.label}${r.edgeLabel ? ` _(${r.edgeLabel})_` : ""}`)
    .join("\n");
}

/** Divider written after every node. */
export const NODE_SEPARATOR = "---";

/**
 * Markdown for one item (its children are not included).
 *   - group -> heading, one level deeper per group around it, then its relations
 *   - text -> the node's text, headings pushed down below the group heading
 *   - file -> [[link]], link -> [title](url)
 *   - then a bullet list of every relation, and a `---` divider after each node
 * Returns "" for an empty node without relations.
 * `groupDepth` is how many groups surround the item.
 * With `withRelations` false only the content is returned (no bullets, no divider),
 * so the panel can draw the relations itself as clickable links.
 */
export function itemMarkdown(item: OutlineItem, groupDepth: number, withRelations = true): string {
  const relations = withRelations ? relationsMarkdown(item) : "";
  let body: string;
  switch (item.type) {
    case "group":
      return [`${"#".repeat(Math.min(6, groupDepth + 1))} ${item.label}`, relations].filter(Boolean).join("\n\n");
    case "text": {
      const raw = (item.text ?? "").trim();
      body = raw ? clipLines(shiftHeadings(raw, groupDepth)) : item.url ?? "";
      break;
    }
    case "file": {
      const path = item.file ?? "";
      body = path ? `[[${path.replace(/\.md$/i, "")}|${item.label.replace(/\.md$/i, "")}]]` : "";
      break;
    }
    case "link":
      body = item.url ? `[${item.label}](${item.url})` : "";
      break;
    default:
      body = item.label;
  }
  if (!body.trim() && item.relations.length === 0) return "";
  const content = body.trim() || "_Empty node_";
  if (!withRelations) return content;
  return [content, relations, NODE_SEPARATOR].filter(Boolean).join("\n\n");
}

/** Groups surround every item of a titled outline by one level, because the title is the H1. */
export const OUTLINE_BASE_DEPTH = 1;

function bodyMarkdown(items: OutlineItem[], groupDepth: number): string {
  return items
    .flatMap((item) => [
      itemMarkdown(item, groupDepth),
      bodyMarkdown(item.children, item.type === "group" ? groupDepth + 1 : groupDepth),
    ])
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The whole outline as one markdown document (same text the panel shows).
 * With a `title`: an H1, a `---` divider, then the content one heading level lower.
 */
export function outlineToMarkdown(items: OutlineItem[], title = ""): string {
  if (!title) return bodyMarkdown(items, 0);
  return [`# ${title}`, NODE_SEPARATOR, bodyMarkdown(items, OUTLINE_BASE_DEPTH)].filter(Boolean).join("\n\n");
}
