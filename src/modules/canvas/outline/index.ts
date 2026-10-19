import type { Plugin, WorkspaceLeaf } from "obsidian";
import { CANVAS_OUTLINE_VIEW_TYPE, CanvasLeafTracker, CanvasOutlineView } from "./view";

/** Show the outline in the right sidebar, reusing the tab if it is already open. */
async function openOutline(plugin: Plugin): Promise<void> {
  const { workspace } = plugin.app;
  let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(CANVAS_OUTLINE_VIEW_TYPE)[0] ?? null;
  if (!leaf) {
    leaf = workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: CANVAS_OUTLINE_VIEW_TYPE, active: true });
  }
  await workspace.revealLeaf(leaf);
}

/**
 * Read-only markdown view of the open canvas, opened from the command palette.
 * Groups become headings, every arrow is listed as a bullet under its nodes; clicking a block zooms to that node.
 * Obsidian cannot un-register a view at runtime, so the toggle applies after a reload.
 */
export function registerCanvasOutline(plugin: Plugin): void {
  const { app } = plugin;
  const tracker = new CanvasLeafTracker(app);

  plugin.registerEvent(app.workspace.on("active-leaf-change", (leaf) => tracker.update(leaf)));
  app.workspace.onLayoutReady(() => tracker.update(app.workspace.getMostRecentLeaf()));

  plugin.registerView(CANVAS_OUTLINE_VIEW_TYPE, (leaf) => new CanvasOutlineView(leaf, tracker));
  plugin.addCommand({
    id: "open-canvas-outline",
    name: "Open canvas outline (right sidebar)",
    callback: () => void openOutline(plugin),
  });
}
