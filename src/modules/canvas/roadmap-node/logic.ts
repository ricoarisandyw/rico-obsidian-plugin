import { App, TFile } from "obsidian";
import {
  ROADMAP_NODE_TYPE,
  RoadmapLink,
  RoadmapNodeData,
  RoadmapStatus,
  STATUS_META,
  STATUS_ORDER,
} from "./types";

/** The slice of a canvas node we touch. Obsidian's canvas API is private, so this is loose. */
export interface RoadmapCanvasNode {
  getData?: () => Record<string, unknown>;
  setData?: (data: Record<string, unknown>) => void;
  nodeEl?: HTMLElement;
  canvas?: { requestSave?: () => void };
}

function isStatus(value: unknown): value is RoadmapStatus {
  return typeof value === "string" && value in STATUS_META;
}

/** Keep only well-formed {label, url} pairs; anything else in the blob is dropped. */
function readLinks(value: unknown): RoadmapLink[] {
  if (!Array.isArray(value)) return [];
  const links: RoadmapLink[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const { label, url } = raw as Record<string, unknown>;
    if (typeof url !== "string" || !url.trim()) continue;
    links.push({
      label: typeof label === "string" && label.trim() ? label.trim() : url.trim(),
      url: url.trim(),
    });
  }
  return links;
}

/**
 * Read our payload off a canvas node.
 * Returns undefined for anything that is not one of our cards, and tolerates a
 * half-written blob (a hand-edited .canvas file) by falling back to defaults.
 */
export function readRoadmapData(node?: RoadmapCanvasNode): RoadmapNodeData | undefined {
  const raw = node?.getData?.();
  if (!raw || raw.customNodeType !== ROADMAP_NODE_TYPE) return undefined;

  const payload = (raw.roadmapData ?? {}) as Record<string, unknown>;
  return {
    title: typeof payload.title === "string" ? payload.title : "",
    status: isStatus(payload.status) ? payload.status : "none",
    articlePath: typeof payload.articlePath === "string" ? payload.articlePath : "",
    links: readLinks(payload.links),
  };
}

/**
 * Write our payload back, preserving every unrelated field Obsidian keeps on the
 * node (position, size, colour, …). Does not save; callers decide when to persist.
 */
export function writeRoadmapData(node: RoadmapCanvasNode, data: RoadmapNodeData): void {
  const existing = node.getData?.() ?? {};
  node.setData?.({
    ...existing,
    type: "text",
    text: "",
    customNodeType: ROADMAP_NODE_TYPE,
    roadmapData: { ...data },
  });
}

/** Write the payload and ask the canvas to persist it. */
export function saveRoadmapData(node: RoadmapCanvasNode, data: RoadmapNodeData): void {
  writeRoadmapData(node, data);
  node.canvas?.requestSave?.();
}

/** Next status in the cycle: none → learning → done → skip → none. */
export function cycleStatus(status: RoadmapStatus): RoadmapStatus {
  const index = STATUS_ORDER.indexOf(status);
  return STATUS_ORDER[(index + 1) % STATUS_ORDER.length];
}

/** The linked note, or undefined when nothing is linked or the note is gone. */
export function resolveArticle(app: App, data?: RoadmapNodeData): TFile | undefined {
  const path = data?.articlePath?.trim();
  if (!path) return undefined;
  const file = app.vault.getAbstractFileByPath(path);
  return file instanceof TFile ? file : undefined;
}

/** What the card shows when the title is empty. */
export const UNTITLED = "Untitled topic";

export function displayTitle(data: RoadmapNodeData): string {
  return data.title.trim() || UNTITLED;
}
