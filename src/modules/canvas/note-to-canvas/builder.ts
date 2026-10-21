/**
 * Section tree -> CanvasData, and the merge that lets you re-run without losing work.
 *
 * Every generated node keeps its stable id (`rico-n2c:<heading path>`), so a second run
 * can recognise the card it made last time, refresh the text and leave the position alone.
 */

import type { CanvasData, CanvasDataEdge, CanvasDataNode } from "../../../shared/utils/canvas";
import { ID_PREFIX, Section, flatten } from "./parser";
import { DEFAULT_LAYOUT, LayoutOptions, layoutSections } from "./layout";

/** Marker appended to a card whose heading is gone from the note. */
export const REMOVED_MARK = "%% removed from note %%";

export interface BuildOptions extends Partial<LayoutOptions> {
  /** Card text: the heading plus its body, or just a link back to the note section. */
  includeBody?: boolean;
  /** Note path, used for the embed link when `includeBody` is false. */
  notePath?: string;
}

/** The text that goes inside a card. */
export function cardText(section: Section, opts: BuildOptions): string {
  const heading = section.level > 0 ? `${"#".repeat(section.level)} ${section.title}` : section.title;

  if (opts.includeBody === false) {
    const path = opts.notePath?.replace(/\.md$/, "") ?? "";
    return path ? `${heading}\n\n![[${path}#${section.title}]]` : heading;
  }
  return section.body ? `${heading}\n\n${section.body}` : heading;
}

/** Edge id that is stable across runs, so merging does not duplicate arrows. */
function edgeId(from: string, to: string): string {
  return `${ID_PREFIX}edge:${from}->${to}`;
}

/** Was this node made by us on an earlier run? */
export function isGenerated(node: CanvasDataNode): boolean {
  return typeof node.id === "string" && node.id.startsWith(ID_PREFIX);
}

/** True when the canvas has no generated nodes but does have content of its own. */
export function isForeignCanvas(data: CanvasData): boolean {
  return data.nodes.length > 0 && !data.nodes.some(isGenerated);
}

/** Fresh canvas data for a section tree. */
export function buildCanvas(roots: Section[], options: BuildOptions = {}): CanvasData {
  const placed = layoutSections(roots, options);
  const nodes: CanvasDataNode[] = placed.map((p) => ({
    id: p.section.id,
    type: "text",
    text: cardText(p.section, options),
    x: Math.round(p.x),
    y: Math.round(p.y),
    width: p.width,
    height: p.height,
  }));

  const edges: CanvasDataEdge[] = [];
  for (const section of flatten(roots)) {
    if (!section.parentId) continue;
    edges.push({
      id: edgeId(section.parentId, section.id),
      fromNode: section.parentId,
      fromSide: "right",
      toNode: section.id,
      toSide: "left",
      toEnd: "arrow",
    });
  }

  return { nodes, edges };
}

/**
 * Merge a fresh build into what is already on the canvas.
 *
 * - a card we generated before keeps its x/y/width/height, and gets the new text
 * - a new section is added at its laid-out spot
 * - a card whose section is gone is kept but marked, so nothing disappears silently
 * - anything the user added by hand (non-generated nodes and edges) is left untouched
 */
export function mergeCanvas(existing: CanvasData, fresh: CanvasData): CanvasData {
  const freshById = new Map(fresh.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const nodes: CanvasDataNode[] = [];

  for (const old of existing.nodes) {
    if (!isGenerated(old)) {
      nodes.push(old);
      continue;
    }
    const next = freshById.get(old.id);
    if (next) {
      seen.add(old.id);
      // Keep where the user put it and how big they made it; refresh the content.
      nodes.push({ ...old, text: next.text });
    } else {
      const text = typeof old.text === "string" ? old.text : "";
      nodes.push({ ...old, text: text.includes(REMOVED_MARK) ? text : `${text}\n\n${REMOVED_MARK}` });
    }
  }

  for (const node of fresh.nodes) {
    if (!seen.has(node.id)) nodes.push(node);
  }

  const keptIds = new Set(nodes.map((n) => n.id));
  const edges: CanvasDataEdge[] = existing.edges.filter(
    (e) => !e.id.startsWith(`${ID_PREFIX}edge:`) && keptIds.has(e.fromNode) && keptIds.has(e.toNode)
  );
  const existingEdgeIds = new Set(edges.map((e) => e.id));
  for (const edge of fresh.edges) {
    if (!existingEdgeIds.has(edge.id)) edges.push(edge);
  }

  return { ...existing, nodes, edges };
}
