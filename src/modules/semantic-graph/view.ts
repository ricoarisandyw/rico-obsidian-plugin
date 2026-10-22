import { ItemView, MarkdownView, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type { Embedder } from "../semantic-search/embedder";
import { MissingModelError } from "../semantic-search/embedder";
import type { VectorStore } from "../semantic-search/store";
import { search, type SearchResult } from "../semantic-search/search";
import { Debouncer, RunGuard } from "../semantic-search/query-state";
import { GRAPH_SCORING_KEYS, ScoringPanel } from "../semantic-search/scoring-panel";
import type { ScorerToggles, ScorerWeights } from "../semantic-search/scoring";
import type { RicoPluginSettings } from "../../types";
import { assignClusters } from "./cluster";
import {
  atHopLimit,
  buildGraph,
  emptyGraph,
  expandGraph,
  type GraphNode,
  type SemanticGraph,
} from "./logic";
import { SETTLE_TICKS, SemanticGraphLayout, type Point } from "./layout";
import { SvgRenderer, themeFrom } from "./renderer";

export const SEMANTIC_GRAPH_VIEW_TYPE = "rico-semantic-graph";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
/** Empty space kept around the graph when fitting it to the panel. */
const FIT_PADDING = 28;
/** Frames the simulation keeps running after a change, so it settles visibly. */
const LIVE_FRAMES = 120;
/** Longest label drawn under a circle before it is cut short. */
const MAX_LABEL = 20;

interface ViewDeps {
  store: VectorStore;
  embedder: Embedder;
  settings: () => RicoPluginSettings;
  save: () => Promise<void>;
  /** Resolves once the vector index has finished loading from disk. */
  ready?: () => Promise<void>;
}

function shortLabel(label: string): string {
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
}

/**
 * The nearest connections of the active note, drawn as a force-directed graph.
 *
 * Distance and circle size both come from the weighted exact/fuzzy/vector
 * score, so moving the sliders in the Scoring panel visibly rearranges the
 * constellation. Neighbours are also grouped by topic, so related notes share a
 * colour and a side. Clicking opens notes; the one thing that writes to a note
 * is dragging a node onto an open editor, which inserts a link there.
 */
export class SemanticGraphView extends ItemView {
  private scoringPanel!: ScoringPanel;
  private contextEl!: HTMLElement;
  private stageEl!: HTMLElement;
  private renderer!: SvgRenderer;
  private tooltipEl!: HTMLElement;
  private statusEl!: HTMLElement;
  /** Covers the stage while loading, or when there is nothing to draw. */
  private overlayEl!: HTMLElement;
  /** False until the panel has had a real size, so the first run is not wasted. */
  private sized = false;
  /** The build in flight, so two callers asking at once share one build. */
  private building: Promise<void> | null = null;
  /** Counters for the diagnose command: did Obsidian ever call onOpen, and did build run? */
  readonly debug = { onOpenCalls: 0, buildCalls: 0, lastError: "" };
  /** Raw ranked rows, shown instead of the graph when the list is toggled on. */
  private listEl!: HTMLElement;
  private showList = false;

  private graph: SemanticGraph = emptyGraph();
  private layout: SemanticGraphLayout | null = null;
  /** Positions carried over when the graph is rebuilt, so it nudges rather than jumps. */
  private lastPositions = new Map<string, Point>();

  private currentPath = "";
  private hovered: string | null = null;
  /** Set while a drag actually moved something, so it does not become a click. */
  private dragMoved = false;
  private frame: number | null = null;
  /** Frames still owed to the simulation; the loop stops when it hits zero. */
  private pending = 0;

  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private drag:
    | { kind: "pan"; startX: number; startY: number; panX: number; panY: number }
    | { kind: "node"; path: string; moved: boolean }
    | null = null;

  private readonly guard = new RunGuard();
  /** Collapses the two events a single note switch fires into one run. */
  private readonly noteSwitch = new Debouncer(() => 150);

  constructor(
    leaf: WorkspaceLeaf,
    private deps: ViewDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return SEMANTIC_GRAPH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Semantic graph";
  }

  getIcon(): string {
    // "git-fork" has been in Obsidian's icon set for a long time, unlike some
    // newer Lucide names that render as an empty element on older builds.
    return "git-fork";
  }

  /**
   * Obsidian discards a view whose onOpen throws, leaving a blank pane with no
   * clue why, so the failure is caught and shown in the panel instead.
   */
  async onOpen(): Promise<void> {
    this.debug.onOpenCalls++;
    await this.ensureBuilt();
  }

  /**
   * Last resort for a view Obsidian created but never put on screen.
   *
   * Hangs the view's element on its leaf by hand. Returns false when there is
   * nothing to hang it on or it is already there. This pokes at how Obsidian
   * assembles a leaf, so it is only tried once the normal route has failed.
   */
  attachToLeaf(): boolean {
    if (this.containerEl.isConnected) return false;
    const host = this.leaf.containerEl;
    if (!host?.isConnected) return false;
    this.containerEl.setAttribute("data-type", this.getViewType());
    host.appendChild(this.containerEl);
    console.warn(">>> semantic-graph: attached the view to its leaf by hand");
    return this.containerEl.isConnected;
  }

  /** Obsidian calls this once the pane has a size, which is a second chance to build. */
  onResize(): void {
    void this.ensureBuilt();
  }

  /**
   * Build the panel if it is not there yet. Safe to call any number of times.
   *
   * The UI used to be built only from onOpen, and a diagnose run showed a view
   * that was alive and mounted with an empty content element: onOpen had never
   * run on it. Nothing else could ever build it, so the panel stayed blank
   * forever. Anyone who knows the view exists (the open command, the plugin on
   * layout events) can now call this, and the "is the panel there?" test is the
   * DOM itself rather than a flag that can drift out of step with it.
   */
  ensureBuilt(): Promise<void> {
    if (this.contentEl.hasClass("rico-sg")) return Promise.resolve();
    if (this.building) return this.building;
    this.building = (async () => {
      this.debug.buildCalls++;
      try {
        await this.build();
      } catch (err) {
        console.error("[semantic-graph] failed to open", err);
        // Last resort: plain DOM, assuming none of our own fields exist yet.
        const message = err instanceof Error ? `${err.message}` : String(err);
        this.debug.lastError = message;
        this.contentEl.empty();
        const box = this.contentEl.createDiv({ cls: "rico-sg-overlay is-error" });
        box.createDiv({ cls: "rico-sg-overlay-text", text: `Semantic graph failed to open: ${message}` });
        new Notice(`Semantic graph failed to open: ${message}`, 10000);
      } finally {
        this.building = null;
      }
    })();
    return this.building;
  }

  private async build(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("rico-sg");

    const header = root.createDiv({ cls: "rico-sg-header" });
    // Always visible, whatever the graph is doing: if this shows, the panel is
    // mounted and any blank area below it is a graph problem, not a panel one.
    header.createDiv({ cls: "rico-sg-title", text: "Semantic graph" });
    this.contextEl = header.createDiv({ cls: "rico-sg-context" });

    const actions = header.createDiv({ cls: "rico-sg-actions" });
    this.iconButton(actions, "refresh-cw", "Rebuild the graph", () => void this.run(true));
    this.iconButton(actions, "maximize", "Fit to panel", () => this.fit());
    // Shows the ranked rows as plain text. The graph depends on a layout, an
    // SVG and a transform all being right; the list depends on none of them,
    // so it says whether a blank panel is a data problem or a drawing one.
    this.iconButton(actions, "list", "Show the ranked list", () => this.toggleList());

    this.scoringPanel = new ScoringPanel({
      settings: this.deps.settings,
      save: this.deps.save,
      keys: GRAPH_SCORING_KEYS,
      onChange: () => void this.run(true),
    });
    this.scoringPanel.render(root);

    this.stageEl = root.createDiv({ cls: "rico-sg-stage" });
    this.buildSvg();
    this.renderer.setBadge("graph area ready · waiting for data");
    this.tooltipEl = this.stageEl.createDiv({ cls: "rico-sg-tooltip is-hidden" });
    // Sits on top of the stage. A thin status bar at the bottom is too easy to
    // miss when the panel is otherwise empty, which is exactly when it matters.
    this.overlayEl = this.stageEl.createDiv({ cls: "rico-sg-overlay is-hidden" });
    this.listEl = this.stageEl.createDiv({ cls: "rico-sg-list is-hidden" });
    this.statusEl = root.createDiv({ cls: "rico-sg-status" });

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        if (!this.deps.settings().semanticGraphFollowActive) return;
        this.noteSwitch.schedule(() => void this.run());
      }),
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        if (!this.deps.settings().semanticGraphFollowActive) return;
        this.noteSwitch.schedule(() => void this.run());
      }),
    );

    // A leaf restored from the saved workspace opens while the sidebar is still
    // collapsed, so the stage has no size and the graph is laid out into
    // nothing. Watch for the panel actually gaining a size and rebuild then.
    // This is also what makes the view survive being opened in any other way.
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        const { width, height } = this.stageEl.getBoundingClientRect();
        if (!width || !height) return;
        if (this.sized) {
          this.fit();
          return;
        }
        this.sized = true;
        void this.run(true);
      });
      observer.observe(this.stageEl);
      this.register(() => observer.disconnect());
    }
    // Run straight away. onLayoutReady only fires once, at startup, so a view
    // opened later would never get its first paint. A failure here must not
    // escape onOpen, or Obsidian discards the whole view and the panel is blank.
    void this.run(true).catch((err) => {
      console.error("[semantic-graph] first run failed", err);
      this.showEmpty("Could not build the graph.", {
        error: true,
        action: { label: "Try again", onClick: () => void this.run(true) },
      });
    });

    // The panel has no width until the sidebar lays it out, and fit() bails out
    // at zero width. Re-fit once that has happened so the graph is not left at
    // the default zoom in a corner.
    this.registerEvent(this.app.workspace.on("layout-change", () => this.fit()));
    window.setTimeout(() => this.fit(), 0);
  }

  private iconButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void,
  ): void {
    const button = parent.createEl("button", {
      cls: "rico-sg-icon-button",
      attr: { "aria-label": label, title: label },
    });
    setIcon(button, icon);
    button.addEventListener("click", onClick);
  }

  // --- rendering -----------------------------------------------------------

  private buildSvg(): void {
    this.renderer = new SvgRenderer(this.stageEl);
    // registerDomEvent is typed for HTML elements; an SVG element takes the
    // same listeners, it just is not declared as one.
    const el = this.renderer.el as unknown as HTMLElement;

    this.registerDomEvent(el, "wheel", (event: WheelEvent) => this.onWheel(event));
    this.registerDomEvent(el, "mousedown", (event: MouseEvent) => this.onMouseDown(event));
    this.registerDomEvent(el, "mousemove", (event: MouseEvent) => this.onHover(event));
    this.registerDomEvent(el, "mouseleave", () => {
      if (this.hovered) {
        this.hovered = null;
        this.hideTooltip();
        this.paint();
      }
    });
    this.registerDomEvent(el, "click", (event: MouseEvent) => this.onClick(event));
    // On the window, so a drag that leaves the panel still ends properly.
    this.registerDomEvent(window, "mousemove", (event: MouseEvent) => this.onMouseMove(event));
    this.registerDomEvent(window, "mouseup", (event: MouseEvent) => this.onMouseUp(event));
  }

  /** Hover highlighting and the tooltip, from the node under the pointer. */
  private onHover(event: MouseEvent): void {
    if (this.drag) return;
    const node = this.nodeAt(event);
    const path = node?.path ?? null;
    if (path === this.hovered) return;
    this.hovered = path;
    if (node) {
      this.showTooltip(node);
      if (node.hop > 0) this.previewNote(node.path, event);
    } else {
      this.hideTooltip();
    }
    this.paint();
  }

  /**
   * Ask Obsidian for its page preview. The SVG is hit-tested as a whole, so it
   * is the hover target; Obsidian checks the modifier key on the event.
   */
  private previewNote(path: string, event: MouseEvent): void {
    this.app.workspace.trigger("hover-link", {
      event,
      source: SEMANTIC_GRAPH_VIEW_TYPE,
      hoverParent: this,
      targetEl: this.renderer.el,
      linktext: path,
    });
  }

  /** Click opens the note; alt-click grows the map by one hop. */
  private onClick(event: MouseEvent): void {
    // A click that moved a node was a drag, not a request to open it.
    if (this.dragMoved) {
      this.dragMoved = false;
      return;
    }
    const node = this.nodeAt(event);
    if (!node || node.hop === 0) return;
    if (event.altKey) void this.expand(node.path);
    else void this.open(node.path);
  }

  /** The node under the pointer, if any. */
  private nodeAt(event: MouseEvent): GraphNode | null {
    if (!this.layout) return null;
    const point = this.renderer.toGraph(event.clientX, event.clientY, this.transform);
    return this.renderer.hitTest(point.x, point.y, this.graph, this.layout);
  }

  /** Zoom and pan, in the shape the renderer wants. */
  private get transform() {
    return { zoom: this.zoom, panX: this.panX, panY: this.panY };
  }

  /** Repaint from the current layout positions. */
  private paint(): void {
    if (!this.layout || !this.renderer) return;
    const { width, height } = this.stageEl.getBoundingClientRect();
    this.renderer.setBadge(
      `${this.graph.nodes.length} nodes · area ${Math.round(width)}×${Math.round(height)}`,
    );
    // Nothing to draw into yet; the ResizeObserver will call back once there is.
    if (!this.renderer.resize(width, height)) return;

    this.renderer.draw({
      graph: this.graph,
      layout: this.layout,
      transform: this.transform,
      hovered: this.hovered,
      showLabels: this.deps.settings().semanticGraphShowLabels,
      theme: themeFrom(this.containerEl),
    });
  }

  private showTooltip(node: GraphNode): void {
    const lines = [node.path];
    if (node.hop > 0) {
      lines.push(`score ${node.score.toFixed(3)} · hop ${node.hop}`);
      for (const part of node.breakdown?.parts ?? []) {
        if (part.score == null) continue;
        lines.push(`${part.key}: ${part.score.toFixed(3)} × ${part.weight.toFixed(2)}`);
      }
      const maxHops = this.deps.settings().semanticGraphMaxHops;
      if (!atHopLimit(this.graph, node.path, maxHops)) {
        lines.push("alt-click to expand");
      }
    }
    this.tooltipEl.empty();
    for (const line of lines) this.tooltipEl.createDiv({ text: line });
    this.tooltipEl.removeClass("is-hidden");
  }

  private hideTooltip(): void {
    this.tooltipEl.addClass("is-hidden");
  }

  // --- interaction ---------------------------------------------------------

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    if (next === this.zoom) return;

    // Zoom towards the pointer rather than the centre, which is what every
    // other map-like control does.
    const rect = this.renderer.el.getBoundingClientRect();
    const px = event.clientX - rect.left - rect.width / 2;
    const py = event.clientY - rect.top - rect.height / 2;
    const ratio = next / this.zoom;
    this.panX = px - (px - this.panX) * ratio;
    this.panY = py - (py - this.panY) * ratio;
    this.zoom = next;
    this.paint();
  }

  private onMouseDown(event: MouseEvent): void {
    this.dragMoved = false;
    // Hit testing is geometric rather than per-element, so
    // the node under the pointer decides whether this drag moves a node or
    // pans the whole view.
    const node = this.nodeAt(event);
    if (node && node.hop !== 0) {
      this.drag = { kind: "node", path: node.path, moved: false };
      return;
    }
    this.drag = {
      kind: "pan",
      startX: event.clientX,
      startY: event.clientY,
      panX: this.panX,
      panY: this.panY,
    };
  }

  private onMouseMove(event: MouseEvent): void {
    if (!this.drag) return;

    if (this.drag.kind === "pan") {
      this.panX = this.drag.panX + (event.clientX - this.drag.startX);
      this.panY = this.drag.panY + (event.clientY - this.drag.startY);
      // A few pixels of wobble should not count as a drag, or every click
      // would be swallowed.
      if (Math.abs(event.clientX - this.drag.startX) > 3 ||
          Math.abs(event.clientY - this.drag.startY) > 3) {
        this.dragMoved = true;
      }
      this.paint();
      return;
    }

    if (!this.layout) return;
    const { x, y } = this.renderer.toGraph(event.clientX, event.clientY, this.transform);
    this.drag.moved = true;
    this.dragMoved = true;
    this.layout.pin(this.drag.path, x, y);
    this.layout.reheat(0.3);
    this.pending = LIVE_FRAMES;
    this.ensureFrame();
  }

  private onMouseUp(event: MouseEvent): void {
    if (this.drag?.kind === "node" && this.layout) {
      // Let go over an open editor and the node becomes a link in that note.
      if (this.drag.moved) this.dropOnEditor(this.drag.path, event);
      // Release it unless it is the centre, which stays anchored on purpose.
      if (this.drag.path !== this.graph.centre) this.layout.unpin(this.drag.path);
      this.layout.reheat(0.2);
      this.pending = LIVE_FRAMES;
      this.ensureFrame();
    }
    this.drag = null;
  }

  /**
   * Insert a link to `path` into the editor the pointer was released over.
   *
   * Releasing inside the graph panel is just moving a node, so only a release
   * outside it counts. Reading mode has no cursor to insert at, so it explains
   * itself instead of silently doing nothing.
   */
  private dropOnEditor(path: string, event: MouseEvent): void {
    const box = this.stageEl.getBoundingClientRect();
    const inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom;
    if (inside) return;

    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!target) return;
    const leaf = this.app.workspace
      .getLeavesOfType("markdown")
      .find((candidate) => candidate.view.containerEl.contains(target));
    const view = leaf?.view;
    if (!(view instanceof MarkdownView) || !view.file) return;

    const file = this.fileAt(path);
    if (!file || file.path === view.file.path) return;
    if (view.getMode() !== "source") {
      new Notice("Switch that note to editing view to drop a link into it.", 4000);
      return;
    }

    view.editor.replaceSelection(this.app.fileManager.generateMarkdownLink(file, view.file.path));
    new Notice(`Linked ${file.basename}`, 2500);
  }

  /** Scale and centre the graph so the whole thing is visible. */
  private fit(): void {
    if (!this.layout || !this.graph.nodes.length) return;
    const { width, height } = this.stageEl.getBoundingClientRect();
    if (!width || !height) return;

    const box = this.layout.bounds();
    const graphWidth = Math.max(1, box.maxX - box.minX);
    const graphHeight = Math.max(1, box.maxY - box.minY);
    const scale = Math.min(
      (width - FIT_PADDING * 2) / graphWidth,
      (height - FIT_PADDING * 2) / graphHeight,
    );
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));

    // Pull the middle of the bounding box to the middle of the panel.
    const midX = (box.minX + box.maxX) / 2;
    const midY = (box.minY + box.maxY) / 2;
    this.panX = -midX * this.zoom;
    this.panY = -midY * this.zoom;
    this.paint();
  }

  private ensureFrame(): void {
    if (this.frame !== null) return;
    const step = () => {
      this.frame = null;
      if (!this.layout || this.pending <= 0) return;
      this.pending--;
      this.layout.tick();
      this.lastPositions = this.layout.positions();
      this.paint();
      this.ensureFrame();
    };
    this.frame = requestAnimationFrame(step);
  }

  private async open(path: string): Promise<void> {
    const file = this.fileAt(path);
    if (!file) return;
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  /**
   * Fire an Obsidian command by id.
   *
   * The indexing work lives in the semantic-search module, so rather than
   * duplicating it the overlay buttons just invoke its commands.
   */
  private runCommand(id: string, missing: string): void {
    const commands = (this.app as unknown as {
      commands?: { executeCommandById?: (id: string) => boolean };
    }).commands;
    if (!commands?.executeCommandById?.(id)) {
      new Notice(missing, 6000);
    }
  }

  private runIndexCommand(): void {
    new Notice("Indexing the vault. This can take a while.", 4000);
    this.runCommand(
      "rico-obsidian-plugin:semantic-search-index-vault",
      "Run “Semantic search: index vault” from the command palette.",
    );
  }

  private runEmbedCommand(): void {
    this.runCommand(
      "rico-obsidian-plugin:semantic-search-embed-current",
      "Run “Semantic search: embed current note” from the command palette.",
    );
  }

  /** Open this plugin's settings tab, for the threshold and weights. */
  private openSettings(): void {
    const app = this.app as unknown as {
      setting?: { open?: () => void; openTabById?: (id: string) => void };
    };
    app.setting?.open?.();
    app.setting?.openTabById?.("rico-obsidian-plugin");
  }

  /**
   * Look a path up in the vault, surviving a bad one.
   *
   * Another plugin on this vault hands Obsidian a non-string path and
   * `getAbstractFileByPath` throws "startsWith is not a function" from deep
   * inside the app. That should cost this panel a node, not the whole view.
   */
  private fileAt(path: unknown): TFile | null {
    if (typeof path !== "string" || !path) return null;
    try {
      const file = this.app.vault.getAbstractFileByPath(path);
      return file instanceof TFile ? file : null;
    } catch (err) {
      console.error("[semantic-graph] bad path", path, err);
      return null;
    }
  }

  // --- data ----------------------------------------------------------------

  private activeFile(): TFile | null {
    const file = this.app.workspace.getActiveFile();
    if (!file) return null;
    return file.extension === "md" || file.extension === "canvas" ? file : null;
  }

  private weights(settings: RicoPluginSettings): ScorerWeights {
    return {
      vector: settings.semanticGraphWeightVector,
      exact: settings.semanticGraphWeightExact,
      fuzzy: settings.semanticGraphWeightFuzzy,
    };
  }

  private toggles(settings: RicoPluginSettings): ScorerToggles {
    return {
      vector: settings.semanticGraphUseVector,
      exact: settings.semanticGraphUseExact,
      fuzzy: settings.semanticGraphUseFuzzy,
    };
  }

  /**
   * Rank the vault against one note.
   *
   * The exact and fuzzy scorers need literal text to look for; following a note
   * has no typed query, so the note's own name is used. That is what makes the
   * Exact slider meaningful here: it pulls in notes that mention this one by name.
   */
  private async rankAgainst(
    path: string,
    settings: RicoPluginSettings,
  ): Promise<SearchResult[]> {
    const file = this.fileAt(path);
    const cached = this.deps.store.get(path);
    let vec = cached?.vec;

    if (!vec && file) {
      const raw = await this.app.vault.cachedRead(file);
      const max = settings.semanticSearchMaxChars;
      const text = `${file.basename}\n\n${raw}`;
      vec = await this.deps.embedder.embed(max > 0 ? text.slice(0, max) : text, "query");
    }
    if (!vec) return [];

    const basename = file ? file.basename : path;
    return search(path, vec, this.deps.store.all(), {
      limit: settings.semanticGraphLimit,
      minScore: settings.semanticGraphMinScore,
      excludeFilter: settings.semanticSearchExcludeFilter,
      exactQuery: basename,
      weights: this.weights(settings),
      toggles: this.toggles(settings),
    });
  }

  /** Rebuild the graph around the active note. */
  async run(force = false): Promise<void> {
    const settings = this.deps.settings();
    const token = this.guard.begin();

    const file = this.activeFile();
    if (!file) {
      this.setContext("");
      this.showEmpty("Open a note to see its nearest connections.", { icon: "file-question" });
      return;
    }
    if (!force && file.path === this.currentPath && this.graph.nodes.length) return;
    this.currentPath = file.path;

    this.setContext(`Nearest to: ${file.basename}`);
    this.showLoading("Ranking…");

    try {
      // The index may still be loading when the view opens; without this the
      // first run would search an empty store and wrongly report nothing indexed.
      this.showLoading("Loading index…");
      await this.deps.ready?.();
      if (!this.guard.isCurrent(token)) return;
      this.showLoading("Ranking…");

      const results = await this.rankAgainst(file.path, settings);
      if (!this.guard.isCurrent(token)) return;

      // A fresh centre means the old positions describe a different picture,
      // so they are only reused when the centre has not moved.
      const sameCentre = this.graph.centre === file.path;
      this.graph = this.withClusters(
        buildGraph(file.path, results, {
          limit: settings.semanticGraphLimit,
          minScore: settings.semanticGraphMinScore,
          spread: settings.semanticGraphSpread,
        }),
      );
      this.render(sameCentre);

      console.log(">>> semantic-graph: ranked", {
        note: file.path,
        indexed: this.deps.store.size,
        noteIsIndexed: !!this.deps.store.get(file.path),
        results: results.length,
        nodes: this.graph.nodes.length,
        topScores: results.slice(0, 3).map((r) => r.score.toFixed(3)),
        minScore: settings.semanticGraphMinScore,
        toggles: this.toggles(settings),
        stage: {
          width: this.stageEl.getBoundingClientRect().width,
          height: this.stageEl.getBoundingClientRect().height,
        },
      });

      if (this.graph.nodes.length <= 1) {
        if (this.deps.store.size === 0) {
          this.showEmpty("Nothing indexed yet.", {
            icon: "database",
            action: {
              label: "Index vault",
              onClick: () => this.runIndexCommand(),
            },
          });
        } else if (!this.deps.store.get(file.path)) {
          // The vault has vectors but this note is not among them, which is a
          // different problem from an empty index and needs a different fix.
          this.showEmpty(`“${file.basename}” is not indexed yet.`, {
            icon: "file-question",
            action: {
              label: "Index this note",
              onClick: () => this.runEmbedCommand(),
            },
          });
        } else {
          this.showEmpty("No connections above the minimum score.", {
            icon: "git-fork",
            action: {
              label: "Lower the threshold",
              onClick: () => this.openSettings(),
            },
          });
        }
      } else {
        this.hideOverlay();
        const count = this.graph.nodes.length - 1;
        this.statusEl?.setText(`${count} connections`);
        // Only on an explicit rebuild: a toast on every note switch would be noise.
        if (force) new Notice(`Semantic graph: ${count} connections found.`, 2500);
      }
    } catch (err) {
      if (!this.guard.isCurrent(token)) return;
      this.reportError(err);
    }
  }

  /** Group the neighbours by topic, using the vectors already in the index. */
  private withClusters(graph: SemanticGraph): SemanticGraph {
    const groups = this.deps.settings().semanticGraphClusters;
    if (!(groups >= 2)) return graph;
    return assignClusters(graph, (path) => this.deps.store.get(path)?.vec, groups);
  }

  /** Add one note's neighbours to the graph, without moving the centre. */
  private async expand(path: string): Promise<void> {
    const settings = this.deps.settings();
    if (atHopLimit(this.graph, path, settings.semanticGraphMaxHops)) {
      this.statusEl?.setText("Hop limit reached.");
      return;
    }

    const token = this.guard.begin();
    this.statusEl?.setText("Expanding…");
    try {
      const results = await this.rankAgainst(path, settings);
      if (!this.guard.isCurrent(token)) return;

      const before = this.graph.nodes.length;
      this.graph = this.withClusters(
        expandGraph(this.graph, path, results, {
          limit: settings.semanticGraphLimit,
          minScore: settings.semanticGraphMinScore,
          spread: settings.semanticGraphSpread,
        }),
      );
      this.render(true);
      const added = this.graph.nodes.length - before;
      this.statusEl?.setText(
        added > 0 ? `Added ${added} connections` : "Nothing new to add here.",
      );
      new Notice(
        added > 0 ? `Added ${added} connections.` : "Nothing new to add here.",
        2500,
      );
    } catch (err) {
      if (!this.guard.isCurrent(token)) return;
      this.reportError(err);
    }
  }

  /** Build a layout for the current graph, settle it, and paint. */
  private render(reusePositions: boolean): void {
    this.layout?.destroy();
    this.layout = new SemanticGraphLayout(
      this.graph,
      reusePositions ? this.lastPositions : undefined,
    );
    this.layout.settle(SETTLE_TICKS);
    this.lastPositions = this.layout.positions();
    this.paint();
    this.fit();
    this.renderList();
  }

  private setContext(text: string): void {
    this.contextEl?.setText(text);
    this.contextEl?.toggleClass("is-hidden", !text);
  }

  /** Spinner over the stage while work is in flight. */
  private showLoading(text: string): void {
    // A run can be triggered before the UI finished building, e.g. by a note
    // switch firing during onOpen. Nothing to draw on yet, so just log it.
    if (!this.overlayEl) {
      return;
    }
    this.overlayEl.empty();
    this.overlayEl.removeClass("is-hidden", "is-error");
    this.overlayEl.addClass("is-loading");
    this.overlayEl.createDiv({ cls: "rico-sg-spinner" });
    this.overlayEl.createDiv({ cls: "rico-sg-overlay-text", text });
    this.statusEl?.setText(text);
  }

  /**
   * Clear the graph and explain why there is nothing to see.
   *
   * `action` adds a button, because the usual reasons (nothing indexed, no note
   * open) each have one obvious next step and leaving the user to find it in
   * the command palette is needless friction.
   */
  private showEmpty(
    text: string,
    options: { icon?: string; error?: boolean; action?: { label: string; onClick: () => void } } = {},
  ): void {
    this.graph = emptyGraph();
    this.layout?.destroy();
    this.layout = null;

    if (!this.overlayEl) {
      return;
    }
    this.overlayEl.empty();
    this.overlayEl.removeClass("is-hidden", "is-loading");
    this.overlayEl.toggleClass("is-error", !!options.error);

    const icon = this.overlayEl.createDiv({ cls: "rico-sg-overlay-icon" });
    setIcon(icon, options.icon ?? (options.error ? "alert-triangle" : "git-fork"));
    this.overlayEl.createDiv({ cls: "rico-sg-overlay-text", text });
    this.renderList();

    if (options.action) {
      const button = this.overlayEl.createEl("button", {
        cls: "rico-sg-overlay-button",
        text: options.action.label,
      });
      button.addEventListener("click", options.action.onClick);
    }
    this.statusEl?.setText(text);
  }

  /** Flip between the graph and the raw rows. Also reachable from a command. */
  toggleList(): void {
    this.showList = !this.showList;
    this.renderList();
  }

  /**
   * The ranked rows as plain text, plus the numbers the graph depends on.
   *
   * Deliberately bypasses the layout and the SVG transform: if
   * rows appear here but the SVG is blank, the data is fine and the drawing
   * is at fault, which is otherwise hard to tell apart.
   */
  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();
    this.listEl.toggleClass("is-hidden", !this.showList);
    if (!this.showList) return;

    const stage = this.stageEl.getBoundingClientRect();
    const nodes = this.graph.nodes;

    const head = this.listEl.createDiv({ cls: "rico-sg-list-head" });
    head.createDiv({ cls: "rico-sg-list-title", text: "Raw data" });

    // Everything needed to tell data problems from drawing problems.
    const facts: [string, string][] = [
      ["centre", this.graph.centre || "(none)"],
      ["nodes", String(nodes.length)],
      ["links", String(this.graph.links.length)],
      ["indexed vectors", String(this.deps.store.size)],
      ["centre indexed", this.graph.centre && this.deps.store.get(this.graph.centre) ? "yes" : "no"],
      ["layout built", this.layout ? "yes" : "no"],
      ["stage size", `${Math.round(stage.width)} x ${Math.round(stage.height)}`],
      ["zoom", this.zoom.toFixed(2)],
      ["pan", `${Math.round(this.panX)}, ${Math.round(this.panY)}`],
      ["svg size", `${this.renderer?.el.getAttribute("width") ?? 0} x ${this.renderer?.el.getAttribute("height") ?? 0}`],
    ];
    const facts_el = this.listEl.createDiv({ cls: "rico-sg-list-facts" });
    for (const [label, value] of facts) {
      const row = facts_el.createDiv({ cls: "rico-sg-fact" });
      row.createSpan({ cls: "rico-sg-fact-label", text: label });
      row.createSpan({ cls: "rico-sg-fact-value", text: value });
    }

    if (nodes.length <= 1) {
      this.listEl.createDiv({
        cls: "rico-sg-list-empty",
        text: "No neighbours were ranked. The problem is the data, not the drawing.",
      });
      return;
    }

    const rows = this.listEl.createDiv({ cls: "rico-sg-list-rows" });
    // Skip the centre: it is not one of its own connections.
    for (const node of nodes.filter((n) => n.hop > 0).sort((a, b) => b.score - a.score)) {
      const row = rows.createDiv({ cls: "rico-sg-list-row" });
      row.createSpan({ cls: "rico-sg-list-score", text: node.score.toFixed(3) });
      const body = row.createDiv({ cls: "rico-sg-list-body" });
      body.createDiv({ cls: "rico-sg-list-name", text: node.label });

      const pos = this.layout?.get(node.path);
      const where = pos ? `x ${Math.round(pos.x)}, y ${Math.round(pos.y)}` : "no position";
      body.createDiv({
        cls: "rico-sg-list-meta",
        text: `hop ${node.hop} · ${where} · ${node.path}`,
      });
      row.addEventListener("click", () => void this.open(node.path));
    }
  }

  /** Take the overlay away once there is a graph to look at. */
  private hideOverlay(): void {
    if (!this.overlayEl) return;
    this.overlayEl.empty();
    this.overlayEl.addClass("is-hidden");
    this.overlayEl.removeClass("is-loading", "is-error");
  }

  private reportError(err: unknown): void {
    if (err instanceof MissingModelError) {
      this.showEmpty(err.message, {
        error: true,
        icon: "download",
        action: { label: "Open settings", onClick: () => this.openSettings() },
      });
      new Notice(err.message, 8000);
      return;
    }
    console.error("[semantic-graph] failed", err);
    const message = err instanceof Error ? err.message : String(err);
    this.showEmpty("Could not build the graph.", {
      error: true,
      action: { label: "Try again", onClick: () => void this.run(true) },
    });
    new Notice(`Semantic graph failed: ${message}`, 8000);
  }

  async onClose(): Promise<void> {
    this.noteSwitch.cancel();
    this.guard.invalidate();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.layout?.destroy();
    this.layout = null;
    this.sized = false;
    // The class is how ensureBuilt tells whether the panel exists, so a closed
    // view must stop claiming it does.
    this.contentEl.removeClass("rico-sg");
  }
}
