import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import { canvasPath, dataSignature, focusCanvasNode, readCanvasData } from "../outline/data";
import type { CanvasLeafTracker } from "../outline/view";
import {
  Graph,
  GraphNode,
  TYPE_NAMES,
  buildGraph,
  matchingIds,
  neighboursOf,
  nodeRadius,
  usedTypes,
} from "./logic";
import { GraphLayout, Point, SETTLE_TICKS } from "./layout";

export const CANVAS_NETWORK_GRAPH_VIEW_TYPE = "rico-canvas-network-graph";

const SVG_NS = "http://www.w3.org/2000/svg";
/** Canvas has no change event, so look again on this interval; unchanged data is skipped. */
const POLL_MS = 1000;
/** Ticks run per animation frame after the graph is on screen, so edits settle visibly. */
const LIVE_TICKS = 40;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;
/** Empty space kept around the graph when fitting it to the panel. */
const FIT_PADDING = 24;
/** Longest label drawn under a circle before it is cut short. */
const MAX_LABEL = 22;

/** Label shown under a circle — long names are cut so they do not overlap. */
function shortLabel(label: string): string {
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
}

/**
 * Read-only force-directed graph of the open canvas.
 * Nothing here writes to the canvas; clicking only moves the canvas viewport.
 */
export class CanvasNetworkGraphView extends ItemView {
  private metaEl!: HTMLElement;
  private legendEl!: HTMLElement;
  private stageEl!: HTMLElement;
  private svg!: SVGSVGElement;
  private viewport!: SVGGElement;
  private linkLayer!: SVGGElement;
  private nodeLayer!: SVGGElement;
  private tooltipEl!: HTMLElement;
  private emptyEl!: HTMLElement;

  private graph: Graph = { nodes: [], links: [] };
  private layout: GraphLayout | null = null;
  private nodeById = new Map<string, GraphNode>();
  /** Positions carried over when the canvas changes, so the layout only nudges. */
  private lastPositions = new Map<string, Point>();

  private signature = "";
  private path = "";
  private canvasLeaf: WorkspaceLeaf | null = null;
  private refreshId = 0;

  private query = "";
  private hovered: string | null = null;
  private frame: number | null = null;
  /** Ticks still owed to the simulation; the frame loop stops when it hits zero. */
  private pending = 0;

  private zoom = 1;
  private panX = 0;
  private panY = 0;
  /** Set while the user drags the background or a node, so the two never fight. */
  private drag:
    | { kind: "pan"; startX: number; startY: number; panX: number; panY: number }
    | { kind: "node"; id: string; moved: boolean }
    | null = null;

  constructor(leaf: WorkspaceLeaf, private tracker: CanvasLeafTracker) {
    super(leaf);
  }

  getViewType(): string {
    return CANVAS_NETWORK_GRAPH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Canvas network graph";
  }

  getIcon(): string {
    return "git-fork";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("rico-netgraph");

    const header = this.contentEl.createDiv({ cls: "rico-netgraph-header" });
    const topRow = header.createDiv({ cls: "rico-netgraph-toprow" });
    this.metaEl = topRow.createDiv({ cls: "rico-netgraph-meta" });

    const fitBtn = topRow.createEl("button", {
      cls: "rico-netgraph-fit",
      attr: { type: "button", "aria-label": "Fit to view" },
    });
    setIcon(fitBtn, "maximize");
    fitBtn.addEventListener("click", () => this.fit());

    const search = header.createEl("input", {
      cls: "rico-netgraph-search",
      attr: { type: "search", placeholder: "Cari node…" },
    });
    search.addEventListener("input", () => {
      this.query = search.value;
      this.paint();
    });

    this.legendEl = header.createDiv({ cls: "rico-netgraph-legend" });

    this.stageEl = this.contentEl.createDiv({ cls: "rico-netgraph-stage" });
    this.emptyEl = this.stageEl.createDiv({ cls: "rico-netgraph-empty" });
    this.tooltipEl = this.stageEl.createDiv({ cls: "rico-netgraph-tooltip" });
    this.buildSvg();
    this.bindPointer();

    const { workspace } = this.app;
    this.registerEvent(workspace.on("active-leaf-change", () => void this.refresh(true)));
    this.registerEvent(workspace.on("layout-change", () => void this.refresh(true)));
    this.registerInterval(window.setInterval(() => void this.refresh(false), POLL_MS));
    void this.refresh(true);
  }

  async onClose(): Promise<void> {
    this.refreshId++;
    this.stopFrames();
    this.layout?.destroy();
    this.layout = null;
  }

