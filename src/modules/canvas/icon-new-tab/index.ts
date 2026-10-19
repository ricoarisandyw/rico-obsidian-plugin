import { registerCanvasTool } from "../../../shared/lib/canvas-tool-registry";
import { getNodeFile, openInNewTab } from "../../../shared/utils/canvas";

/**
 * First canvas tool: open the selected file card's note in a new tab.
 * Only available when the selected node points to an actual file.
 */
registerCanvasTool({
  id: "open-in-new-tab",
  group: "canvas",
  emoji: "📂",
  label: "Open in new tab",
  isAvailable: (ctx) => !!getNodeFile(ctx),
  run: (ctx) => openInNewTab(ctx),
});
