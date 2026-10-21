import { ItemView, Menu, Notice, Plugin, setIcon } from "obsidian";
import type RicoObsidianPlugin from "../../../main";
import { DropCanvas, ensureCardMenuButton, ensureDropZone, removeCardMenuButtons } from "./card-menu";
import { syncRail } from "../tool-rail";
import { RoadmapCanvasNode, readRoadmapData, saveRoadmapData } from "./logic";
import { RoadmapNodeModal } from "./modal";
import { ROADMAP_PANEL_VIEW_TYPE, RoadmapArticleView, openRoadmapPanel, refreshPanelsFor } from "./panel";
import { clearRoadmapCard, renderRoadmapCard } from "./render";
import {
  PICKABLE_STATUSES,
  ROADMAP_NODE_SIZE,
  ROADMAP_NODE_TYPE,
  RoadmapNodeData,
  RoadmapStatus,
  STATUS_META,
} from "./types";

/** Loose typing for the private canvas object; we only touch what we use. */
interface RoadmapCanvas extends DropCanvas {
  nodes?: Map<string, RoadmapCanvasNode>;
  canvasEl?: HTMLElement;
  wrapperEl?: HTMLElement;
  requestSave?: () => void;
  getViewportBBox?: () => { minX: number; maxX: number; minY: number; maxY: number };
  createTextNode?: (opts: { pos: { x: number; y: number }; size: { width: number; height: number }; text: string; focus: boolean }) => RoadmapCanvasNode;
  _roadmapHooked?: boolean;
}

function isRoadmapNode(node?: RoadmapCanvasNode): boolean {
  return node?.getData?.()?.customNodeType === ROADMAP_NODE_TYPE;
}

/**
 * roadmap.sh-style cards on canvas.
 *
 * A card is a normal text node carrying `customNodeType: "roadmap-node"` in its
 * data, the same approach `og-link` uses — so a `.canvas` file still opens
 * cleanly in vanilla Obsidian, the card just shows as an empty text card.
 */
export class RoadmapNodeManager {
  private plugin: RicoObsidianPlugin;
  /** Wrappers that already listen for our drops, so each is wired once. */
  private dropZones = new WeakSet<HTMLElement>();
  /** Obsidian rebuilds the card menu, so watch the DOM and re-add our button. */
  private menuObserver: MutationObserver | null = null;
  /** Pending throttled hook pass, if any. */
  private hookFrame: number | null = null;

  constructor(plugin: RicoObsidianPlugin) {
    this.plugin = plugin;
  }

  private get app() {
    return this.plugin.app;
  }

  private get enabled(): boolean {
    return this.plugin.settings.enableCanvasRoadmapNode;
  }

  init(): void {
    const { plugin } = this;

    plugin.registerView(
      ROADMAP_PANEL_VIEW_TYPE,
      (leaf) => new RoadmapArticleView(leaf, (node) => this.redraw(node))
    );

    plugin.addCommand({
      id: "add-roadmap-node",
      name: "Add roadmap node",
      checkCallback: (checking) => {
        if (!this.enabled) return false;
        const canvas = this.getActiveCanvas();
        if (!canvas) return false;
        if (!checking) this.showCreateModal(canvas);
        return true;
      },
    });

    plugin.addCommand({
      id: "open-roadmap-panel",
      name: "Open roadmap article panel",
      checkCallback: (checking) => {
        if (!this.enabled) return false;
        if (!checking) {
          const leaf = this.app.workspace.getLeavesOfType(ROADMAP_PANEL_VIEW_TYPE)[0];
          if (leaf) void this.app.workspace.revealLeaf(leaf);
          else new Notice("Click a roadmap card on a canvas to open the panel.");
        }
        return true;
      },
    });

    // Node right-click menu.
    plugin.registerEvent(
      this.app.workspace.on(
        "canvas:node-menu" as never,
        ((menu: Menu, node: RoadmapCanvasNode) => {
          if (!this.enabled) return;
          this.buildNodeMenu(menu, node);
        }) as never
      )
    );

    // Redraw hooks, mirroring og-link.
    plugin.registerEvent(
      this.app.workspace.on(
        "advanced-canvas:node-added" as never,
        ((_canvas: RoadmapCanvas, node: RoadmapCanvasNode) => {
          if (this.enabled && isRoadmapNode(node)) this.draw(node);
        }) as never
      )
    );

    plugin.registerEvent(
      this.app.workspace.on(
        "advanced-canvas:node-editing-state-changed" as never,
        ((_canvas: RoadmapCanvas, node: RoadmapCanvasNode, editing: boolean) => {
          if (!editing && this.enabled && isRoadmapNode(node)) this.draw(node);
        }) as never
      )
    );

    this.app.workspace.onLayoutReady(() => this.hookOpenCanvases());
    plugin.registerEvent(this.app.workspace.on("layout-change", () => this.hookOpenCanvases()));

    // The card menu is re-created on the fly; put our drag button back when it is.
    // The observer watches the whole body, so coalesce bursts into one pass a frame.
    this.menuObserver = new MutationObserver(() => this.scheduleHook());
    this.menuObserver.observe(document.body, { childList: true, subtree: true });
    plugin.register(() => {
      this.menuObserver?.disconnect();
      this.menuObserver = null;
      if (this.hookFrame !== null) cancelAnimationFrame(this.hookFrame);
      this.hookFrame = null;
      removeCardMenuButtons();
    });
    window.setTimeout(() => this.hookOpenCanvases(), 300);
  }