  // ---- SVG scaffolding ----

  private buildSvg(): void {
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.addClass("rico-netgraph-svg");
    this.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    // One shared arrowhead, tinted by the line it belongs to via `context-stroke`.
    const defs = document.createElementNS(SVG_NS, "defs");
    const marker = document.createElementNS(SVG_NS, "marker");
    marker.setAttribute("id", "rico-netgraph-arrow");
    marker.setAttribute("viewBox", "0 0 8 8");
    marker.setAttribute("refX", "7");
    marker.setAttribute("refY", "4");
    marker.setAttribute("markerWidth", "5");
    marker.setAttribute("markerHeight", "5");
    marker.setAttribute("orient", "auto-start-reverse");
    const head = document.createElementNS(SVG_NS, "path");
    head.setAttribute("d", "M0,0 L8,4 L0,8 z");
    head.setAttribute("fill", "context-stroke");
    marker.appendChild(head);
    defs.appendChild(marker);
    this.svg.appendChild(defs);

    this.viewport = document.createElementNS(SVG_NS, "g");
    this.linkLayer = document.createElementNS(SVG_NS, "g");
    this.nodeLayer = document.createElementNS(SVG_NS, "g");
    this.viewport.appendChild(this.linkLayer);
    this.viewport.appendChild(this.nodeLayer);
    this.svg.appendChild(this.viewport);
    this.stageEl.appendChild(this.svg);
  }

  // ---- Data ----

  private async refresh(force: boolean): Promise<void> {
    const id = ++this.refreshId;
    const leaf = this.tracker.current();
    if (!leaf) {
      this.show("Buka sebuah canvas");
      return;
    }
    const data = await readCanvasData(this.app, leaf);
    if (id !== this.refreshId) return;
    if (!data) {
      this.show("Canvas ini tidak bisa dibaca");
      return;
    }

    const path = canvasPath(leaf);
    const signature = `${path}|${dataSignature(data)}`;
    if (!force && signature === this.signature) return;
    // A forced refresh on the same canvas (tab switch) must not throw the layout away.
    if (signature === this.signature && this.layout) return;

    const sameCanvas = path === this.path;
    this.signature = signature;
    this.canvasLeaf = leaf;
    this.path = path;
    this.graph = buildGraph(data);
    this.nodeById = new Map(this.graph.nodes.map((n) => [n.id, n]));

    this.emptyEl.toggle(this.graph.nodes.length === 0);
    if (this.graph.nodes.length === 0) this.emptyEl.setText("Canvas ini kosong");
    this.layout?.destroy();
    this.layout = new GraphLayout(this.graph, sameCanvas ? this.lastPositions : undefined);
    this.layout.settle(SETTLE_TICKS);
    this.lastPositions = this.layout.positions();

    this.render();
    this.drawLegend();
    if (!sameCanvas) this.fit();
    this.paint();
    // Keep it moving briefly so an edit visibly settles instead of snapping.
    this.layout.reheat(sameCanvas ? 0.3 : 0.5);
    this.runFrames(LIVE_TICKS);
  }

  /** Empty the stage and show a single message. */
  private show(text: string): void {
    this.signature = "";
    this.path = "";
    this.canvasLeaf = null;
    this.layout?.destroy();
    this.layout = null;
    this.graph = { nodes: [], links: [] };
    this.nodeById.clear();
    this.lastPositions.clear();
    this.stopFrames();
    this.hideTooltip();
    this.linkLayer.empty();
    this.nodeLayer.empty();
    this.legendEl.empty();
    this.metaEl.setText("");
    this.emptyEl.setText(text);
    this.emptyEl.show();
  }

  // ---- Rendering ----

