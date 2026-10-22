import type { FileMenuRegistry } from "../../shared/lib/menu-registry";
import { Notice, Plugin, TFile, TFolder, normalizePath } from "obsidian";
import { NewFileModal } from "./modal";
import { allowedExtensions, checkFileName, joinPath, resolveTargetFolder } from "./logic";
import { CODE_VIEW_TYPE } from "../code-editor/view";

type NewFilePlugin = Plugin & {
  settings: { enableNewFile: boolean; enableCodeEditor: boolean; visibleExtensions: string };
};

/** Validate the name, make any missing folders, create the empty file. */
async function createFile(
  plugin: NewFilePlugin,
  folderPath: string,
  input: string,
  allowed: string[]
): Promise<{ error: string } | { file: TFile }> {
  const check = checkFileName(input, allowed);
  if (!check.ok) return { error: check.error };

  const full = normalizePath(joinPath(folderPath, check.path));
  const { vault } = plugin.app;

  if (await vault.adapter.exists(full)) return { error: `"${full}" already exists.` };

  const dir = full.includes("/") ? full.slice(0, full.lastIndexOf("/")) : "";
  try {
    if (dir && !(await vault.adapter.exists(dir))) await vault.createFolder(dir);
    const file = await vault.create(full, "");
    return { file };
  } catch (err) {
    return { error: `Couldn't create the file: ${(err as Error).message}` };
  }
}

/** Open the new file in a new tab. Markdown opens as a note, everything else in the code editor. */
async function openCreated(plugin: NewFilePlugin, file: TFile): Promise<void> {
  try {
    const leaf = plugin.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    if (file.extension !== "md" && leaf.view.getViewType() !== CODE_VIEW_TYPE) {
      new Notice(
        `Created ${file.path}, but it did not open in the code editor. Another plugin may own ".${file.extension}", or reload the plugin if you just changed the extension list.`,
        8000
      );
    }
  } catch (err) {
    new Notice(`Created ${file.path}, but it could not be opened: ${(err as Error).message}`, 8000);
  }
}

/** Show the prompt for a folder ("" = vault root). */
function promptNewFile(plugin: NewFilePlugin, folderPath: string): void {
  const allowed = allowedExtensions(plugin.settings.visibleExtensions, plugin.settings.enableCodeEditor);
  new NewFileModal(plugin.app, folderPath || "the vault root", allowed, async (value) => {
    const result = await createFile(plugin, folderPath, value, allowed);
    if ("error" in result) return result.error;
    new Notice(`Created ${result.file.path}`);
    void openCreated(plugin, result.file);
    return null;
  }).open();
}

/** Right-click a folder or a file -> "New file..." asks for a full file name and creates it. */
export function registerNewFile(
  plugin: NewFilePlugin,
  menuRegistry?: FileMenuRegistry,
): void {
  menuRegistry?.add((file) => {
    if (!plugin.settings.enableNewFile) return [];
    const isFolder = file instanceof TFolder;
    if (!isFolder && !(file instanceof TFile)) return [];
    return [
      {
        title: "New file…",
        icon: "file-plus",
        onClick: () => promptNewFile(plugin, resolveTargetFolder(file.path, isFolder)),
      },
    ];
  });

  // Same prompt from the command palette, for the folder of the open file (or the vault root).
  plugin.addCommand({
    id: "new-file-in-current-folder",
    name: "New file in current folder",
    checkCallback: (checking: boolean) => {
      if (!plugin.settings.enableNewFile) return false;
      if (!checking) {
        const active = plugin.app.workspace.getActiveFile();
        promptNewFile(plugin, resolveTargetFolder(active?.path ?? "", false));
      }
      return true;
    },
  });
}
