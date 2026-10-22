import { clusterCount, clusterHue } from "./cluster";
import { closenessOf, radiusOf, type GraphNode, type SemanticGraph } from "./logic";
import type { SemanticGraphLayout } from "./layout";

/**
 * SVG renderer for the graph.
 *
 * Same shape as the Smart Connections similarity map: a circle, an x/y, a label
 * and a click handler per note, nothing more. The `<svg>` is given an explicit
 * pixel size and a matching `viewBox` from JavaScript, rather than a percentage
 * of its parent, so it does not depend on the sidebar having been measured when
 * the view was built.
 *
 * Pan and zoom are one `transform` on a wrapping group, so moving the view
 * never touches the nodes themselves. Hit testing stays geometric (against the
 * layout) instead of per-element listeners, which keeps drag, click and
 * alt-click in one place in the view.
 */

export interface RenderTheme {
  background: string;
  link: string;
  linkActive: string;
  node: string;
  nodeCentre: string;
  nodeCanvas: string;
  nodeHover: string;
  label: string;
  labelStrong: string;
  stroke: string;
}

/** Read the colours from the Obsidian theme, so light and dark both work. */
export function themeFrom(el: HTMLElement): RenderTheme {
  const style = getComputedStyle(el);
  const pick = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    background: pick("--background-primary", "#ffffff"),
    link: pick("--text-faint", "#999999"),
    linkActive: pick("--interactive-accent", "#5b6ee1"),
    node: pick("--text-muted", "#888888"),
    nodeCentre: pick("--interactive-accent", "#5b6ee1"),
    nodeCanvas: pick("--color-orange", "#e08c3b"),
    nodeHover: pick("--interactive-accent-hover", pick("--interactive-accent", "#5b6ee1")),
    label: pick("--text-muted", "#888888"),
    labelStrong: pick("--text-normal", "#222222"),
    stroke: pick("--background-primary", "#ffffff"),
  };
}

/** Space kept between a label and the panel edge, in screen pixels. */
const LABEL_MARGIN = 6;

/** Label size on screen, in pixels. */
const LABEL_SIZE = 11;

/** Longest label drawn under a circle before it is cut short. */
const MAX_LABEL = 20;

function shortLabel(label: string): string {
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
}

export interface ViewTransform {
  zoom: number;
  panX: number;
  panY: number;
}

export interface RenderOptions {
  graph: SemanticGraph;
  layout: SemanticGraphLayout;
  transform: ViewTransform;
  hovered: string | null;
  showLabels: boolean;
  theme: RenderTheme;
}

interface NodeParts {
  g: SVGGElement;
  circle: SVGCircleElement;
  label: SVGTextElement;
}

export class SvgRenderer {
  readonly el: SVGSVGElement;
  private viewport: SVGGElement;
  /** Plain text pinned to the corner, outside pan and zoom, to prove the SVG is on screen. */
  private badgeEl: SVGTextElement;
  private linksEl: SVGGElement;
  private nodesEl: SVGGElement;
  private width = 0;
  private height = 0;
  /** The graph the elements below were built for; a new graph means a rebuild. */
  private builtFor: SemanticGraph | null = null;
  private lineEls: SVGLineElement[] = [];
  private nodeParts = new Map<string, NodeParts>();

  constructor(parent: HTMLElement) {
    this.el = parent.createSvg("svg", { cls: "rico-sg-svg" });
    this.viewport = this.el.createSvg("g", { cls: "rico-sg-viewport" });
    this.badgeEl = this.el.createSvg("text", { cls: "rico-sg-badge" });
    this.badgeEl.setAttribute("x", "8");
    this.badgeEl.setAttribute("y", "16");
    this.badgeEl.textContent = "graph area ready";
    this.linksEl = this.viewport.createSvg("g", { cls: "rico-sg-links" });
    this.nodesEl = this.viewport.createSvg("g", { cls: "rico-sg-nodes" });
  }

  /** A line of text in the corner of the graph area; never moves with pan or zoom. */
  setBadge(text: string): void {
    this.badgeEl.textContent = text;
  }

  /**
   * Match the SVG to the box it sits in.
   *
   * Returns false when the panel still has no size, which tells the caller
   * there is no point drawing yet.
   */
  resize(width: number, height: number): boolean {
    if (!width || !height) return false;
    this.width = width;
    this.height = height;
    this.el.setAttribute("width", String(width));
    this.el.setAttribute("height", String(height));
    this.el.setAttribute("viewBox", `0 0 ${width} ${height}`);
    return true;
  }

