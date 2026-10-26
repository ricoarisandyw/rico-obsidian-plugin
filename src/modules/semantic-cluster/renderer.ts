import { clusterHue } from "../semantic-graph/cluster";
import { labelFor } from "../semantic-graph/logic";
import type { ClusterMap } from "./cluster-all";
import { blobPath } from "./hull";
import { DOT_RADIUS, type ClusterLayout, type Point } from "./layout";

/**
 * SVG drawing for the cluster map.
 *
 * One group per cluster, holding its blob, its dots and its name. The layout
 * never changes after it is built, so a pan or a zoom is a single transform on
 * the wrapping group and nothing else is touched, which keeps it smooth with
 * thousands of dots. Hit testing is geometric, against the layout, so the view
 * keeps one set of mouse handlers instead of one per dot.
 */

export interface ViewTransform {
  zoom: number;
  panX: number;
  panY: number;
}

/** Longest group name drawn on the map before it is cut short. */
const MAX_LABEL = 32;
/** Label size on screen, in pixels, however far the view is zoomed. */
const LABEL_SIZE = 12;
/** Below this zoom the names crowd each other, so they are hidden. */
const LABEL_MIN_ZOOM = 0.3;
/** Note titles beside the dots appear only this close, or they would overlap. */
const DOT_LABEL_MIN_ZOOM = 2.2;
/** Size of a note title on screen, in pixels. */
const DOT_LABEL_SIZE = 11;
/** Width of the soft rim around a blob, in graph units. */
const BLOB_PAD = 22;
/** How far outside its disc a group still counts as under the pointer. */
const CLUSTER_HIT_SLACK = 14;

function shortLabel(label: string): string {
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
}

interface ClusterParts {
  g: SVGGElement;
  label: SVGTextElement;
}

export class ClusterRenderer {
  readonly el: SVGSVGElement;
  private viewport: SVGGElement;
  private linksEl: SVGGElement;
  private clustersEl: SVGGElement;
  /** Plain text pinned to the corner, outside pan and zoom, to prove the SVG is on screen. */
  private badgeEl: SVGTextElement;
  private width = 0;
  private height = 0;

  private layout: ClusterLayout | null = null;
  private members = new Map<number, string[]>();
  private parts = new Map<number, ClusterParts>();
  private dotEls = new Map<string, SVGCircleElement>();
  private hotDot: string | null = null;
  private hotCluster: number | null = null;
  /** Note titles, present only when the level asked for them. */
  private dotLabels: SVGTextElement[] = [];
  /** What the labels were last set up for, so a pan does not redo them all. */
  private lastZoom = 0;
  private lastLabelsOn: boolean | null = null;

  constructor(parent: HTMLElement) {
    this.el = parent.createSvg("svg", { cls: "rico-sc-svg" });
    this.viewport = this.el.createSvg("g", { cls: "rico-sc-viewport" });
    this.linksEl = this.viewport.createSvg("g", { cls: "rico-sc-links" });
    this.clustersEl = this.viewport.createSvg("g", { cls: "rico-sc-clusters" });
    this.badgeEl = this.el.createSvg("text", { cls: "rico-sc-badge" });
    this.badgeEl.setAttribute("x", "10");
    this.badgeEl.setAttribute("y", "18");
    this.badgeEl.textContent = "cluster area ready";
  }

  setBadge(text: string): void {
    this.badgeEl.textContent = text;
  }

  /** Match the SVG to its box. False while the panel still has no size. */
  resize(width: number, height: number): boolean {
    if (!width || !height) return false;
    this.width = width;
    this.height = height;
    this.el.setAttribute("width", String(width));
    this.el.setAttribute("height", String(height));
    this.el.setAttribute("viewBox", `0 0 ${width} ${height}`);
    return true;
  }

