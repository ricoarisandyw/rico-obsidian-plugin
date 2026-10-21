import type { Plugin, WorkspaceLeaf } from "obsidian";
import { CanvasLeafTracker } from "../outline/view";
import { CANVAS_NETWORK_GRAPH_VIEW_TYPE, CanvasNetworkGraphView } from "./view";

/** Show the graph in the right sidebar, reusing the tab if it is already open. */
async function openNetworkGraph(plugin: Plugin): Promise<void> {
  const { workspace } = plugin.app;
  let leaf: WorkspaceLeaf | null =
    workspace.getLeavesOfType(CANVAS_NETWORK_GRAPH_VIEW_TYPE)[0] ?? null;
  if (!leaf) {
    leaf = workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: CANVAS_NETWORK_GRAPH_VIEW_TYPE, active: true });
  }
  await workspace.revealLeaf(leaf);
}

/**
 * Read-only network graph of the open canvas, opened from the command palette.
 * Circle size grows with the number of connections, colour follows the node type,
 * and clicking a circle zooms the real canvas to that card.
 * Obsidian cannot un-register a view at runtime, so the toggle applies after a reload.
 */
export function registerCanvasNetworkGraph(plugin: Plugin): void {
  const { app } = plugin;
  const tracker = new CanvasLeafTracker(app);

  plugin.registerEvent(app.workspace.on("active-leaf-change", (leaf) => tracker.update(leaf)));
  app.workspace.onLayoutReady(() => tracker.update(app.workspace.getMostRecentLeaf()));

  plugin.registerView(
    CANVAS_NETWORK_GRAPH_VIEW_TYPE,
    (leaf) => new CanvasNetworkGraphView(leaf, tracker),
  );
  plugin.addCommand({
    id: "open-canvas-network-graph",
    name: "Open canvas network graph (right sidebar)",
    callback: () => void openNetworkGraph(plugin),
  });
}
