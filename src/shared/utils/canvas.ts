import { App, TFile, WorkspaceLeaf } from "obsidian";

/**
 * Loose typings for Obsidian's (private) canvas API. We only model the bits we use.
 */
export interface CanvasNode {
  id?: string;
  // File nodes expose the underlying file path and/or TFile.
  filePath?: string;
  file?: TFile;
  // Node-level data (varies by Obsidian version).
  unknownData?: { type?: string; file?: string };
  getData?: () => { type?: string; file?: string };
}

/** A node as it appears in the serialized canvas data (canvas.getData()). */
export interface CanvasDataNode {
  id: string;
  type?: string;
  file?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  [key: string]: unknown;
}

/** An edge as it appears in the serialized canvas data (canvas.getData()). */
export interface CanvasDataEdge {
  id: string;
  fromNode: string;
  fromSide?: string;
  toNode: string;
  toSide?: string;
  fromEnd?: "none" | "arrow";
  toEnd?: "none" | "arrow";
  [key: string]: unknown;
}

/** The serialized canvas document returned by canvas.getData(). */
export interface CanvasData {
  nodes: CanvasDataNode[];
  edges: CanvasDataEdge[];
  [key: string]: unknown;
}

export interface Canvas {
  selection?: Set<CanvasNode>;
  nodes?: Map<string, CanvasNode>;
  menu?: { menuEl?: HTMLElement };
  getSelectionData?: () => { nodes: Array<{ id: string }> };
  // Serialized-data mutation API (present natively; advanced-canvas patches it).
  getData?: () => CanvasData;
  importData?: (data: CanvasData, clear?: boolean) => void;
  requestSave?: () => void;
  requestFrame?: () => void;
  // Navigation API (private, optional): select a node and move the viewport.
  selectOnly?: (node: CanvasNode) => void;
  zoomToSelection?: () => void;
  zoomToBbox?: (bbox: { minX: number; minY: number; maxX: number; maxY: number }) => void;
}

export interface CanvasView {
  canvas?: Canvas;
  containerEl: HTMLElement;
}

/**
 * Context passed to every CanvasTool's isAvailable()/run().
 */
export interface CanvasToolContext {
  app: App;
  canvas: Canvas;
  node?: CanvasNode;
}

/** Return the canvas of the currently active leaf, if it is a canvas. */
export function getActiveCanvas(app: App): Canvas | undefined {
  const leaf = app.workspace.activeLeaf as WorkspaceLeaf | null;
  const view = leaf?.view as unknown as CanvasView | undefined;
  return view?.canvas;
}

/** Return all open canvases across leaves. */
export function getAllCanvases(app: App): Canvas[] {
  return app.workspace
    .getLeavesOfType("canvas")
    .map((leaf) => (leaf.view as unknown as CanvasView | undefined)?.canvas)
    .filter((c): c is Canvas => !!c);
}

/**
 * Return the single selected node of a canvas (the one the popup menu targets).
 * If multiple nodes are selected we return the first; if none, undefined.
 */
export function getSelectedNode(canvas: Canvas): CanvasNode | undefined {
  if (canvas.selection && canvas.selection.size > 0) {
    return canvas.selection.values().next().value;
  }
  // Fallback via selection data + nodes map.
  const data = canvas.getSelectionData?.();
  const id = data?.nodes?.[0]?.id;
  if (id && canvas.nodes) return canvas.nodes.get(id);
  return undefined;
}

/** Resolve the file path declared by a node, regardless of Obsidian version. */
export function getNodeFilePath(node?: CanvasNode): string | undefined {
  if (!node) return undefined;
  if (node.filePath) return node.filePath;
  if (node.file?.path) return node.file.path;
  const data = node.getData?.() ?? node.unknownData;
  if (data?.type === "file" && data.file) return data.file;
  return node.unknownData?.file;
}

/** Resolve the TFile a node points to (for "file" nodes), if any. */
export function getNodeFile(ctx: CanvasToolContext): TFile | undefined {
  const node = ctx.node ?? getSelectedNode(ctx.canvas);
  if (node?.file instanceof TFile) return node.file;
  const path = getNodeFilePath(node);
  if (!path) return undefined;
  const file = ctx.app.vault.getAbstractFileByPath(path);
  return file instanceof TFile ? file : undefined;
}

/** Open the selected node's file in a new tab. */
export async function openInNewTab(ctx: CanvasToolContext): Promise<void> {
  const file = getNodeFile(ctx);
  if (!file) return;
  await ctx.app.workspace.getLeaf("tab").openFile(file);
}

/** Generate a 16-char random hex id, matching Obsidian's canvas id format. */
export function generateCanvasId(): string {
  let id = "";
  for (let i = 0; i < 16; i++) {
    id += Math.floor(Math.random() * 16).toString(16);
  }
  return id;
}

/** Find the id of an existing file node pointing at `path`, if any. */
export function findFileNodeId(
  data: CanvasData,
  path: string
): string | undefined {
  const node = data.nodes.find(
    (n) => n.type === "file" && n.file === path
  );
  return node?.id;
}

/**
 * Draw a plain relation line (no arrowhead) from the selected node to the card
 * for `targetFile`. Creates a file card to the right of the source if the target
 * has no card on this canvas. Skips creating a duplicate edge.
 */
export function addRelationEdge(
  ctx: CanvasToolContext,
  targetFile: TFile
): void {
  const { canvas } = ctx;
  const sourceId = (ctx.node ?? getSelectedNode(canvas))?.id;
  if (!sourceId) return;
  if (!canvas.getData || !canvas.importData) return;

  const data = canvas.getData();

  // Resolve (or create) the target card.
  let targetId = findFileNodeId(data, targetFile.path);
  if (!targetId) {
    const source = data.nodes.find((n) => n.id === sourceId);
    const x = (source?.x ?? 0) + (source?.width ?? 400) + 80;
    const y = source?.y ?? 0;
    targetId = generateCanvasId();
    data.nodes.push({
      id: targetId,
      type: "file",
      file: targetFile.path,
      x,
      y,
      width: 400,
      height: 400,
    });
  }

  // Guard against duplicate edges in either direction.
  const exists = data.edges.some(
    (e) =>
      (e.fromNode === sourceId && e.toNode === targetId) ||
      (e.fromNode === targetId && e.toNode === sourceId)
  );
  if (!exists) {
    data.edges.push({
      id: generateCanvasId(),
      fromNode: sourceId,
      fromSide: "right",
      toNode: targetId,
      toSide: "left",
      toEnd: "none",
    });
  }

  canvas.importData(data);
  canvas.requestSave?.();
  canvas.requestFrame?.();
}
