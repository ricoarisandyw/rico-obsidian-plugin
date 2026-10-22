import type { SearchResult } from "../semantic-search/search";
import type { ScoreBreakdown } from "../semantic-search/scoring";

/**
 * Turning ranked search results into a graph.
 *
 * No Obsidian imports, so it can be tested without a vault. The view owns
 * everything that touches the workspace; this file only does arithmetic.
 *
 * The whole idea: `search()` gives a similarity (1 = identical, 0 = unrelated),
 * but a force layout wants a *distance*. Both the link length and the circle
 * size come from that one number, so a strong match reads as close and big —
 * two signals pointing the same way rather than two things to reconcile.
 */

export interface GraphNode {
  /** Vault path; also the layout id. */
  path: string;
  label: string;
  /** 0 for the centre note, 1 for its neighbours, 2 for a neighbour's neighbours. */
  hop: number;
  /** Combined weighted score against the note it was ranked from. 1 for the centre. */
  score: number;
  kind?: "md" | "canvas";
  /** Per-scorer detail, shown in the tooltip. Absent for the centre. */
  breakdown?: ScoreBreakdown;
  /**
   * What distance and size are drawn from. Equals `score` unless the graph was
   * built with `spread`, in which case it is the score stretched across its
   * neighbours' range. The tooltip still shows the real `score`.
   */
  closeness?: number;
  /** Topic group among the neighbours, or absent when clustering is off. */
  cluster?: number;
}

export interface GraphLink {
  source: string;
  target: string;
  /** The score that produced this link, kept so the layout can space it. */
  score: number;
  /** Stretched version of `score` that actually sets the length; see GraphNode. */
  closeness?: number;
}

export interface SemanticGraph {
  /** Path of the note at the middle. */
  centre: string;
  nodes: GraphNode[];
  links: GraphLink[];
}

/** Shortest a link is ever drawn, for a perfect match. */
const MIN_DISTANCE = 60;
/** Longest a link is ever drawn, for a match at the cutoff. */
const MAX_DISTANCE = 260;
/**
 * How sharply distance falls off as score rises.
 *
 * Real scores bunch up in the middle of the range, so a straight line would
 * leave most notes at a similar distance and waste the panel. Raising the gap
 * to a power below 1 spreads that middle out, which is where the interesting
 * comparisons actually live.
 */
const DISTANCE_CURVE = 0.65;

const MIN_RADIUS = 5;
const MAX_RADIUS = 16;
/** The centre note is drawn larger than any neighbour can be. */
export const CENTRE_RADIUS = 20;

/** Clamp to 0-1, treating rubbish input as 0 rather than letting NaN spread. */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Distance for a link of the given score.
 *
 * Score 1 sits at MIN_DISTANCE, score 0 at MAX_DISTANCE, with the curve
 * spreading out the middle.
 */
export function linkDistance(score: number): number {
  const gap = 1 - clamp01(score);
  return MIN_DISTANCE + (MAX_DISTANCE - MIN_DISTANCE) * Math.pow(gap, DISTANCE_CURVE);
}

/** Circle radius for a neighbour. Grows with score, always within bounds. */
export function nodeRadius(score: number): number {
  return MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * clamp01(score);
}

/** The value distance and size are drawn from: the stretched one if there is one. */
export function closenessOf(item: { score: number; closeness?: number }): number {
  return item.closeness ?? item.score;
}

/** Circle radius for any node, so layout, hit testing and drawing all agree. */
export function radiusOf(node: GraphNode): number {
  return node.hop === 0 ? CENTRE_RADIUS : nodeRadius(closenessOf(node));
}

/**
 * Stretch a set of scores across 0-1, lowest to highest.
 *
 * Real scores sit in a narrow band (say 0.55-0.7), so drawn straight they all
 * land at nearly the same distance. Rescaling to the band that is actually
 * present uses the whole panel, which is what the Smart Connections map does.
 * With fewer than two scores, or no spread to speak of, there is nothing to
 * stretch, so the scores come back unchanged.
 */
export function spreadScores(scores: number[]): number[] {
  const clean = scores.map(clamp01);
  if (clean.length < 2) return clean;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  if (max - min < 1e-6) return clean;
  return clean.map((score) => (score - min) / (max - min));
}

