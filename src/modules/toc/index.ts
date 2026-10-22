import { HeadingCache, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";
import type RicoObsidianPlugin from "../../main";
import { leafId } from "../../shared/lib/leaf-id";

const COLLAPSE_STORAGE_KEY = "rico-toc-collapsed";

interface TocPanelState {
  panelEl: HTMLElement;
  listEl: HTMLElement;
  toggleEl: HTMLElement;
  headings: HeadingCache[];
  activeIndex: number;
  scrollHandler: () => void;
  scrollTarget: HTMLElement;
}

/**
 * Floating / sticky Table of Contents for the active note.
 * Renders a small fixed panel over the note's content area (per markdown leaf)
 * listing its headings, highlighting the section currently in view, and
 * jumping to a heading on click (works in both source and reading mode).
 */
export class TocManager {
  private plugin: RicoObsidianPlugin;
  private panels: Map<string, TocPanelState> = new Map();
  private refreshQueued = false;

  constructor(plugin: RicoObsidianPlugin) {
    this.plugin = plugin;
  }

  init(): void {
    const { plugin } = this;

    plugin.registerEvent(
      plugin.app.workspace.on("active-leaf-change", () => this.scheduleRefresh())
    );
    plugin.registerEvent(
      plugin.app.workspace.on("layout-change", () => this.scheduleRefresh())
    );
    plugin.registerEvent(
      plugin.app.workspace.on("file-open", () => this.scheduleRefresh())
    );
    plugin.registerEvent(
      plugin.app.metadataCache.on("changed", (file) => {
        for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) {
          const view = leaf.view as MarkdownView;
          if (view.file === file) this.refreshLeaf(leaf);
        }
      })
    );

    plugin.addCommand({
      id: "toggle-table-of-contents",
      name: "Toggle floating table of contents",
      callback: () => this.toggleCollapsedForActive(),
    });

    plugin.app.workspace.onLayoutReady(() => this.scheduleRefresh());
  }

  destroy(): void {
    for (const [id] of this.panels) {
      this.removePanel(id);
    }
    this.panels.clear();
  }

  private scheduleRefresh(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    setTimeout(() => {
      this.refreshQueued = false;
      this.refreshAll();
    }, 50);
  }

  private refreshAll(): void {
    if (!this.plugin.settings.enableTableOfContents) return;

    const liveLeafIds = new Set<string>();
    for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) {
      liveLeafIds.add(leafId(leaf));
      this.refreshLeaf(leaf);
    }

    for (const id of Array.from(this.panels.keys())) {
      if (!liveLeafIds.has(id)) this.removePanel(id);
    }
  }

  private refreshLeaf(leaf: WorkspaceLeaf): void {
    const view = leaf.view as MarkdownView;
    const file = view?.file as TFile | null;
    const headings = file
      ? this.plugin.app.metadataCache.getFileCache(file)?.headings ?? []
      : [];

    if (!file || headings.length === 0) {
      this.removePanel(leafId(leaf));
      return;
    }

    let state = this.panels.get(leafId(leaf));
    if (!state) {
      state = this.createPanel(leaf);
      this.panels.set(leafId(leaf), state);
    }
    state.headings = headings;
    this.renderList(leaf, state);
    this.updateActiveHeading(leaf, state);
  }

  private createPanel(leaf: WorkspaceLeaf): TocPanelState {
    const view = leaf.view as MarkdownView;
    const host = view.containerEl;
    host.addClass("rico-toc-host");

    const panelEl = host.createEl("div", { cls: "rico-toc-panel" });
    const headerEl = panelEl.createEl("div", { cls: "rico-toc-header" });
    headerEl.createEl("span", { cls: "rico-toc-title", text: "Contents" });
    const toggleEl = headerEl.createEl("span", { cls: "rico-toc-toggle" });
    const listEl = panelEl.createEl("div", { cls: "rico-toc-list" });

    const collapsed = localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1";
    panelEl.toggleClass("rico-toc-collapsed", collapsed);
    toggleEl.setText(collapsed ? "▸" : "▾");

    headerEl.addEventListener("click", () => {
      const nowCollapsed = !panelEl.hasClass("rico-toc-collapsed");
      panelEl.toggleClass("rico-toc-collapsed", nowCollapsed);
      toggleEl.setText(nowCollapsed ? "▸" : "▾");
      localStorage.setItem(COLLAPSE_STORAGE_KEY, nowCollapsed ? "1" : "0");
    });

    const scrollTarget = view.contentEl;
    const scrollHandler = () => {
      const state = this.panels.get(leafId(leaf));
      if (state) this.updateActiveHeading(leaf, state);
    };
    scrollTarget.addEventListener("scroll", scrollHandler, {
      capture: true,
      passive: true,
    });

    return {
      panelEl,
      listEl,
      toggleEl,
      headings: [],
      activeIndex: -1,
      scrollHandler,
      scrollTarget,
    };
  }

  private renderList(leaf: WorkspaceLeaf, state: TocPanelState): void {
    const view = leaf.view as MarkdownView;
    state.listEl.empty();

    state.headings.forEach((heading, index) => {
      const level = Math.min(heading.level, 6);
      const itemEl = state.listEl.createEl("div", {
        cls: `rico-toc-item rico-toc-level-${level}`,
        attr: { "data-index": String(index) },
      });
      for (let i = 1; i < level; i++) {
        itemEl.createEl("span", { cls: "rico-toc-guide" });
      }
      itemEl.createEl("span", { cls: "rico-toc-label", text: heading.heading });
      itemEl.addEventListener("click", () => {
        const mode = view.currentMode as { applyScroll?: (line: number) => void };
        mode?.applyScroll?.(heading.position.start.line);
        view.editor?.setCursor?.({ line: heading.position.start.line, ch: 0 });
      });
    });
  }

  private updateActiveHeading(leaf: WorkspaceLeaf, state: TocPanelState): void {
    const view = leaf.view as MarkdownView;
    const mode = view.currentMode as { getScroll?: () => number };
    const currentLine = mode?.getScroll?.() ?? 0;

    let activeIndex = -1;
    for (let i = 0; i < state.headings.length; i++) {
      if (state.headings[i].position.start.line <= currentLine + 1) {
        activeIndex = i;
      } else {
        break;
      }
    }

    if (activeIndex === state.activeIndex) return;
    state.activeIndex = activeIndex;

    const items = state.listEl.querySelectorAll<HTMLElement>(".rico-toc-item");
    items.forEach((el, i) => el.toggleClass("rico-toc-item-active", i === activeIndex));
  }

  private removePanel(leafId: string): void {
    const state = this.panels.get(leafId);
    if (!state) return;
    state.scrollTarget.removeEventListener("scroll", state.scrollHandler, {
      capture: true,
    } as EventListenerOptions);
    state.panelEl.remove();
    this.panels.delete(leafId);
  }

  private toggleCollapsedForActive(): void {
    const leaf = this.plugin.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
    if (!leaf) return;
    const state = this.panels.get(leafId(leaf));
    if (!state) return;
    const collapsed = !state.panelEl.hasClass("rico-toc-collapsed");
    state.panelEl.toggleClass("rico-toc-collapsed", collapsed);
    state.toggleEl.setText(collapsed ? "▸" : "▾");
    localStorage.setItem(COLLAPSE_STORAGE_KEY, collapsed ? "1" : "0");
  }
}