  // ---- Drawing ----

  /** Draw a card, wiring its controls back to this manager. */
  private draw(node: RoadmapCanvasNode): void {
    requestAnimationFrame(() =>
      renderRoadmapCard(node, {
        onStatusChange: (n) => refreshPanelsFor(this.app, n),
        onOpen: (n) => void openRoadmapPanel(this.app, n),
        onEdit: (n) => this.showEditModal(n),
      })
    );
  }

  /** The edit form, shared by the card's pencil button, right-click, and the menu. */
  private showEditModal(node: RoadmapCanvasNode): void {
    const data = readRoadmapData(node);
    if (!data) return;
    new RoadmapNodeModal(
      this.app,
      data,
      (result) => {
        saveRoadmapData(node, { ...result });
        this.draw(node);
        refreshPanelsFor(this.app, node);
      },
      true
    ).open();
  }

  /** Redraw after a change made somewhere else (the panel's status buttons). */
  private redraw(node: RoadmapCanvasNode): void {
    this.draw(node);
  }

  /** Coalesce a burst of DOM mutations into a single pass on the next frame. */
  private scheduleHook(): void {
    if (this.hookFrame !== null) return;
    this.hookFrame = requestAnimationFrame(() => {
      this.hookFrame = null;
      this.hookOpenCanvases();
    });
  }

  private hookOpenCanvases(): void {
    if (!this.enabled) {
      removeCardMenuButtons();
      return;
    }
    for (const leaf of this.app.workspace.getLeavesOfType("canvas")) {
      const view = leaf.view as unknown as { canvas?: RoadmapCanvas; containerEl?: HTMLElement };
      const canvas = view?.canvas;
      if (!canvas) continue;

      // Drag source on the shared left-edge rail.
      ensureCardMenuButton();

      // The canvas itself accepts the drop.
      const wrapper =
        view.containerEl?.querySelector(".canvas-wrapper") ?? view.containerEl ?? null;
      if (wrapper instanceof HTMLElement) {
        syncRail(wrapper);
        ensureDropZone(wrapper, canvas, this.dropZones, (target, pos) =>
          this.showCreateModal(target as RoadmapCanvas, undefined, pos)
        );
      }

      // First sight of this canvas: draw the cards it already holds, then let
      // the observer handle nodes as they come and go.
      if (canvas._roadmapHooked) continue;
      canvas._roadmapHooked = true;
      this.scanCanvas(canvas);
      this.observeCanvas(canvas);
    }
  }

  private scanCanvas(canvas: RoadmapCanvas): void {
    canvas.nodes?.forEach((node) => {
      if (isRoadmapNode(node)) this.draw(node);
    });
  }

  /** Canvas recycles node elements as you pan; redraw whatever reappears. */
  private observeCanvas(canvas: RoadmapCanvas): void {
    const canvasEl = canvas.canvasEl ?? canvas.wrapperEl;
    if (!canvasEl) return;

    const observer = new MutationObserver((mutations) => {
      if (!this.enabled) return;
      for (const m of mutations) {
        for (const added of Array.from(m.addedNodes)) {
          if (!(added instanceof HTMLElement)) continue;
          const candidates: Element[] = added.classList.contains("canvas-node")
            ? [added]
            : Array.from(added.querySelectorAll(".canvas-node"));
          if (candidates.length === 0) continue;
          canvas.nodes?.forEach((node) => {
            if (node.nodeEl && candidates.includes(node.nodeEl) && isRoadmapNode(node)) {
              this.draw(node);
            }
          });
        }
      }
    });

    observer.observe(canvasEl, { childList: true, subtree: true });
    this.plugin.register(() => observer.disconnect());
  }