/** Filename without the folder or extension, which is what people recognise. */
export function labelFor(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

export interface BuildOptions {
  /** Most neighbours kept per hop. */
  limit?: number;
  /** Drop anything scoring at or below this. */
  minScore?: number;
  /** Draw distance and size from the scores stretched across their own range. */
  spread?: boolean;
}

/**
 * Centre note plus its nearest neighbours, one hop.
 *
 * Results are assumed already sorted by score, which `search()` guarantees.
 * The centre is excluded from its own neighbours even if it somehow appears.
 */
export function buildGraph(
  centre: string,
  results: SearchResult[],
  options: BuildOptions = {},
): SemanticGraph {
  const graph: SemanticGraph = {
    centre,
    nodes: [{ path: centre, label: labelFor(centre), hop: 0, score: 1 }],
    links: [],
  };
  return expandGraph(graph, centre, results, options);
}

/**
 * Merge one note's neighbours into an existing graph.
 *
 * Used both for the first build and for expanding a node the user alt-clicked.
 * A note already present keeps its best score and lowest hop rather than being
 * added twice, and a pair already linked is not linked again — otherwise
 * expanding the same region twice would pile up duplicates and drag the layout
 * towards whichever note happened to be expanded most.
 */
export function expandGraph(
  graph: SemanticGraph,
  from: string,
  results: SearchResult[],
  options: BuildOptions = {},
): SemanticGraph {
  const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : 12;
  const minScore = options.minScore ?? 0;

  // Copies, so merging a better score never edits the graph the caller still holds.
  const nodes = graph.nodes.map((node) => ({ ...node }));
  const byPath = new Map(nodes.map((node) => [node.path, node]));
  const linked = new Set(graph.links.map((link) => pairKey(link.source, link.target)));
  const parent = byPath.get(from);
  // Expanding a node that is not in the graph would strand its neighbours.
  if (!parent) return graph;

  const links = [...graph.links];

  // Decide who is kept first: the stretch needs to see exactly the notes that
  // will be drawn, not the ones the limit cut.
  const accepted: { result: SearchResult; score: number }[] = [];
  for (const result of results) {
    if (accepted.length >= limit) break;
    if (result.path === from || result.path === graph.centre) continue;
    const score = clamp01(result.score);
    if (score <= minScore) continue;
    accepted.push({ result, score });
  }
  const closeness = options.spread
    ? spreadScores(accepted.map((a) => a.score))
    : accepted.map((a) => a.score);

  accepted.forEach(({ result, score }, i) => {
    const near = closeness[i];
    const existing = byPath.get(result.path);
    if (existing) {
      // Reached another way: keep whichever view of it is stronger and nearer.
      if (score > existing.score) {
        existing.score = score;
        existing.breakdown = result.breakdown;
      }
      existing.closeness = Math.max(existing.closeness ?? existing.score, near);
      existing.hop = Math.min(existing.hop, parent.hop + 1);
    } else {
      const node: GraphNode = {
        path: result.path,
        label: labelFor(result.path),
        hop: parent.hop + 1,
        score,
        closeness: near,
        kind: result.kind,
        breakdown: result.breakdown,
      };
      nodes.push(node);
      byPath.set(node.path, node);
    }

    const key = pairKey(from, result.path);
    if (!linked.has(key)) {
      linked.add(key);
      links.push({ source: from, target: result.path, score, closeness: near });
    }
  });

  return { centre: graph.centre, nodes, links };
}

/** Order-independent key, so A-B and B-A count as the same link. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/** Paths already in the graph, so the view can skip re-expanding one. */
export function hasNode(graph: SemanticGraph, path: string): boolean {
  return graph.nodes.some((node) => node.path === path);
}

/** True when this node sits at the deepest hop allowed, so it cannot expand. */
export function atHopLimit(graph: SemanticGraph, path: string, maxHops: number): boolean {
  const node = graph.nodes.find((n) => n.path === path);
  return !node || node.hop >= maxHops;
}

/** An empty graph, used before a note is picked or when nothing is indexed. */
export function emptyGraph(): SemanticGraph {
  return { centre: "", nodes: [], links: [] };
}