  /** Turn a point on screen into graph coordinates. */
  toGraph(clientX: number, clientY: number, t: ViewTransform): Point {
    const rect = this.el.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.width / 2 - t.panX) / t.zoom,
      y: (clientY - rect.top - this.height / 2 - t.panY) / t.zoom,
    };
  }

  /** Throw the old drawing away and make one group per cluster. */
  build(map: ClusterMap, layout: ClusterLayout, options: { dotLabels?: boolean } = {}): void {
    this.linksEl.empty();
    this.clustersEl.empty();
    this.parts.clear();
    this.dotEls.clear();
    this.members.clear();
    this.hotDot = null;
    this.hotCluster = null;
    this.dotLabels = [];
    this.lastZoom = 0;
    this.lastLabelsOn = null;
    this.layout = layout;

    const count = map.clusters.length;
    const placed = new Map(layout.clusters.map((c) => [c.id, c]));

    for (const link of map.links) {
      const a = placed.get(link.a);
      const b = placed.get(link.b);
      if (!a || !b) continue;
      const line = this.linksEl.createSvg("line", { cls: "rico-sc-link" });
      line.setAttribute("x1", String(a.x));
      line.setAttribute("y1", String(a.y));
      line.setAttribute("x2", String(b.x));
      line.setAttribute("y2", String(b.y));
      // Alike groups draw a heavier, clearer line; this reads without hovering.
      line.setAttribute("stroke-width", String(0.6 + link.strength * 2));
      line.setAttribute("opacity", String(0.15 + link.strength * 0.5));
    }

    for (const cluster of map.clusters) {
      const centre = placed.get(cluster.id);
      if (!centre) continue;
      this.members.set(cluster.id, cluster.members);
      const hue = clusterHue(cluster.id, count);
      const colour = `hsl(${hue} 60% 58%)`;
      // The note a group is named after gets a rim of the same hue, darker.
      const rim = `hsl(${hue} 65% 28%)`;
      const g = this.clustersEl.createSvg("g", { cls: "rico-sc-cluster" });
      g.setAttribute("data-cluster", String(cluster.id));

      const points = cluster.members.map((path) => layout.dots.get(path)).filter((p): p is Point => !!p);

      // Fill and stroke are the same solid colour and the group carries the
      // opacity, so the rim and the middle composite as one even wash.
      const blob = g.createSvg("g", { cls: "rico-sc-blob" });
      const path = blob.createSvg("path");
      path.setAttribute("d", blobPath(points));
      path.setAttribute("fill", colour);
      path.setAttribute("stroke", colour);
      path.setAttribute("stroke-width", String(BLOB_PAD));
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("stroke-linecap", "round");

      for (const point of cluster.members) {
        const spot = layout.dots.get(point);
        if (!spot) continue;
        const dot = g.createSvg("circle", { cls: "rico-sc-dot" });
        dot.setAttribute("cx", String(spot.x));
        dot.setAttribute("cy", String(spot.y));
        dot.setAttribute("r", String(DOT_RADIUS));
        dot.setAttribute("fill", colour);
        if (point === cluster.namePath) {
          dot.addClass("is-name");
          dot.setAttribute("stroke", rim);
          dot.setAttribute("stroke-width", String(DOT_RADIUS * 0.45));
        }
        this.dotEls.set(point, dot);

        if (options.dotLabels) {
          const title = g.createSvg("text", { cls: "rico-sc-dot-label" });
          title.textContent = labelFor(point);
          title.setAttribute("x", String(spot.x + DOT_RADIUS + 3));
          title.setAttribute("y", String(spot.y));
          title.setAttribute("dominant-baseline", "middle");
          title.setAttribute("display", "none");
          this.dotLabels.push(title);
        }
      }

      const label = g.createSvg("text", { cls: "rico-sc-label" });
      label.textContent = shortLabel(cluster.name);
      label.setAttribute("x", String(centre.x));
      label.setAttribute("y", String(centre.y - centre.r - BLOB_PAD / 2 - 4));
      label.setAttribute("text-anchor", "middle");
      this.parts.set(cluster.id, { g, label });
    }
  }

  /** Apply pan and zoom, and decide whether names are legible enough to show. */
  setTransform(t: ViewTransform, showLabels: boolean): void {
    if (!this.width || !this.height) return;
    this.viewport.setAttribute(
      "transform",
      `translate(${this.width / 2 + t.panX} ${this.height / 2 + t.panY}) scale(${t.zoom})`,
    );
    // Labels depend on the zoom, not the pan, so a drag skips all of this.
    if (t.zoom === this.lastZoom && showLabels === this.lastLabelsOn) return;
    this.lastZoom = t.zoom;
    this.lastLabelsOn = showLabels;

    const visible = showLabels && t.zoom >= LABEL_MIN_ZOOM;
    const size = String(LABEL_SIZE / t.zoom);
    for (const { label } of this.parts.values()) {
      label.setAttribute("font-size", size);
      label.setAttribute("display", visible ? "" : "none");
    }

    const titlesOn = showLabels && t.zoom >= DOT_LABEL_MIN_ZOOM;
    const titleSize = String(DOT_LABEL_SIZE / t.zoom);
    for (const title of this.dotLabels) {
      title.setAttribute("font-size", titleSize);
      title.setAttribute("display", titlesOn ? "" : "none");
    }
  }

  /** Highlight a group and, within it, one dot. Either may be null. */
  setHover(cluster: number | null, dot: string | null): void {
    if (cluster !== this.hotCluster) {
      if (this.hotCluster !== null) this.parts.get(this.hotCluster)?.g.removeClass("is-hovered");
      if (cluster !== null) this.parts.get(cluster)?.g.addClass("is-hovered");
      this.el.toggleClass("has-hover", cluster !== null);
      this.hotCluster = cluster;
    }
    if (dot !== this.hotDot) {
      if (this.hotDot) this.dotEls.get(this.hotDot)?.setAttribute("r", String(DOT_RADIUS));
      if (dot) this.dotEls.get(dot)?.setAttribute("r", String(DOT_RADIUS * 2));
      this.hotDot = dot;
    }
  }

  /** The cluster whose disc contains the point, nearest first. */
  hitCluster(x: number, y: number): number | null {
    if (!this.layout) return null;
    let best: number | null = null;
    let bestGap = Infinity;
    for (const c of this.layout.clusters) {
      const gap = Math.hypot(x - c.x, y - c.y) - c.r;
      if (gap <= CLUSTER_HIT_SLACK && gap < bestGap) {
        best = c.id;
        bestGap = gap;
      }
    }
    return best;
  }

  /** The dot under the point, searching only inside the group the point is in. */
  hitDot(x: number, y: number, zoom: number): string | null {
    if (!this.layout) return null;
    const reach = Math.max(DOT_RADIUS * 1.6, 6 / zoom);
    const cluster = this.hitCluster(x, y);
    if (cluster === null) return null;
    let best: string | null = null;
    let bestGap = Infinity;
    for (const path of this.members.get(cluster) ?? []) {
      const spot = this.layout.dots.get(path);
      if (!spot) continue;
      const gap = Math.hypot(x - spot.x, y - spot.y);
      if (gap <= reach && gap < bestGap) {
        best = path;
        bestGap = gap;
      }
    }
    return best;
  }
}
