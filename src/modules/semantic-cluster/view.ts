import { ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type { VectorStore } from "../semantic-search/store";
import type { RicoPluginSettings } from "../../types";
import { clusterVaultAsync, type ClusterMap } from "./cluster-all";
import { buildExcluder } from "./exclude";
import { layoutClusters, type ClusterLayout } from "./layout";
import { ClusterRenderer, type ViewTransform } from "./renderer";

export const SEMANTIC_CLUSTER_VIEW_TYPE = "rico-semantic-cluster";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 6;
/** Empty space kept around the map when fitting it to the panel. */
const FIT_PADDING = 36;
/** Past this many notes the map still draws, but says it may be slow. */
const LARGE_VAULT = 8000;

/**
 * What the last run produced, kept outside the view.
 *
 * Closing and reopening the tab would otherwise recluster the whole vault
 * every time. The signature changes whenever the index or the settings that
 * shape the result change, which is the only time the answer can differ.
 */
export interface ClusterCache {
  signature: string;
  map: ClusterMap | null;
  /** Indexed notes left out by the exclude rules. */
  excluded: number;
  /** Indexed notes before exclusion. */
  total: number;
}

interface ViewDeps {
  store: VectorStore;
  settings: () => RicoPluginSettings;
  /**
   * Resolves once the vector index has finished loading from disk. Pass true to
   * read it again, for a recompute after the search module re-indexed.
   */
  ready: (fresh?: boolean) => Promise<void>;
  cache: ClusterCache;
}

/**
 * Every note in the vault, grouped by topic and drawn as clouds of dots.
 *
 * Read-only: it reads the semantic search index and never embeds anything or
 * writes to a note. Clicking a dot opens the note; clicking a cloud zooms to it.
 */
export class SemanticClusterView extends ItemView {
  private contextEl!: HTMLElement;
  private stageEl!: HTMLElement;
  private cardEl!: HTMLElement;
  private overlayEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private renderer!: ClusterRenderer;

  private map: ClusterMap | null = null;
  private layout: ClusterLayout | null = null;

  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private drag: { startX: number; startY: number; panX: number; panY: number } | null = null;
  /** Set while a drag actually moved, so letting go does not count as a click. */
  private dragMoved = false;

  private building: Promise<void> | null = null;
  /** True once the panel has had a real size, so the first run is not wasted. */
  private sized = false;
  /** Newer runs cancel older ones: only the latest may draw. */
  private runToken = 0;
  /** Counters for the diagnose command. */
  readonly debug = { onOpenCalls: 0, buildCalls: 0, lastError: "" };

  constructor(
    leaf: WorkspaceLeaf,
    private deps: ViewDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return SEMANTIC_CLUSTER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Semantic cluster";
  }

  getIcon(): string {
    return "network";
  }

  async onOpen(): Promise<void> {
    this.debug.onOpenCalls++;
    await this.ensureBuilt();
  }

  onResize(): void {
    void this.ensureBuilt();
  }

  /**
   * Build the panel if it is not there yet. Safe to call any number of times.
   *
   * Obsidian has been seen creating a view of this plugin without ever calling
   * onOpen, so the panel's existence is judged from the DOM, and anyone who
   * knows the view exists can ask for it to be built.
   */
  ensureBuilt(): Promise<void> {
    if (this.contentEl.hasClass("rico-sc")) return Promise.resolve();
    if (this.building) return this.building;
    this.building = (async () => {
      this.debug.buildCalls++;
      try {
        this.build();
      } catch (err) {
        console.error("[semantic-cluster] failed to open", err);
        const message = err instanceof Error ? err.message : String(err);
        this.debug.lastError = message;
        this.contentEl.empty();
        const box = this.contentEl.createDiv({ cls: "rico-sc-overlay is-error" });
        box.createDiv({ cls: "rico-sc-overlay-text", text: `Semantic cluster failed to open: ${message}` });
        new Notice(`Semantic cluster failed to open: ${message}`, 10000);
      } finally {
        this.building = null;
      }
    })();
    return this.building;
  }

  /**
   * Last resort for a view Obsidian created but never put on screen: hang its
   * element on the leaf by hand. Returns false when there is nothing to do.
   */
  attachToLeaf(): boolean {
    if (this.containerEl.isConnected) return false;
    const host = this.leaf.containerEl;
    if (!host?.isConnected) return false;
    this.containerEl.setAttribute("data-type", this.getViewType());
    host.appendChild(this.containerEl);
    console.warn(">>> semantic-cluster: attached the view to its leaf by hand");
    return this.containerEl.isConnected;
  }

  private build(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("rico-sc");

    const header = root.createDiv({ cls: "rico-sc-header" });
    // Always visible: if this shows, the panel is mounted, and anything blank
    // below it is a drawing problem rather than a panel one.
    header.createDiv({ cls: "rico-sc-title", text: "Semantic cluster" });
    this.contextEl = header.createDiv({ cls: "rico-sc-context" });
    const actions = header.createDiv({ cls: "rico-sc-actions" });
    this.iconButton(actions, "refresh-cw", "Recompute the clusters", () => void this.run(true));
    this.iconButton(actions, "maximize", "Fit to panel", () => this.fit());

    this.stageEl = root.createDiv({ cls: "rico-sc-stage" });
    this.renderer = new ClusterRenderer(this.stageEl);
    this.bindPointer();
    this.cardEl = this.stageEl.createDiv({ cls: "rico-sc-card is-hidden" });
    this.overlayEl = this.stageEl.createDiv({ cls: "rico-sc-overlay is-hidden" });
    this.statusEl = root.createDiv({ cls: "rico-sc-status" });

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        const { width, height } = this.stageEl.getBoundingClientRect();
        if (!width || !height) return;
        if (this.sized) {
          this.paint();
          return;
        }
        this.sized = true;
        void this.run(false);
      });
      observer.observe(this.stageEl);
      this.register(() => observer.disconnect());
    }
    // Do not rely on the observer alone: a stage that already has its size
    // never fires it.
    void this.run(false).catch((err) => this.reportError(err));
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): void {
    const button = parent.createEl("button", {
      cls: "rico-sc-icon-button",
      attr: { "aria-label": label, title: label },
    });
    setIcon(button, icon);
    button.addEventListener("click", onClick);
  }

  // --- interaction ---------------------------------------------------------

  private get transform(): ViewTransform {
    return { zoom: this.zoom, panX: this.panX, panY: this.panY };
  }

  private bindPointer(): void {
    // registerDomEvent is typed for HTML elements; an SVG element takes the
    // same listeners, it just is not declared as one.
    const el = this.renderer.el as unknown as HTMLElement;
    this.registerDomEvent(el, "wheel", (event: WheelEvent) => this.onWheel(event));
    this.registerDomEvent(el, "mousedown", (event: MouseEvent) => {
      this.dragMoved = false;
      this.drag = { startX: event.clientX, startY: event.clientY, panX: this.panX, panY: this.panY };
    });
    this.registerDomEvent(el, "mousemove", (event: MouseEvent) => this.onHover(event));
    this.registerDomEvent(el, "mouseleave", () => this.clearHover());
    this.registerDomEvent(el, "click", (event: MouseEvent) => this.onClick(event));
    // On the window, so a drag that leaves the panel still ends properly.
    this.registerDomEvent(window, "mousemove", (event: MouseEvent) => {
      if (!this.drag) return;
      const dx = event.clientX - this.drag.startX;
      const dy = event.clientY - this.drag.startY;
      // A few pixels of wobble should not swallow a click.
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.dragMoved = true;
      this.panX = this.drag.panX + dx;
      this.panY = this.drag.panY + dy;
      this.paint();
    });
    this.registerDomEvent(window, "mouseup", () => {
      this.drag = null;
    });
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    if (next === this.zoom) return;
    // Zoom towards the pointer, as every map-like control does.
    const rect = this.renderer.el.getBoundingClientRect();
    const px = event.clientX - rect.left - rect.width / 2;
    const py = event.clientY - rect.top - rect.height / 2;
    const ratio = next / this.zoom;
    this.panX = px - (px - this.panX) * ratio;
    this.panY = py - (py - this.panY) * ratio;
    this.zoom = next;
    this.paint();
  }

  /** The group and dot under the pointer, if any. */
  private under(event: MouseEvent): { cluster: number | null; dot: string | null } {
    if (!this.layout || !this.map) return { cluster: null, dot: null };
    const p = this.renderer.toGraph(event.clientX, event.clientY, this.transform);
    const dot = this.renderer.hitDot(p.x, p.y, this.zoom);
    const cluster = dot ? (this.map.of.get(dot) ?? null) : this.renderer.hitCluster(p.x, p.y);
    return { cluster, dot };
  }

  private onHover(event: MouseEvent): void {
    if (this.drag && this.dragMoved) return;
    const { cluster, dot } = this.under(event);
    this.renderer.setHover(cluster, dot);
    if (cluster === null || !this.map) {
      this.cardEl.addClass("is-hidden");
      return;
    }
    const group = this.map.clusters[cluster];
    this.cardEl.empty();
    this.cardEl.removeClass("is-hidden");
    this.cardEl.createDiv({ cls: "rico-sc-card-title", text: group.name });
    this.cardEl.createDiv({
      cls: "rico-sc-card-count",
      text: `${group.members.length} ${group.members.length === 1 ? "note" : "notes"}`,
    });
    if (dot) this.cardEl.createDiv({ cls: "rico-sc-card-path", text: dot });
    else if (group.subtitle) this.cardEl.createDiv({ cls: "rico-sc-card-path", text: group.subtitle });
  }

  private clearHover(): void {
    this.renderer.setHover(null, null);
    this.cardEl.addClass("is-hidden");
  }

  private onClick(event: MouseEvent): void {
    if (this.dragMoved) {
      this.dragMoved = false;
      return;
    }
    const { cluster, dot } = this.under(event);
    if (dot) void this.open(dot);
    else if (cluster !== null) this.zoomTo(cluster);
  }

  /** Open in a new tab: this view is itself a tab, so reusing the current leaf would replace it. */
  private async open(path: string): Promise<void> {
    const file = this.fileAt(path);
    if (!file) return;
    await this.app.workspace.getLeaf("tab").openFile(file);
  }

  /** Look a path up in the vault, surviving a bad one. */
  private fileAt(path: unknown): TFile | null {
    if (typeof path !== "string" || !path) return null;
    try {
      const file = this.app.vault.getAbstractFileByPath(path);
      return file instanceof TFile ? file : null;
    } catch (err) {
      console.error("[semantic-cluster] bad path", path, err);
      return null;
    }
  }

  // --- view ----------------------------------------------------------------

  private paint(): void {
    if (!this.renderer) return;
    const { width, height } = this.stageEl.getBoundingClientRect();
    this.renderer.setBadge(this.badgeText(width, height));
    if (!this.renderer.resize(width, height)) return;
    this.renderer.setTransform(this.transform, this.deps.settings().semanticClusterShowLabels);
  }

  private badgeText(width: number, height: number): string {
    if (!this.map) return `cluster area ${Math.round(width)}×${Math.round(height)}`;
    return `${this.map.of.size} notes · ${this.map.clusters.length} groups · zoom ${this.zoom.toFixed(2)}`;
  }

  /** Scale and centre the whole map. */
  private fit(): void {
    if (!this.layout || !this.layout.clusters.length) return;
    const { width, height } = this.stageEl.getBoundingClientRect();
    if (!width || !height) return;
    const box = this.layout.bounds;
    const scale = Math.min(
      (width - FIT_PADDING * 2) / Math.max(1, box.maxX - box.minX),
      (height - FIT_PADDING * 2) / Math.max(1, box.maxY - box.minY),
    );
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
    this.panX = (-(box.minX + box.maxX) / 2) * this.zoom;
    this.panY = (-(box.minY + box.maxY) / 2) * this.zoom;
    this.paint();
  }

  /** Zoom in on one group, leaving its neighbours at the edges. */
  private zoomTo(id: number): void {
    const group = this.layout?.clusters.find((c) => c.id === id);
    if (!group) return;
    const { width, height } = this.stageEl.getBoundingClientRect();
    if (!width || !height) return;
    const scale = Math.min(width, height) / (group.r * 2 + FIT_PADDING * 2);
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
    this.panX = -group.x * this.zoom;
    this.panY = -group.y * this.zoom;
    this.paint();
  }

  // --- data ----------------------------------------------------------------

  /** What shapes the answer; when this is unchanged, the last answer still holds. */
  private signature(settings: RicoPluginSettings, kept: { mtime: number }[]): string {
    let stamp = 0;
    for (const entry of kept) stamp += entry.mtime;
    return [
      kept.length,
      stamp,
      settings.semanticClusterCount,
      settings.semanticClusterMinSize,
      settings.semanticSearchExcludeFilter,
      settings.semanticClusterExclude,
      settings.noteToCanvasFolder,
      settings.quizFolderName,
      settings.semanticSearchModelPath,
    ].join("|");
  }

  /** Cluster the vault (or reuse the last result) and draw it. */
  async run(force = false): Promise<void> {
    const token = ++this.runToken;
    const settings = this.deps.settings();
    this.showLoading("Loading index…");

    try {
      await this.deps.ready(force);
      if (token !== this.runToken) return;

      const entries = this.deps.store.all();
      const skip = buildExcluder(settings);
      const kept = entries.filter((entry) => !skip(entry.path));
      const excluded = entries.length - kept.length;

      if (!entries.length) {
        this.showEmpty("Nothing indexed yet.", {
          icon: "database",
          action: { label: "Index vault", onClick: () => this.runIndexCommand() },
        });
        return;
      }
      if (!kept.length) {
        this.showEmpty("Every indexed note is excluded. Check the exclude settings.", {
          icon: "filter-x",
        });
        return;
      }

      const cache = this.deps.cache;
      const signature = this.signature(settings, kept);
      let map = !force && cache.signature === signature ? cache.map : null;

      if (!map) {
        this.showLoading(`Clustering ${kept.length} notes…`);
        map = await clusterVaultAsync(
          kept.map((entry) => ({ path: entry.path, vec: entry.vec, text: entry.text })),
          { k: settings.semanticClusterCount, minSize: settings.semanticClusterMinSize },
        );
        if (token !== this.runToken) return;
        cache.signature = signature;
        cache.map = map;
      }
      cache.excluded = excluded;
      cache.total = entries.length;

      this.map = map;
      this.layout = layoutClusters(map);
      this.renderer.build(map, this.layout);
      this.hideOverlay();
      this.fit();

      const parts = [
        `${map.of.size} notes`,
        `${map.clusters.length} groups`,
        `${excluded} excluded`,
      ];
      if (map.unusable) parts.push(`${map.unusable} without a vector`);
      this.contextEl.setText(parts.join(" · "));
      this.statusEl.setText(
        kept.length > LARGE_VAULT
          ? `${parts.join(" · ")} — a large vault, so panning may feel slow.`
          : parts.join(" · "),
      );
      if (force) new Notice(`Semantic cluster: ${map.clusters.length} groups from ${map.of.size} notes.`, 2500);
    } catch (err) {
      if (token !== this.runToken) return;
      this.reportError(err);
    }
  }

  private runIndexCommand(): void {
    new Notice("Indexing the vault. This can take a while.", 4000);
    const commands = (this.app as unknown as {
      commands?: { executeCommandById?: (id: string) => boolean };
    }).commands;
    if (!commands?.executeCommandById?.("rico-obsidian-plugin:semantic-search-index-vault")) {
      new Notice("Run “Semantic search: index vault” from the command palette.", 6000);
    }
  }

  // --- overlay -------------------------------------------------------------

  private showLoading(text: string): void {
    if (!this.overlayEl) return;
    this.overlayEl.empty();
    this.overlayEl.removeClass("is-hidden", "is-error");
    this.overlayEl.createDiv({ cls: "rico-sc-spinner" });
    this.overlayEl.createDiv({ cls: "rico-sc-overlay-text", text });
    this.statusEl?.setText(text);
  }

  private showEmpty(
    text: string,
    options: { icon?: string; error?: boolean; action?: { label: string; onClick: () => void } } = {},
  ): void {
    this.map = null;
    this.layout = null;
    if (!this.overlayEl) return;
    this.overlayEl.empty();
    this.overlayEl.removeClass("is-hidden");
    this.overlayEl.toggleClass("is-error", !!options.error);
    const icon = this.overlayEl.createDiv({ cls: "rico-sc-overlay-icon" });
    setIcon(icon, options.icon ?? (options.error ? "alert-triangle" : "network"));
    this.overlayEl.createDiv({ cls: "rico-sc-overlay-text", text });
    if (options.action) {
      const button = this.overlayEl.createEl("button", {
        cls: "rico-sc-overlay-button",
        text: options.action.label,
      });
      button.addEventListener("click", options.action.onClick);
    }
    this.statusEl?.setText(text);
  }

  private hideOverlay(): void {
    this.overlayEl?.addClass("is-hidden");
  }

  private reportError(err: unknown): void {
    console.error("[semantic-cluster] failed", err);
    const message = err instanceof Error ? err.message : String(err);
    this.debug.lastError = message;
    this.showEmpty(`Could not build the map: ${message}`, {
      error: true,
      action: { label: "Try again", onClick: () => void this.run(true) },
    });
  }

  async onClose(): Promise<void> {
    this.runToken++;
    this.sized = false;
    // The class is how ensureBuilt tells whether the panel exists.
    this.contentEl.removeClass("rico-sc");
  }
}
