import { ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type { VectorStore } from "../semantic-search/store";
import type { RicoPluginSettings } from "../../types";
import type { ClusterMap, ClusterNote } from "./cluster-all";
import {
  MIN_DRILL_SIZE,
  buildLevel,
  canDrill,
  formatCrumbs,
  levelCrumbs,
  notesOf,
  truncateTo,
  type Level,
} from "./drill";
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
/** The most groups the control will ask for. */
const MAX_GROUPS = 40;

/**
 * What earlier runs produced, kept outside the view.
 *
 * Closing and reopening the tab, or climbing back up the breadcrumb, would
 * otherwise recluster the same notes again. Each entry is keyed by the notes
 * and the group count it was made for; the signature changes whenever the
 * index or the settings that shape the result change, which empties the lot.
 */
export interface ClusterCache {
  signature: string;
  maps: Map<string, ClusterMap>;
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
  /** Persist settings; the top level's group count is remembered between sessions. */
  save: () => Promise<void>;
  cache: ClusterCache;
}

/**
 * Every note in the vault, grouped by topic and drawn as clouds of dots.
 *
 * Read-only: it reads the semantic search index and never embeds anything or
 * writes to a note. Clicking a dot opens the note; clicking a cloud goes inside
 * it and splits its notes again, as many ways as the control above the map says.
 * Shift-click only moves the camera.
 */
export class SemanticClusterView extends ItemView {
  private contextEl!: HTMLElement;
  private stageEl!: HTMLElement;
  private cardEl!: HTMLElement;
  private overlayEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private crumbsEl!: HTMLElement;
  private inputEl!: HTMLInputElement;
  private autoEl!: HTMLButtonElement;
  private upEl!: HTMLButtonElement;
  private renderer!: ClusterRenderer;

  /** Where the user has gone: the whole vault first, then each group entered. */
  private levels: Level[] = [];
  private map: ClusterMap | null = null;
  private layout: ClusterLayout | null = null;
  /** Indexed notes the exclude rules left out, for the status line. */
  private excluded = 0;

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
    this.upEl = this.iconButton(actions, "arrow-left", "Up one level (Esc)", () => this.up());
    this.iconButton(actions, "refresh-cw", "Re-read the index and start again from the top", () => void this.run(true));
    this.iconButton(actions, "maximize", "Fit to panel", () => this.fit());

    // Where you are (clickable) on the left, how many groups to split into on the right.
    const bar = root.createDiv({ cls: "rico-sc-bar" });
    this.crumbsEl = bar.createDiv({ cls: "rico-sc-crumbs" });
    const control = bar.createDiv({ cls: "rico-sc-control" });
    control.createSpan({ cls: "rico-sc-control-label", text: "Clusters" });
    this.inputEl = control.createEl("input", {
      cls: "rico-sc-control-input",
      attr: { type: "number", min: "1", max: String(MAX_GROUPS), step: "1", "aria-label": "Number of clusters" },
    });
    // "change" fires on Enter, on blur and on the spinner arrows alike.
    this.inputEl.addEventListener("change", () => this.commitInput());
    this.autoEl = control.createEl("button", {
      cls: "rico-sc-control-auto",
      text: "Auto",
      attr: { title: "Let the plugin choose how many clusters" },
    });
    this.autoEl.addEventListener("click", () => void this.setRequested(0));

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

  private iconButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "rico-sc-icon-button",
      attr: { "aria-label": label, title: label },
    });
    setIcon(button, icon);
    button.addEventListener("click", onClick);
    return button;
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
    // Esc goes up a level, but not while typing a number in the control.
    this.registerDomEvent(this.contentEl, "keydown", (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if ((event.target as HTMLElement | null)?.tagName === "INPUT") return;
      this.up();
    });
    // A stage that can take focus is what lets the keyboard reach this view.
    this.stageEl.tabIndex = 0;
    this.registerDomEvent(el, "mousedown", () => this.stageEl.focus({ preventScroll: true }));
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
    if (dot) {
      void this.open(dot);
      return;
    }
    if (cluster === null) return;
    // Shift keeps the old behaviour: just bring the camera closer.
    if (event.shiftKey || (this.map?.clusters.length ?? 0) <= 1) this.zoomTo(cluster);
    else void this.drillInto(cluster);
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

  /** What shapes the answer; when this is unchanged, earlier answers still hold. */
  private signature(settings: RicoPluginSettings, kept: { mtime: number }[]): string {
    let stamp = 0;
    for (const entry of kept) stamp += entry.mtime;
    return [
      kept.length,
      stamp,
      settings.semanticClusterMinSize,
      settings.semanticSearchExcludeFilter,
      settings.semanticClusterExclude,
      settings.noteToCanvasFolder,
      settings.quizFolderName,
      settings.semanticSearchModelPath,
    ].join("|");
  }

  private makeLevel(name: string, notes: ClusterNote[], requested: number): Promise<Level> {
    return buildLevel(
      name,
      notes,
      requested,
      { minSize: this.deps.settings().semanticClusterMinSize },
      this.deps.cache.maps,
    );
  }

  /** Re-read the index, cluster the whole vault and show the top level. */
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

      // A changed index or changed rules make every earlier answer suspect.
      const cache = this.deps.cache;
      const signature = this.signature(settings, kept);
      if (force || cache.signature !== signature) {
        cache.maps.clear();
        cache.signature = signature;
      }
      cache.excluded = excluded;
      cache.total = entries.length;
      this.excluded = excluded;

      this.showLoading(`Clustering ${kept.length} notes…`);
      const root = await this.makeLevel(
        "All notes",
        kept.map((entry) => ({ path: entry.path, vec: entry.vec, text: entry.text })),
        settings.semanticClusterCount,
      );
      if (token !== this.runToken) return;

      this.levels = [root];
      this.showLevel();
      if (force) {
        new Notice(
          `Semantic cluster: ${root.map.clusters.length} groups from ${root.map.of.size} notes.`,
          2500,
        );
      }
    } catch (err) {
      if (token !== this.runToken) return;
      this.reportError(err);
    }
  }

  // --- levels --------------------------------------------------------------

  private get current(): Level | null {
    return this.levels[this.levels.length - 1] ?? null;
  }

  /** Lay out and draw the level the user is on, and bring the bar up to date. */
  private showLevel(): void {
    const level = this.current;
    if (!level) return;
    const map = level.map;

    this.map = map;
    this.layout = layoutClusters(map);
    // One cloud means the notes themselves are on screen, so each dot gets its title.
    this.renderer.build(map, this.layout, { dotLabels: map.clusters.length === 1 });
    this.hideOverlay();
    this.fit();
    this.renderBar();

    const groups = map.clusters.length;
    const parts = [`${map.of.size} notes`, `${groups} ${groups === 1 ? "group" : "groups"}`];
    if (this.levels.length === 1) parts.push(`${this.excluded} excluded`);
    if (map.unusable) parts.push(`${map.unusable} without a vector`);
    const text = parts.join(" · ");
    this.contextEl.setText(text);
    this.statusEl.setText(
      level.notes.length > LARGE_VAULT ? `${text} — a large vault, so panning may feel slow.` : text,
    );
  }

  /** Breadcrumb on the left, group-count control on the right, back button state. */
  private renderBar(): void {
    if (!this.crumbsEl) return;
    this.crumbsEl.empty();
    const crumbs = levelCrumbs(this.levels);
    crumbs.forEach((crumb, i) => {
      if (i > 0) this.crumbsEl.createSpan({ cls: "rico-sc-crumb-sep", text: "›" });
      const target = crumb.level;
      if (target === null) {
        this.crumbsEl.createSpan({ cls: "rico-sc-crumb is-current", text: crumb.label });
        return;
      }
      const link = this.crumbsEl.createEl("button", {
        cls: "rico-sc-crumb",
        text: crumb.label,
        attr: { title: "Go back to this level" },
      });
      link.addEventListener("click", () => this.goTo(target));
    });
    this.crumbsEl.setAttribute("title", formatCrumbs(this.levels));

    const level = this.current;
    if (level) {
      // Empty means automatic; the placeholder shows what that came to.
      this.inputEl.value = level.requested > 0 ? String(level.requested) : "";
      this.inputEl.placeholder = String(level.map.clusters.length);
      this.autoEl.toggleClass("is-active", level.requested === 0);
    }
    this.upEl.disabled = this.levels.length <= 1;
  }

  /** Read the number box: a number sets the count, an empty box means automatic. */
  private commitInput(): void {
    const raw = this.inputEl.value.trim();
    if (!raw) {
      void this.setRequested(0);
      return;
    }
    const parsed = Math.floor(Number(raw));
    if (!Number.isFinite(parsed) || parsed < 1) {
      this.renderBar();
      return;
    }
    void this.setRequested(Math.min(MAX_GROUPS, parsed));
  }

  /** Split the level on screen into `requested` groups (0 = choose for me). */
  private async setRequested(requested: number): Promise<void> {
    const level = this.current;
    if (!level) return;
    if (requested === level.requested) {
      this.renderBar();
      return;
    }

    const token = ++this.runToken;
    this.showLoading(`Clustering ${level.notes.length} notes…`);
    try {
      const next = await this.makeLevel(level.name, level.notes, requested);
      if (token !== this.runToken) return;
      // Only this level changes; anything entered beneath it no longer applies.
      this.levels[this.levels.length - 1] = next;
      // The top level's choice is remembered, so reopening the tab keeps it.
      if (this.levels.length === 1) {
        this.deps.settings().semanticClusterCount = requested;
        await this.deps.save();
      }
      this.showLevel();
    } catch (err) {
      if (token !== this.runToken) return;
      this.reportError(err);
    }
  }

  /** Go inside a group and split its notes again. */
  private async drillInto(clusterId: number): Promise<void> {
    const level = this.current;
    const group = level?.map.clusters[clusterId];
    if (!level || !group) return;
    if (!canDrill(group.members.length)) {
      new Notice(
        `“${group.name}” has ${group.members.length} notes, too few to split (it needs ${MIN_DRILL_SIZE}). Click a dot to open one.`,
        4000,
      );
      return;
    }

    const token = ++this.runToken;
    this.showLoading(`Clustering ${group.members.length} notes…`);
    try {
      const next = await this.makeLevel(group.name, notesOf(level, clusterId), 0);
      if (token !== this.runToken) return;
      this.levels.push(next);
      this.showLevel();
    } catch (err) {
      if (token !== this.runToken) return;
      this.reportError(err);
    }
  }

  /** Climb back to the level at `index`, dropping everything deeper. */
  private goTo(index: number): void {
    if (index >= this.levels.length - 1) return;
    // Cancels any split still being computed for a level that is about to go.
    this.runToken++;
    this.levels = truncateTo(this.levels, index);
    this.showLevel();
  }

  private up(): void {
    if (this.levels.length > 1) this.goTo(this.levels.length - 2);
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