  /** Build one SVG element per link and per node. Positions are applied by paint(). */
  private render(): void {
    this.linkLayer.empty();
    this.nodeLayer.empty();

    const name = this.path.replace(/^.*\//, "").replace(/\.canvas$/i, "") || "Canvas";
    const { nodes, links } = this.graph;
    this.metaEl.setText(`${name} · ${nodes.length} node · ${links.length} relasi`);
    if (nodes.length === 0) return;

    for (const link of links) {
      const line = document.createElementNS(SVG_NS, "line");
      line.addClass("rico-netgraph-link");
      line.dataset.source = link.source;
      line.dataset.target = link.target;
      if (link.arrow === "→" || link.arrow === "↔") {
        line.setAttribute("marker-end", "url(#rico-netgraph-arrow)");
      }
      if (link.arrow === "←" || link.arrow === "↔") {
        line.setAttribute("marker-start", "url(#rico-netgraph-arrow)");
      }
      if (link.label) {
        const title = document.createElementNS(SVG_NS, "title");
        title.textContent = link.label;
        line.appendChild(title);
      }
      this.linkLayer.appendChild(line);
    }

    for (const node of nodes) {
      const g = document.createElementNS(SVG_NS, "g");
      g.addClass("rico-netgraph-node");
      g.addClass(`rico-netgraph-type-${node.type}`);
      g.dataset.id = node.id;

      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("r", String(nodeRadius(node.degree)));
      g.appendChild(circle);

      const text = document.createElementNS(SVG_NS, "text");
      text.addClass("rico-netgraph-label");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dy", String(nodeRadius(node.degree) + 11));
      text.textContent = shortLabel(node.label);
      g.appendChild(text);

      this.nodeLayer.appendChild(g);
    }
  }

  /** Write current positions and highlight state onto the existing SVG elements. */
  private paint(): void {
    const layout = this.layout;
    if (!layout) return;

    this.viewport.setAttribute(
      "transform",
      `translate(${this.panX} ${this.panY}) scale(${this.zoom})`,
    );

    const matches = matchingIds(this.graph, this.query);
    const searching = this.query.trim() !== "";
    const near = this.hovered ? neighboursOf(this.graph, this.hovered) : null;

    for (const el of Array.from(this.nodeLayer.children) as SVGGElement[]) {
      const id = el.dataset.id!;
      const node = layout.get(id);
      if (!node) continue;
      el.setAttribute("transform", `translate(${node.x} ${node.y})`);

      const dimmedBySearch = searching && !matches.has(id);
      const dimmedByHover = near !== null && id !== this.hovered && !near.has(id);
      el.toggleClass("is-dimmed", dimmedBySearch || dimmedByHover);
      el.toggleClass("is-active", id === this.hovered || (searching && matches.has(id)));
    }

    for (const el of Array.from(this.linkLayer.children) as SVGLineElement[]) {
      const a = layout.get(el.dataset.source!);
      const b = layout.get(el.dataset.target!);
      if (!a || !b) continue;
      // Stop the line at each circle's edge so arrowheads are not buried under a node.
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / dist;
      const uy = dy / dist;
      el.setAttribute("x1", String(a.x + ux * a.r));
      el.setAttribute("y1", String(a.y + uy * a.r));
      el.setAttribute("x2", String(b.x - ux * b.r));
      el.setAttribute("y2", String(b.y - uy * b.r));

      const touchesHover =
        this.hovered !== null && (el.dataset.source === this.hovered || el.dataset.target === this.hovered);
      el.toggleClass("is-active", touchesHover);
      el.toggleClass("is-dimmed", this.hovered !== null && !touchesHover);
    }
  }

  private drawLegend(): void {
    this.legendEl.empty();
    for (const type of usedTypes(this.graph)) {
      const item = this.legendEl.createDiv({ cls: `rico-netgraph-legend-item rico-netgraph-type-${type}` });
      item.createSpan({ cls: "rico-netgraph-swatch" });
      item.createSpan({ text: TYPE_NAMES[type] });
    }
  }

  // ---- Animation ----

  /** Keep ticking the simulation for `ticks` more steps, repainting each frame. */
  private runFrames(ticks: number): void {
    this.pending = Math.max(this.pending, ticks);
    if (this.frame !== null) return;
    const step = (): void => {
      this.frame = null;
      if (!this.layout || this.pending <= 0) return;
      this.layout.tick();
      this.pending--;
      this.lastPositions = this.layout.positions();
      this.paint();
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  private stopFrames(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.pending = 0;
  }

  // ---- Viewport ----

  /** Centre the whole graph in the panel. */
  private fit(): void {
    if (!this.layout || this.graph.nodes.length === 0) return;
    const rect = this.stageEl.getBoundingClientRect();
    const width = rect.width || 300;
    const height = rect.height || 300;
    const box = this.layout.bounds();
    const boxW = Math.max(box.maxX - box.minX, 1);
    const boxH = Math.max(box.maxY - box.minY, 1);

    const scale = Math.min(
      (width - FIT_PADDING * 2) / boxW,
      (height - FIT_PADDING * 2) / boxH,
      MAX_ZOOM,
    );
    this.zoom = Math.max(MIN_ZOOM, scale);
    this.panX = width / 2 - ((box.minX + box.maxX) / 2) * this.zoom;
    this.panY = height / 2 - ((box.minY + box.maxY) / 2) * this.zoom;
    this.paint();
  }

  /** Pointer position in graph coordinates. */
  private toGraph(event: { clientX: number; clientY: number }): Point {
    const rect = this.stageEl.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - this.panX) / this.zoom,
      y: (event.clientY - rect.top - this.panY) / this.zoom,
    };
  }

  private bindPointer(): void {
    // registerDomEvent is typed for HTML elements; an SVG element takes the same
    // listeners, it just is not declared as one.
    const svgTarget = this.svg as unknown as HTMLElement;
    this.registerDomEvent(svgTarget, "wheel", (event: WheelEvent) => {
      event.preventDefault();
      const rect = this.stageEl.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const before = this.toGraph(event);
      const next = this.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12);
      this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      // Keep the point under the cursor fixed while zooming.
      this.panX = px - before.x * this.zoom;
      this.panY = py - before.y * this.zoom;
      this.paint();
    });

    this.registerDomEvent(svgTarget, "pointerdown", (event: PointerEvent) => {
      if (event.button !== 0) return;
      const group = (event.target as Element).closest(".rico-netgraph-node") as SVGGElement | null;
      const id = group?.dataset.id;
      if (id) {
        this.drag = { kind: "node", id, moved: false };
      } else {
        this.drag = { kind: "pan", startX: event.clientX, startY: event.clientY, panX: this.panX, panY: this.panY };
      }
      this.svg.setPointerCapture(event.pointerId);
    });

    this.registerDomEvent(svgTarget, "pointermove", (event: PointerEvent) => {
      if (this.drag?.kind === "pan") {
        this.panX = this.drag.panX + (event.clientX - this.drag.startX);
        this.panY = this.drag.panY + (event.clientY - this.drag.startY);
        this.paint();
        return;
      }
      if (this.drag?.kind === "node") {
        if (!this.layout?.get(this.drag.id)) return;
        const point = this.toGraph(event);
        this.layout.pin(this.drag.id, point.x, point.y);
        this.drag.moved = true;
        this.layout.reheat(0.3);
        this.runFrames(LIVE_TICKS);
        return;
      }
      this.updateHover(event);
    });

    const endDrag = (event: PointerEvent): void => {
      if (this.drag?.kind === "node") {
        if (this.drag.moved) {
          // Let go of the node so the forces can settle it with the rest.
          this.layout?.unpin(this.drag.id);
          this.layout?.reheat(0.3);
          this.runFrames(LIVE_TICKS);
        } else {
          // A press that never moved is a click: zoom the real canvas to that node.
          this.focus(this.drag.id);
        }
      }
      this.drag = null;
      if (this.svg.hasPointerCapture(event.pointerId)) this.svg.releasePointerCapture(event.pointerId);
    };
    this.registerDomEvent(svgTarget, "pointerup", endDrag);
    this.registerDomEvent(svgTarget, "pointercancel", endDrag);

    this.registerDomEvent(svgTarget, "pointerleave", () => {
      this.hovered = null;
      this.hideTooltip();
      this.paint();
    });

    // Double-clicking the background shakes the layout loose and re-settles it.
    this.registerDomEvent(svgTarget, "dblclick", (event: MouseEvent) => {
      if ((event.target as Element).closest(".rico-netgraph-node")) return;
      this.layout?.unpinAll();
      this.layout?.reheat(0.8);
      this.runFrames(SETTLE_TICKS / 2);
    });
  }

  private updateHover(event: PointerEvent): void {
    const group = (event.target as Element).closest(".rico-netgraph-node") as SVGGElement | null;
    const id = group?.dataset.id ?? null;
    if (id !== this.hovered) {
      this.hovered = id;
      this.paint();
    }
    if (!id) {
      this.hideTooltip();
      return;
    }
    const node = this.nodeById.get(id);
    if (!node) return;
    const rect = this.stageEl.getBoundingClientRect();
    this.tooltipEl.setText(`${node.label} · ${node.degree} koneksi`);
    this.tooltipEl.style.left = `${event.clientX - rect.left + 12}px`;
    this.tooltipEl.style.top = `${event.clientY - rect.top + 12}px`;
    this.tooltipEl.addClass("is-visible");
  }

  private hideTooltip(): void {
    this.tooltipEl.removeClass("is-visible");
  }

  private focus(id: string): void {
    if (!this.canvasLeaf || !focusCanvasNode(this.app, this.canvasLeaf, id)) {
      new Notice("Node tidak ditemukan di canvas");
    }
  }
}
