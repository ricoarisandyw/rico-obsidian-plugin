import { Notice, Plugin } from "obsidian";
import { parseExtensions } from "../../shared/utils/extensions";
import { CODE_VIEW_TYPE, CodeFileView } from "./view";

/** Open the user's extension list in the code editor instead of the markdown editor. */
export function registerCodeEditor(plugin: Plugin & { settings: { visibleExtensions: string } }): void {
  plugin.registerView(CODE_VIEW_TYPE, (leaf) => new CodeFileView(leaf));

  const skipped: string[] = [];
  for (const ext of parseExtensions(plugin.settings.visibleExtensions)) {
    try {
      plugin.registerExtensions([ext], CODE_VIEW_TYPE);
    } catch {
      skipped.push(ext);
    }
  }
  if (skipped.length > 0) {
    new Notice(`Rico: extensions already in use were skipped: ${skipped.join(", ")}`);
  }
}