  // ---- Menu ----

  private buildNodeMenu(menu: Menu, node: RoadmapCanvasNode): void {
    const data = readRoadmapData(node);

    if (!data) {
      menu.addItem((item) =>
        item
          .setTitle("Make roadmap node")
          .setIcon("map")
          .onClick(() => this.showCreateModal(undefined, node))
      );
      return;
    }

    menu.addItem((item) =>
      item
        .setTitle("Open article")
        .setIcon("book-open")
        .onClick(() => void openRoadmapPanel(this.app, node))
    );

    for (const status of PICKABLE_STATUSES) {
      const meta = STATUS_META[status];
      menu.addItem((item) =>
        item
          .setTitle(data.status === status ? `${meta.label} ✓` : `Mark as ${meta.label}`)
          .setIcon(meta.icon)
          .onClick(() => this.setStatus(node, data.status === status ? "none" : status))
      );
    }

    menu.addItem((item) =>
      item
        .setTitle("Edit roadmap node")
        .setIcon("pencil")
        .onClick(() => this.showEditModal(node))
    );

    menu.addItem((item) =>
      item
        .setTitle("Convert to plain card")
        .setIcon("rotate-ccw")
        .onClick(() => {
          const existing = node.getData?.() ?? {};
          const { roadmapData: _drop, ...rest } = existing as Record<string, unknown>;
          node.setData?.({ ...rest, customNodeType: undefined, type: "text", text: data.title });
          node.canvas?.requestSave?.();
          clearRoadmapCard(node);
        })
    );
  }

  private setStatus(node: RoadmapCanvasNode, status: RoadmapStatus): void {
    const data = readRoadmapData(node);
    if (!data) return;
    saveRoadmapData(node, { ...data, status });
    this.draw(node);
    refreshPanelsFor(this.app, node);
  }

  // ---- Creating ----

  private getActiveCanvas(): RoadmapCanvas | undefined {
    const view = this.app.workspace.getActiveViewOfType(ItemView);
    if (!view || view.getViewType() !== "canvas") return undefined;
    return (view as unknown as { canvas?: RoadmapCanvas }).canvas;
  }

  /**
   * Create a new card, or convert `existingNode` into one.
   * `pos` places the card explicitly (a drag-and-drop); without it the card
   * lands in the middle of the current viewport.
   */
  private showCreateModal(
    canvas?: RoadmapCanvas,
    existingNode?: RoadmapCanvasNode,
    pos?: { x: number; y: number }
  ): void {
    const target = canvas ?? this.getActiveCanvas();
    if (!target && !existingNode) {
      new Notice("Open a canvas first.");
      return;
    }

    const defaultStatus = this.plugin.settings.roadmapNodeDefaultStatus as RoadmapStatus;
    const seed: Partial<RoadmapNodeData> = {
      status: STATUS_META[defaultStatus] ? defaultStatus : "none",
      title: typeof existingNode?.getData?.().text === "string" ? String(existingNode.getData?.().text).trim() : "",
    };

    new RoadmapNodeModal(this.app, seed, (result) => {
      const data: RoadmapNodeData = { ...result };
      if (existingNode) {
        saveRoadmapData(existingNode, data);
        this.draw(existingNode);
        return;
      }
      const node = this.createNode(target as RoadmapCanvas, data, pos);
      if (node) this.draw(node);
    }).open();
  }

  private createNode(
    canvas: RoadmapCanvas,
    data: RoadmapNodeData,
    at?: { x: number; y: number }
  ): RoadmapCanvasNode | undefined {
    let pos = at ?? { x: 0, y: 0 };
    if (!at) {
      try {
        const bbox = canvas.getViewportBBox?.();
        if (bbox) {
          pos = {
            x: Math.round((bbox.minX + bbox.maxX) / 2 - ROADMAP_NODE_SIZE.width / 2),
            y: Math.round((bbox.minY + bbox.maxY) / 2 - ROADMAP_NODE_SIZE.height / 2),
          };
        }
      } catch {
        /* centre of the world is a fine fallback */
      }
    }

    const node = canvas.createTextNode?.({
      pos,
      size: ROADMAP_NODE_SIZE,
      text: "",
      focus: false,
    });
    if (!node) {
      new Notice("This canvas does not allow creating cards here.");
      return undefined;
    }
    saveRoadmapData(node, data);
    return node;
  }
}

/** Registered from main.tsx; the handlers check the setting so the toggle applies live. */
export function registerCanvasRoadmapNode(plugin: RicoObsidianPlugin): void {
  new RoadmapNodeManager(plugin).init();
}
