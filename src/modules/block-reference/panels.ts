import { Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { BlockIndex } from "./scanner";
import { NOTE_VIEW_TYPE, NoteBlocksView, VAULT_VIEW_TYPE, VaultBlocksView } from "./view";

type PanelsPlugin = Plugin & { settings: { enableBlockReferencePanels: boolean } };

type Side = "left" | "right";

/** Show the panel in its sidebar, reusing the tab if it is already open. */
async function openPanel(plugin: PanelsPlugin, type: string, side: Side): Promise<void> {
  const { workspace } = plugin.app;
  let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(type)[0] ?? null;
  if (!leaf) {
    leaf = side === "left" ? workspace.getLeftLeaf(false) : workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type, active: true });
  }
  await workspace.revealLeaf(leaf);
}

/**
 * Two panels listing block references, opened from the command palette:
 *   - right sidebar: the blocks of the open note
 *   - left sidebar: every block in the vault
 * Once opened, Obsidian remembers where they are.
 */
export function registerBlockReferencePanels(plugin: PanelsPlugin): void {
  const { app } = plugin;
  const index = new BlockIndex(app);

  plugin.registerEvent(app.metadataCache.on("changed", (file: TFile) => index.invalidate(file.path)));
  plugin.registerEvent(app.metadataCache.on("deleted", (file: TFile) => index.invalidate(file.path)));
  plugin.registerEvent(app.vault.on("rename", (_file, oldPath: string) => index.invalidate(oldPath)));

  plugin.registerView(NOTE_VIEW_TYPE, (leaf) => new NoteBlocksView(leaf, index));
  plugin.registerView(VAULT_VIEW_TYPE, (leaf) => new VaultBlocksView(leaf, index));

  plugin.addCommand({
    id: "open-block-references-note",
    name: "Open block references (this note, right sidebar)",
    callback: () => void openPanel(plugin, NOTE_VIEW_TYPE, "right"),
  });
  plugin.addCommand({
    id: "open-block-references-vault",
    name: "Open block references (whole vault, left sidebar)",
    callback: () => void openPanel(plugin, VAULT_VIEW_TYPE, "left"),
  });
}
