import { registerRailButton, unregisterRailButton } from "../tool-rail";
import { RoadmapCanvasNode } from "./logic";
import { ROADMAP_NODE_SIZE } from "./types";

/** Private MIME type so only our own drags are accepted. */
export const ROADMAP_DRAG_MIME = "application/x-rico-roadmap-drop";

const BTN_CLASS = "rico-roadmap-card-menu-btn";

/** Canvas bits the drag source needs; the canvas API is private, so this is loose. */
export interface DropCanvas {
  cardMenuEl?: HTMLElement;
  posFromClient?: (pt: { x: number; y: number }) => { x: number; y: number };
  createTextNode?: (opts: {
    pos: { x: number; y: number };
    size: { width: number; height: number };
    text: string;
    focus: boolean;
  }) => RoadmapCanvasNode;
}

/**
 * Register the "drag to add roadmap node" button on the shared canvas rail.
 * The rail decides where it sits, so this no longer races the other modules.
 */
export function ensureCardMenuButton(_cardMenu?: HTMLElement): void {
  registerRailButton({
    id: "roadmap",
    icon: "map",
    label: "Drag to add roadmap node",
    order: 40,
    className: BTN_CLASS,
    draggable: true,
    onCreate: (btn) => {
      btn.addEventListener("dragstart", (e: DragEvent) => {
        if (!e.dataTransfer) return;
        e.dataTransfer.setData(ROADMAP_DRAG_MIME, "1");
        e.dataTransfer.effectAllowed = "copy";
      });
    },
  });
}

/** Remove every button we added (used when the feature is switched off). */
export function removeCardMenuButtons(): void {
  unregisterRailButton("roadmap");
}

/**
 * Let a canvas wrapper accept our drag. `onDrop` gets canvas coordinates for
 * the drop point, so the new card lands where the pointer was released.
 */
export function ensureDropZone(
  wrapper: HTMLElement,
  canvas: DropCanvas,
  registered: WeakSet<HTMLElement>,
  onDrop: (canvas: DropCanvas, pos: { x: number; y: number }) => void
): void {
  if (registered.has(wrapper)) return;
  registered.add(wrapper);

  wrapper.addEventListener("dragover", (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes(ROADMAP_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });

  wrapper.addEventListener("drop", (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes(ROADMAP_DRAG_MIME)) return;
    e.preventDefault();

    let pos = { x: 0, y: 0 };
    try {
      const at = canvas.posFromClient?.({ x: e.clientX, y: e.clientY });
      if (at) {
        // Centre the new card on the pointer.
        pos = {
          x: Math.round(at.x - ROADMAP_NODE_SIZE.width / 2),
          y: Math.round(at.y - ROADMAP_NODE_SIZE.height / 2),
        };
      }
    } catch {
      /* origin is a fine fallback */
    }

    onDrop(canvas, pos);
  });
}
