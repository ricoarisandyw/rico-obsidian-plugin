import {
  Simulation,
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from "d3-force";
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import { clusterCount } from "./cluster";
import { closenessOf, linkDistance, radiusOf, type SemanticGraph } from "./logic";

/**
 * Force-directed layout for the semantic graph.
 *
 * Close cousin of the canvas network graph's layout, but the link force takes
 * its distance from each link's own score rather than a fixed gap. That is the
 * whole point of the view: move the scoring sliders and the constellation
 * visibly rearranges, because every link length is a function of the weighted
 * score.
 *
 * As there, we drive the simulation by hand (`stop()` then explicit `tick()`)
 * so the view decides when to paint and can settle the layout before the first
 * frame.
 */

export interface Point {
  x: number;
  y: number;
}

export interface LayoutNode extends SimulationNodeDatum {
  id: string;
  /** Radius, cached so collision and link length do not recompute it per tick. */
  r: number;
  /** Topic group, or -1 for the centre and for notes with no group. */
  cluster: number;
  x: number;
  y: number;
}

interface LayoutLink extends SimulationLinkDatum<LayoutNode> {
  /** Carried from the graph so the link force can space by score. */
  closeness: number;
}

export interface LayoutOptions {
  /** How hard a topic group is pulled to its own side. 0 turns grouping off. */
  clusterStrength?: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** How hard nodes push each other apart. */
const CHARGE = -240;
/** Beyond this, repulsion is ignored — keeps bigger graphs cheap. */
const CHARGE_RANGE = 460;
/** Pull towards the origin, so weakly linked nodes stay on screen. */
const GRAVITY = 0.05;
/** Default pull of a topic group towards its side of the picture. */
const CLUSTER_STRENGTH = 0.25;
/** Stops a node sitting on the origin from having no direction to be pulled in. */
const MIN_RING = 1;
/** Ticks run before the first paint, enough for a readable layout. */
export const SETTLE_TICKS = 300;

export class SemanticGraphLayout {
  readonly nodes: LayoutNode[];
  private index = new Map<string, LayoutNode>();
  private sim: Simulation<LayoutNode, LayoutLink>;

  constructor(
    graph: SemanticGraph,
    previous?: Map<string, Point>,
    options: LayoutOptions = {},
  ) {
    // Seed from the previous layout where the node still exists, so re-centring
    // nudges the picture instead of throwing it away and starting over.
    this.nodes = graph.nodes.map((node) => {
      const prior = previous?.get(node.path);
      return {
        id: node.path,
        r: radiusOf(node),
        cluster: node.hop === 0 ? -1 : (node.cluster ?? -1),
        x: prior?.x ?? Number.NaN,
        y: prior?.y ?? Number.NaN,
      } as LayoutNode;
    });
    for (const node of this.nodes) this.index.set(node.id, node);

    // The centre note anchors the layout: without this the whole constellation
    // drifts and "distance from the note you are reading" stops being readable.
    const centre = this.index.get(graph.centre);
    if (centre) {
      centre.fx = 0;
      centre.fy = 0;
      centre.x = 0;
      centre.y = 0;
    }

    // d3 mutates link objects into node references, so hand it copies.
    const links: LayoutLink[] = graph.links
      .filter((l) => l.source !== l.target && this.index.has(l.source) && this.index.has(l.target))
      .map((l) => ({ source: l.source, target: l.target, closeness: closenessOf(l) }));

    const strength = options.clusterStrength ?? CLUSTER_STRENGTH;
    const groups = clusterCount(graph);

    this.sim = forceSimulation(this.nodes)
      .force("charge", forceManyBody<LayoutNode>().strength(CHARGE).distanceMax(CHARGE_RANGE))
      .force(
        "link",
        forceLink<LayoutNode, LayoutLink>(links)
          .id((d) => d.id)
          // The closeness decides the gap; the two radii keep circles from overlapping.
          .distance(
            (l) =>
              linkDistance(l.closeness) + (l.source as LayoutNode).r + (l.target as LayoutNode).r,
          ),
      )
      .force("collide", forceCollide<LayoutNode>().radius((d) => d.r + 6))
      .force("center", forceCenter(0, 0))
      .force("x", forceX(0).strength(GRAVITY))
      .force("y", forceY(0).strength(GRAVITY))
      .stop(); // we tick it ourselves

    // Only worth adding with at least two groups to pull apart.
    if (strength > 0 && groups > 1) {
      this.sim.force("cluster", clusterForce(this.nodes, groups, strength));
    }
  }

  get(id: string): LayoutNode | undefined {
    return this.index.get(id);
  }

  /** Current positions, to carry over when the graph is rebuilt. */
  positions(): Map<string, Point> {
    return new Map(this.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  }

  /** Run `count` ticks in one go. */
  settle(count = SETTLE_TICKS): void {
    this.sim.tick(count);
    this.guard();
  }

  /** Advance the layout by one step. */
  tick(): void {
    this.sim.tick();
    this.guard();
  }

  /**
   * Warm the simulation back up after an edit or a drag. d3's alpha decays to
   * zero as it ticks, so without this the layout goes cold and stops moving.
   */
  reheat(alpha = 0.5): void {
    this.sim.alpha(alpha);
  }

  /** Hold a node at a fixed point (used while dragging). */
  pin(id: string, x: number, y: number): void {
    const node = this.index.get(id);
    if (!node) return;
    node.fx = x;
    node.fy = y;
    node.x = x;
    node.y = y;
  }

  /** Release one node, letting the forces move it again. */
  unpin(id: string): void {
    const node = this.index.get(id);
    if (!node) return;
    node.fx = null;
    node.fy = null;
  }

  /** Box containing every node, for fitting the graph to the panel. */
  bounds(): Bounds {
    if (!this.nodes.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of this.nodes) {
      minX = Math.min(minX, node.x - node.r);
      minY = Math.min(minY, node.y - node.r);
      maxX = Math.max(maxX, node.x + node.r);
      maxY = Math.max(maxY, node.y + node.r);
    }
    return { minX, minY, maxX, maxY };
  }

  /** Stop d3's internal timer. Safe to call more than once. */
  destroy(): void {
    this.sim.stop();
  }

  /** Guard against a stray NaN taking the whole layout down with it. */
  private guard(): void {
    for (const node of this.nodes) {
      if (!Number.isFinite(node.x)) node.x = 0;
      if (!Number.isFinite(node.y)) node.y = 0;
    }
  }
}

/**
 * Pull each topic group towards its own side of the centre.
 *
 * The target keeps a node's current distance from the centre and only changes
 * its angle, so the pull never fights the score-driven link length: distance
 * still means "how related to this note", and direction now means "which topic".
 */
function clusterForce(
  nodes: LayoutNode[],
  groups: number,
  strength: number,
): (alpha: number) => void {
  return (alpha) => {
    for (const node of nodes) {
      if (node.cluster < 0 || node.fx != null) continue;
      const angle = -Math.PI / 2 + (2 * Math.PI * node.cluster) / groups;
      const ring = Math.max(Math.hypot(node.x, node.y), MIN_RING);
      node.vx = (node.vx ?? 0) + (Math.cos(angle) * ring - node.x) * strength * alpha;
      node.vy = (node.vy ?? 0) + (Math.sin(angle) * ring - node.y) * strength * alpha;
    }
  };
}
