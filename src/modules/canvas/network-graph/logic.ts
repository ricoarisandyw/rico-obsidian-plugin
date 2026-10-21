import { nodeLabel } from "../layers";
import type { CanvasNodeData } from "../layers";
import type { CanvasData } from "../../../shared/utils/canvas";

/** The kinds of node we colour differently. Anything unknown falls back to "other". */
export type GraphNodeType = "file" | "text" | "link" | "group" | "other";

export interface GraphNode {
  /** Canvas node id, used to zoom to the real card. */
  id: string;
  label: string;
  type: GraphNodeType;
  /** Number of distinct neighbours (a self-loop counts as one). */
  degree: number;
}

export interface GraphLink {
  source: string;
  target: string;
  /** → source points at target, ← target points at source, ↔ both, — neither. */
  arrow: "→" | "←" | "↔" | "—";
  /** Text written on the arrow, if any. */
  label?: string;
}

export interface Graph {
  nodes: GraphNode[];
  links: GraphLink[];
}

const KNOWN_TYPES: GraphNodeType[] = ["file", "text", "link", "group"];

/** Human-readable name for each node type, used by the legend. */
export const TYPE_NAMES: Record<GraphNodeType, string> = {
  file: "File",
  text: "Text",
  link: "Link",
  group: "Group",
  other: "Other",
};

function toType(raw: string | undefined): GraphNodeType {
  const type = raw as GraphNodeType;
  return KNOWN_TYPES.includes(type) ? type : "other";
}

/** Order-independent key for an undirected pair, so A→B and B→A collapse into one link. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/**
 * Merge two arrow directions seen on the same pair of nodes.
 * Anything pointing both ways, or two opposite arrows, becomes "↔".
 */
function mergeArrows(a: GraphLink["arrow"], b: GraphLink["arrow"]): GraphLink["arrow"] {
  if (a === b) return a;
  if (a === "—") return b;
  if (b === "—") return a;
  return "↔";
}

/**
 * Turn a canvas into a graph model. Pure — it never touches the canvas.
 *   - every node becomes a graph node, labelled the same way the outline labels it
 *   - edges collapse into one undirected link per pair, keeping the arrow direction
 *   - edges pointing at a node that no longer exists are dropped
 *   - self-loops are dropped from the links but still count once towards degree
 */
export function buildGraph(data: Pick<CanvasData, "nodes" | "edges">): Graph {
  const rawNodes = data.nodes ?? [];
  const rawEdges = data.edges ?? [];
  const known = new Set(rawNodes.map((n) => n.id));

  const merged = new Map<string, GraphLink>();
  const neighbours = new Map<string, Set<string>>(rawNodes.map((n) => [n.id, new Set<string>()]));

  for (const edge of rawEdges) {
    const from = edge.fromNode;
    const to = edge.toNode;
    if (!known.has(from) || !known.has(to)) continue;

    neighbours.get(from)!.add(to);
    neighbours.get(to)!.add(from);
    if (from === to) continue; // a loop has no line to draw

    // Obsidian draws an arrowhead at the end by default, so `toEnd` is an arrow unless set to "none".
    const fromArrow = edge.fromEnd === "arrow";
    const toArrow = edge.toEnd !== "none";
    let arrow: GraphLink["arrow"] = "—";
    if (fromArrow && toArrow) arrow = "↔";
    else if (toArrow) arrow = "→";
    else if (fromArrow) arrow = "←";

    const label = typeof edge.label === "string" && edge.label.trim() ? edge.label.trim() : undefined;
    const key = pairKey(from, to);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { source: from, target: to, arrow, label });
      continue;
    }
    // The stored link may run the other way round; flip the new arrow to match before merging.
    const aligned = existing.source === from ? arrow : flip(arrow);
    existing.arrow = mergeArrows(existing.arrow, aligned);
    existing.label = existing.label ?? label;
  }

  const nodes: GraphNode[] = rawNodes.map((n) => ({
    id: n.id,
    label: nodeLabel(n as CanvasNodeData),
    type: toType(n.type),
    degree: neighbours.get(n.id)?.size ?? 0,
  }));

  return { nodes, links: [...merged.values()] };
}

/** Reverse an arrow's direction. */
function flip(arrow: GraphLink["arrow"]): GraphLink["arrow"] {
  if (arrow === "→") return "←";
  if (arrow === "←") return "→";
  return arrow;
}

/** Radius for a node, growing with its degree but levelling off so hubs stay on screen. */
export function nodeRadius(degree: number): number {
  return 5 + Math.sqrt(degree) * 3.5;
}

/** Ids directly connected to `id` (self-loops excluded, since they are not links). */
export function neighboursOf(graph: Graph, id: string): Set<string> {
  const set = new Set<string>();
  for (const link of graph.links) {
    if (link.source === id) set.add(link.target);
    else if (link.target === id) set.add(link.source);
  }
  return set;
}

/** Ids whose label contains `query` (case-insensitive). Empty query matches nothing. */
export function matchingIds(graph: Graph, query: string): Set<string> {
  const q = query.trim().toLowerCase();
  if (!q) return new Set();
  return new Set(graph.nodes.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id));
}

/** The node types present in a graph, in legend order. */
export function usedTypes(graph: Graph): GraphNodeType[] {
  const present = new Set(graph.nodes.map((n) => n.type));
  return [...KNOWN_TYPES, "other" as const].filter((t) => present.has(t));
}
