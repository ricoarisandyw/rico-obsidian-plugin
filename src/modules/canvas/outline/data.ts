import type { App, TFile, WorkspaceLeaf } from "obsidian";
import type { CanvasData, CanvasNode, CanvasView } from "../../../shared/utils/canvas";

type FileView = CanvasView & { file?: TFile | null };

/** Path of the file shown in a canvas leaf ("" when unknown). */
export function canvasPath(leaf: WorkspaceLeaf): string {
  return (leaf.view as unknown as FileView).file?.path ?? "";
}

function normalize(raw: Partial<CanvasData>): CanvasData {
  return {
    ...raw,
    nodes: Array.isArray(raw.nodes) ? raw.nodes : [],
    edges: Array.isArray(raw.edges) ? raw.edges : [],
  };
}

/**
 * Read the canvas without changing it: the live data when the canvas is loaded,
 * otherwise the .canvas file parsed as JSON. Returns null when neither works.
 */
export async function readCanvasData(app: App, leaf: WorkspaceLeaf): Promise<CanvasData | null> {
  const view = leaf.view as unknown as FileView;
  const live = view.canvas?.getData?.();
  if (live && typeof live === "object") return normalize(live);

  if (!view.file) return null;
  try {
    return normalize(JSON.parse(await app.vault.cachedRead(view.file)));
  } catch {
    return null;
  }
}

/** Cheap fingerprint used to skip re-rendering when nothing changed. */
export function dataSignature(data: CanvasData): string {
  return JSON.stringify([data.nodes, data.edges]);
}

/** Select a node and zoom to it. Only moves the viewport, the canvas data stays as is. */
export function focusCanvasNode(app: App, leaf: WorkspaceLeaf, id: string): boolean {
  const canvas = (leaf.view as unknown as CanvasView).canvas;
  const node = canvas?.nodes?.get(id);
  if (!canvas || !node) return false;

  app.workspace.setActiveLeaf(leaf, { focus: true });
  canvas.selectOnly?.(node);
  if (canvas.zoomToSelection) {
    canvas.zoomToSelection();
  } else {
    const bbox = (node as CanvasNode & { bbox?: Parameters<NonNullable<typeof canvas.zoomToBbox>>[0] }).bbox;
    if (bbox) canvas.zoomToBbox?.(bbox);
  }
  return true;
}