  /** Turn a point on screen into graph coordinates, for hit testing and drag. */
  toGraph(clientX: number, clientY: number, transform: ViewTransform): { x: number; y: number } {
    const rect = this.el.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.width / 2 - transform.panX) / transform.zoom,
      y: (clientY - rect.top - this.height / 2 - transform.panY) / transform.zoom,
    };
  }

  /** The node under a point, or null. Topmost (last drawn) wins. */
  hitTest(
    x: number,
    y: number,
    graph: SemanticGraph,
    layout: SemanticGraphLayout,
  ): GraphNode | null {
    for (let i = graph.nodes.length - 1; i >= 0; i--) {
      const node = graph.nodes[i];
      const pos = layout.get(node.path);
      if (!pos) continue;
      const r = radiusOf(node);
      const dx = x - pos.x;
      const dy = y - pos.y;
      // Compare squared distances: no square root needed.
      if (dx * dx + dy * dy <= r * r) return node;
    }
    return null;
  }

  /** Throw the old elements away and make one set per link and per node. */
  private rebuild(graph: SemanticGraph): void {
    this.linksEl.empty();
    this.nodesEl.empty();
    this.lineEls = graph.links.map(() => this.linksEl.createSvg("line"));
    this.nodeParts.clear();
    for (const node of graph.nodes) {
      const g = this.nodesEl.createSvg("g", { cls: "rico-sg-node" });
      g.setAttribute("data-path", node.path);
      const circle = g.createSvg("circle");
      const label = g.createSvg("text", { cls: "rico-sg-label" });
      label.textContent = shortLabel(node.label);
      this.nodeParts.set(node.path, { g, circle, label });
    }
    this.builtFor = graph;
  }

  draw(options: RenderOptions): void {
    if (!this.width || !this.height) return;
    const { graph, layout, transform, hovered, showLabels, theme } = options;
    if (graph !== this.builtFor) this.rebuild(graph);
    const groups = clusterCount(graph);

    // Origin at the middle of the panel, so the centre note is centred.
    this.viewport.setAttribute(
      "transform",
      `translate(${this.width / 2 + transform.panX} ${this.height / 2 + transform.panY}) scale(${transform.zoom})`,
    );

    graph.links.forEach((link, i) => {
      const line = this.lineEls[i];
      const a = layout.get(link.source);
      const b = layout.get(link.target);
      if (!line || !a || !b) return;
      const active = hovered === link.source || hovered === link.target;
      // A stronger match draws a heavier, more solid line, so the ranking
      // reads at a glance without hovering anything.
      const strength = closenessOf(link);
      line.setAttribute("x1", String(a.x));
      line.setAttribute("y1", String(a.y));
      line.setAttribute("x2", String(b.x));
      line.setAttribute("y2", String(b.y));
      line.setAttribute("stroke", active ? theme.linkActive : theme.link);
      line.setAttribute("stroke-width", String(0.5 + strength * 2));
      line.setAttribute("opacity", String(active ? 1 : 0.2 + strength * 0.5));
    });

    // Labels stay a constant size on screen however far the view is zoomed.
    const fontSize = LABEL_SIZE / transform.zoom;

    for (const node of graph.nodes) {
      const parts = this.nodeParts.get(node.path);
      const pos = layout.get(node.path);
      if (!parts || !pos) continue;
      const centre = node.hop === 0;
      const r = radiusOf(node);
      const grouped = !centre && node.cluster !== undefined && groups > 1;
      const isHovered = hovered === node.path;

      parts.g.setAttribute("transform", `translate(${pos.x} ${pos.y})`);
      parts.circle.setAttribute("r", String(r));
      parts.circle.setAttribute(
        "fill",
        centre
          ? theme.nodeCentre
          : isHovered
            ? theme.nodeHover
            : grouped
              ? `hsl(${clusterHue(node.cluster!, groups)} 55% 55%)`
              : node.kind === "canvas"
                ? theme.nodeCanvas
                : theme.node,
      );
      // The fill carries the topic, so a canvas file is told apart by its
      // outline instead of by a colour a group may already be using.
      const canvasOutline = grouped && node.kind === "canvas";
      parts.circle.setAttribute("stroke", canvasOutline ? theme.nodeCanvas : theme.stroke);
      parts.circle.setAttribute("stroke-width", String(canvasOutline ? 2.5 : 1.5));

      parts.label.setAttribute("display", showLabels ? "" : "none");
      if (!showLabels) continue;
      parts.label.setAttribute("font-size", String(fontSize));
      parts.label.setAttribute("fill", centre || isHovered ? theme.labelStrong : theme.label);
      parts.label.setAttribute("text-anchor", "middle");
      parts.label.setAttribute("dominant-baseline", "hanging");
      parts.label.setAttribute(
        "x",
        String(this.keepOnScreen(pos.x, this.textWidth(parts.label, fontSize), transform)),
      );
      parts.label.setAttribute("y", String(r + 3 / transform.zoom));
    }
  }

  /** Rendered width of a label in graph units, with a guess when the browser cannot say. */
  private textWidth(label: SVGTextElement, fontSize: number): number {
    try {
      const measured = label.getComputedTextLength();
      if (measured > 0) return measured;
    } catch {
      // Not rendered yet; fall through to the estimate.
    }
    return (label.textContent?.length ?? 0) * fontSize * 0.55;
  }

  /**
   * Nudge a label sideways so it stays inside the panel.
   *
   * Labels are centred under their circle, so one near an edge would be cut
   * in half. `nodeX` is where the node sits in graph units; the result is the
   * label's x relative to the node, which is what the element needs.
   */
  private keepOnScreen(nodeX: number, labelWidth: number, transform: ViewTransform): number {
    const half = labelWidth / 2;
    const min = (LABEL_MARGIN - this.width / 2 - transform.panX) / transform.zoom + half;
    const max =
      (this.width - LABEL_MARGIN - this.width / 2 - transform.panX) / transform.zoom - half;
    // A label wider than the panel cannot fit; leave it centred rather than flip-flopping.
    if (min > max) return 0;
    return Math.min(max, Math.max(min, nodeX)) - nodeX;
  }
}
