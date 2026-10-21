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
import type { Graph } from "./logic";
import { nodeRadius } from "./logic";

export interface Point {
  x: number;
  y: number;
}

/** A node as d3 sees it, plus the bits we need to draw and pin it. */
export interface LayoutNode extends SimulationNodeDatum {
  id: string;
  /** Radius, cached so collision and link length do not recompute it every tick. */
  r: number;
  x: number;
  y: number;
}

type LayoutLink = SimulationLinkDatum<LayoutNode>;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** How hard nodes push each other apart. */
const CHARGE = -280;
/** Beyond this, repulsion is ignored — keeps big graphs cheap. */
const CHARGE_RANGE = 420;
/** Gap a link tries to keep between the two circles' edges. */
const LINK_GAP = 70;
/** Pull towards the origin, so disconnected nodes stay nearby instead of drifting off. */
const GRAVITY = 0.045;
/** Ticks run before the first paint, enough for a readable layout. */
export const SETTLE_TICKS = 300;

/**
 * Force-directed layout for the graph, built on d3-force.
 *
 * We drive the simulation by hand (`stop()` then explicit `tick()` calls) rather
 * than letting d3 run its own timer, so the view decides when to paint and the
 * layout can be settled synchronously before the first frame.
 *
 * Positions from `previous` are reused where the id still exists, so a canvas
 * edit nudges the layout instead of rebuilding it from scratch.
 */
export class GraphLayout {
  readonly nodes: LayoutNode[];
  private index = new Map<string, LayoutNode>();
  private sim: Simulation<LayoutNode, LayoutLink>;

  constructor(graph: Graph, previous?: Map<string, Point>) {
    // Seed from the previous layout where we can; d3 places the rest on a phyllotaxis spiral.
    this.nodes = graph.nodes.map((node) => {
      const prior = previous?.get(node.id);
      return {
        id: node.id,
        r: nodeRadius(node.degree),
        x: prior?.x ?? Number.NaN,
        y: prior?.y ?? Number.NaN,
      } as LayoutNode;
    });
    for (const node of this.nodes) this.index.set(node.id, node);

    // d3 mutates link objects into node references, so hand it copies, not our graph's links.
    const links: LayoutLink[] = graph.links
      .filter((l) => l.source !== l.target && this.index.has(l.source) && this.index.has(l.target))
      .map((l) => ({ source: l.source, target: l.target }));

    this.sim = forceSimulation(this.nodes)
      .force("charge", forceManyBody<LayoutNode>().strength(CHARGE).distanceMax(CHARGE_RANGE))
      .force(
        "link",
        forceLink<LayoutNode, LayoutLink>(links)
          .id((d) => d.id)
          .distance((l) => LINK_GAP + (l.source as LayoutNode).r + (l.target as LayoutNode).r),
      )
      .force("collide", forceCollide<LayoutNode>().radius((d) => d.r + 4))
      .force("center", forceCenter(0, 0))
      .force("x", forceX(0).strength(GRAVITY))
      .force("y", forceY(0).strength(GRAVITY))
      .stop(); // we tick it ourselves
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
   * Warm the simulation back up so it keeps moving after an edit or a drag.
   * d3's alpha decays towards zero as it ticks, so without this the layout
   * goes cold and stops responding. We only raise alpha — d3's own timer stays
   * stopped, because the view drives every tick itself.
   */
  reheat(alpha = 0.4): void {
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

  /** Release every pinned node. */
  unpinAll(): void {
    for (const node of this.nodes) {
      node.fx = null;
      node.fy = null;
    }
  }

  /** Stop d3's internal timer. Safe to call more than once. */
  destroy(): void {
    this.sim.stop();
  }

  /** Guard against a stray NaN taking the whole layout down with it. */
  private guard(): void {
    for (const node of this.nodes) {
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
        node.x = 0;
        node.y = 0;
        node.vx = 0;
        node.vy = 0;
      }
    }
  }

  /** Box containing every node plus its radius. Falls back to a unit box when empty. */
  bounds(): Bounds {
    if (this.nodes.length === 0) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of this.nodes) {
      minX = Math.min(minX, n.x - n.r);
      minY = Math.min(minY, n.y - n.r);
      maxX = Math.max(maxX, n.x + n.r);
      maxY = Math.max(maxY, n.y + n.r);
    }
    return { minX, minY, maxX, maxY };
  }
}
