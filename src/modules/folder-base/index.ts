import { App, Notice, Plugin, TFolder, normalizePath } from "obsidian";
import { baseName, buildBaseYaml, uniqueBasePath } from "./base-file";
import { collectRows, discoverColumns } from "./data";
import { FolderBaseView, VIEW_TYPE_FBASE } from "./view";

export { FolderBaseView, VIEW_TYPE_FBASE };

/**
 * Create a native Obsidian `.base` for a folder: filtered to the notes in that folder
 * and showing the properties those notes use. The vault root covers the whole vault.
 */
export async function createBaseForFolder(app: App, folder: TFolder): Promise<void> {
  const root = folder.isRoot();
  const rows = root
    ? app.vault.getMarkdownFiles().map((file) => ({
        file,
        frontmatter: { ...(app.metadataCache.getFileCache(file)?.frontmatter ?? {}) },
      }))
    : collectRows(app, folder.path);
  const content = buildBaseYaml(root ? null : folder.path, discoverColumns(rows));

  const dir = root ? "" : `${folder.path}/`;
  const path = normalizePath(
    uniqueBasePath((p) => !!app.vault.getAbstractFileByPath(normalizePath(p)), dir, baseName(root ? null : folder.name)),
  );
  const file = await app.vault.create(path, content);
  await app.workspace.getLeaf(true).openFile(file);
}

export function registerFolderBase(plugin: Plugin): void {
  plugin.registerView(VIEW_TYPE_FBASE, (leaf) => new FolderBaseView(leaf));
  plugin.registerExtensions(["fbase"], VIEW_TYPE_FBASE);

  plugin.registerEvent(
    plugin.app.workspace.on("file-menu", (menu, file) => {
      if (file instanceof TFolder) {
        menu.addItem((item) =>
          item
            .setTitle("New folder base")
            .setIcon("table")
            .onClick(() => void createBaseForFolder(plugin.app, file))
        );
      }
    })
  );

  plugin.addCommand({
    id: "new-folder-base",
    name: "New folder base for current folder",
    callback: () => {
      const active = plugin.app.workspace.getActiveFile();
      const folder = active?.parent;
      if (!folder) {
        new Notice("Open a note first so I know which folder to use.");
        return;
      }
      void createBaseForFolder(plugin.app, folder);
    },
  });
}
