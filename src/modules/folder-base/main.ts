import { Notice, Plugin, TFolder, normalizePath } from "obsidian";
import { defaultConfig, serializeConfig } from "./config";
import { FolderBaseView, VIEW_TYPE_FBASE } from "./view";

export default class FolderBasePlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(VIEW_TYPE_FBASE, (leaf) => new FolderBaseView(leaf));
    this.registerExtensions(["fbase"], VIEW_TYPE_FBASE);

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFolder) {
          menu.addItem((item) =>
            item
              .setTitle("New folder base")
              .setIcon("table")
              .onClick(() => void this.createBaseForFolder(file))
          );
        }
      })
    );

    this.addCommand({
      id: "new-folder-base",
      name: "New folder base for current folder",
      callback: () => {
        const active = this.app.workspace.getActiveFile();
        const folder = active?.parent;
        if (!folder) {
          new Notice("Open a note first so I know which folder to use.");
          return;
        }
        void this.createBaseForFolder(folder);
      },
    });
  }

  async createBaseForFolder(folder: TFolder): Promise<void> {
    const name = folder.isRoot() ? "Vault" : folder.name;
    const dir = folder.isRoot() ? "" : folder.path + "/";
    let path = normalizePath(`${dir}${name}.fbase`);
    let suffix = 1;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${dir}${name} ${suffix++}.fbase`);
    }
    const config = defaultConfig(folder.isRoot() ? "/" : folder.path);
    const file = await this.app.vault.create(path, serializeConfig(config));
    await this.app.workspace.getLeaf(true).openFile(file);
  }
}
