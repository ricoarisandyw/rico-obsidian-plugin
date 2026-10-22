import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from "d3-force";
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import type { ClusterMap } from "./cluster-all";

/**
 * Two-level layout: groups first, then the notes inside each group.
 *
 * The notes inside a group do not need physics, they need packing. A
 * sunflower spiral fills a disc evenly, and since members arrive nearest the
 * centre first, the most typical notes end up in the middle of their blob. Only
 * the groups themselves are simulated: each is a circle sized by its note
 * count, pushed away from the others and pulled towards the groups it links to.
 *
 * The layout is computed once and never ticks again, so panning and zooming
 * only ever move one transform and stay smooth with thousands of dots.
 *
 * No Obsidian imports, so it can be tested without a vault.
 */

export interface Point {
  x: number;
  y: number;
}

export interface PlacedCluster {
  id: number;
  x: number;
  y: number;
  /** Radius of the disc its notes occupy. */
  r: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ClusterLayout {
  clusters: PlacedCluster[];
  /** Position of every note, in the same coordinates as the clusters. */
  dots: Map<string, Point>;
  bounds: Bounds;
}

/** Radius of one note's dot. */
export const DOT_RADIUS = 3.2;
/** Distance between neighbouring dots in a spiral. */
const DOT_SPACING = 9;
/** Empty ring left between blobs, so they read as separate. */
const GAP = 46;
/** How much further apart two groups sit for each step down in similarity. */
const LINK_SLACK = 220;
/** Ticks run to settle the groups. */
const SETTLE_TICKS = 400;
/** Pull towards the middle, so unlinked groups stay on screen. */
const GRAVITY = 0.035;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Radius of the disc a group of `count` notes needs. */
export function clusterRadius(count: number): number {
  return DOT_SPACING * Math.sqrt(Math.max(1, count)) * 0.62 + DOT_RADIUS * 2;
}

/** Positions of `count` dots in a sunflower spiral around the origin. */
export function spiral(count: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < count; i++) {
    const radius = DOT_SPACING * 0.62 * Math.sqrt(i + 0.5);
    const angle = i * GOLDEN_ANGLE;
    out.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
  }
  return out;
}

interface SimNode extends SimulationNodeDatum {
  id: number;
  r: number;
  x: number;
  y: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  strength: number;
}

export function layoutClusters(map: ClusterMap): ClusterLayout {
  const nodes: SimNode[] = map.clusters.map((cluster) => ({
    id: cluster.id,
    r: clusterRadius(cluster.members.length),
    // Biggest first on a spiral of their own: a deterministic start that
    // already has the large groups near the middle.
    x: Number.NaN,
    y: Number.NaN,
  }));

  const index = new Map(nodes.map((node) => [node.id, node]));
  const links: SimLink[] = map.links
    .filter((l) => l.a !== l.b && index.has(l.a) && index.has(l.b))
    .map((l) => ({ source: l.a, target: l.b, strength: l.strength }));

  const sim = forceSimulation(nodes)
    .force("charge", forceManyBody<SimNode>().strength(-60))
    .force(
      "link",
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .strength(0.25)
        // The more alike two groups are, the closer their edges sit.
        .distance(
          (l) =>
            (l.source as SimNode).r +
            (l.target as SimNode).r +
            GAP +
            (1 - Math.min(1, Math.max(0, l.strength))) * LINK_SLACK,
        ),
    )
    .force("collide", forceCollide<SimNode>().radius((d) => d.r + GAP / 2).iterations(3))
    .force("x", forceX(0).strength(GRAVITY))
    .force("y", forceY(0).strength(GRAVITY))
    .stop();
  sim.tick(SETTLE_TICKS);

  // A stray NaN must not take the whole picture down.
  for (const node of nodes) {
    if (!Number.isFinite(node.x)) node.x = 0;
    if (!Number.isFinite(node.y)) node.y = 0;
  }

  const clusters: PlacedCluster[] = nodes.map((node) => ({
    id: node.id,
    x: node.x,
    y: node.y,
    r: node.r,
  }));

  const dots = new Map<string, Point>();
  for (const cluster of map.clusters) {
    const centre = index.get(cluster.id)!;
    const spots = spiral(cluster.members.length);
    cluster.members.forEach((path, i) => {
      dots.set(path, { x: centre.x + spots[i].x, y: centre.y + spots[i].y });
    });
  }

  return { clusters, dots, bounds: boundsOf(clusters) };
}

function boundsOf(clusters: PlacedCluster[]): Bounds {
  if (!clusters.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of clusters) {
    minX = Math.min(minX, c.x - c.r);
    minY = Math.min(minY, c.y - c.r);
    maxX = Math.max(maxX, c.x + c.r);
    maxY = Math.max(maxY, c.y + c.r);
  }
  return { minX, minY, maxX, maxY };
}
