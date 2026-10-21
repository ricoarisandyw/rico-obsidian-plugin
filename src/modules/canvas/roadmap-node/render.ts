import { setIcon } from "obsidian";
import { RoadmapCanvasNode, cycleStatus, displayTitle, readRoadmapData, saveRoadmapData } from "./logic";
import { STATUS_META } from "./types";

/** Called when the user clicks the dot, so the manager can refresh any open panel. */
export type StatusChangeHandler = (node: RoadmapCanvasNode) => void;
/** Called when the user clicks the card body. */
export type CardClickHandler = (node: RoadmapCanvasNode) => void;

interface RenderHandlers {
  onStatusChange?: StatusChangeHandler;
  onOpen?: CardClickHandler;
  /** Open the edit form. Wired to the pencil button and to right-click. */
  onEdit?: CardClickHandler;
}

/** Element we hang our observer on, so one node is never watched twice. */
type ObservedEl = HTMLElement & { _roadmapObserver?: MutationObserver };

/**
 * Draw the card into the node's content element.
 * Obsidian rebuilds `.canvas-node-content` on its own schedule, so this is
 * idempotent: it clears whatever is there and redraws from the node's data.
 */
export function renderRoadmapCard(node: RoadmapCanvasNode, handlers: RenderHandlers = {}): void {
  const data = readRoadmapData(node);
  const nodeEl = node.nodeEl;
  if (!data || !nodeEl) return;

  const contentEl = nodeEl.querySelector(".canvas-node-content") as HTMLElement | null;
  if (!contentEl) return;

  contentEl.empty();
  nodeEl.addClass("rico-roadmap-node");

  const meta = STATUS_META[data.status];
  const card = contentEl.createDiv({ cls: `rico-roadmap-card ${meta.cls}` });

  const main = card.createDiv({ cls: "rico-roadmap-main" });

  // Title row: the status dot sits to the left of the title.
  const titleRow = main.createDiv({ cls: "rico-roadmap-title-row" });
  const dot = titleRow.createEl("button", {
    cls: `rico-roadmap-dot ${meta.cls}`,
    attr: { "aria-label": `Status: ${meta.label}`, title: `${meta.label} — click to change`, type: "button" },
  });
  setIcon(dot, meta.icon);
  stopCanvasDrag(dot);
  dot.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    const current = readRoadmapData(node);
    if (!current) return;
    saveRoadmapData(node, { ...current, status: cycleStatus(current.status) });
    renderRoadmapCard(node, handlers);
    handlers.onStatusChange?.(node);
  });
  titleRow.createDiv({ cls: "rico-roadmap-title", text: displayTitle(data) });

  const footer = main.createDiv({ cls: "rico-roadmap-footer" });
  if (data.articlePath) {
    const article = footer.createSpan({ cls: "rico-roadmap-article" });
    setIcon(article.createSpan({ cls: "rico-roadmap-article-icon" }), "file-text");
    article.createSpan({ text: basename(data.articlePath) });
  }
  if (data.links.length > 0) {
    footer.createSpan({
      cls: "rico-roadmap-linkcount",
      text: `${data.links.length} link${data.links.length === 1 ? "" : "s"}`,
    });
  }

  // Edit button, alone in the top-right corner.
  if (handlers.onEdit) {
    const edit = card.createEl("button", {
      cls: "rico-roadmap-edit",
      attr: { "aria-label": "Edit roadmap node", title: "Edit roadmap node", type: "button" },
    });
    setIcon(edit, "pencil");
    stopCanvasDrag(edit);
    edit.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      handlers.onEdit?.(node);
    });
  }

  // Left-click the body to open the article panel. Canvas keeps handling
  // selection and dragging, so we only act when the pointer did not move.
  // Right-click is left alone so the context menu can appear.
  if (handlers.onOpen) {
    let downAt: { x: number; y: number } | null = null;
    main.addEventListener("pointerdown", (e) => {
      downAt = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    });
    main.addEventListener("pointerup", (e) => {
      if (!downAt || e.button !== 0) return;
      const moved = Math.abs(e.clientX - downAt.x) + Math.abs(e.clientY - downAt.y);
      downAt = null;
      if (moved > 4) return;
      handlers.onOpen?.(node);
    });
  }

  // Right-click the card to edit. Obsidian's own "canvas:node-menu" event comes
  // from the Advanced Canvas plugin, so without it there would be no way in.
  if (handlers.onEdit) {
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handlers.onEdit?.(node);
    });
  }

  // Our card is the content; double-click must not drop the node into text editing.
  contentEl.addEventListener("dblclick", (e) => e.stopPropagation(), { capture: true });

  // Obsidian sometimes wipes the content element; redraw when it does.
  const observed = contentEl as ObservedEl;
  if (!observed._roadmapObserver) {
    observed._roadmapObserver = new MutationObserver(() => {
      if (!contentEl.querySelector(".rico-roadmap-card")) {
        renderRoadmapCard(node, handlers);
      }
    });
    observed._roadmapObserver.observe(contentEl, { childList: true });
  }
}

/** Clear our drawing so a node that stops being a roadmap card looks normal again. */
export function clearRoadmapCard(node: RoadmapCanvasNode): void {
  const nodeEl = node.nodeEl;
  if (!nodeEl) return;
  nodeEl.removeClass("rico-roadmap-node");
  const contentEl = nodeEl.querySelector(".canvas-node-content") as ObservedEl | null;
  if (!contentEl) return;
  contentEl._roadmapObserver?.disconnect();
  delete contentEl._roadmapObserver;
  contentEl.empty();
}

/** Keep a mousedown on a control from starting a canvas node drag. */
function stopCanvasDrag(el: HTMLElement): void {
  el.addEventListener("mousedown", (e) => e.stopPropagation());
  el.addEventListener("pointerdown", (e) => e.stopPropagation());
}

/** "10-Notes/HTTP basics.md" → "HTTP basics" */
export function basename(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.md$/i, "");
}
