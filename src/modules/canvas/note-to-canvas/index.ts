import type { FileMenuRegistry } from "../../../shared/lib/menu-registry";
import { Editor, MarkdownFileInfo, MarkdownView, Menu, Notice, Plugin, TAbstractFile, TFile } from "obsidian";

import { buildCanvas, isForeignCanvas, mergeCanvas } from "./builder";
import { confirm } from "./confirm-modal";
import { parseSections } from "./parser";
import { canvasPathFor, openCanvas, readExistingCanvas, writeCanvas } from "./write";

const TITLE = "Convert note to canvas";

type NoteToCanvasPlugin = Plugin & {
  settings: {
    enableNoteToCanvas: boolean;
    noteToCanvasMaxDepth: number;
    noteToCanvasCardWidth: number;
    noteToCanvasCardHeight: number;
    noteToCanvasFolder: string;
    noteToCanvasIncludeBody: boolean;
  };
};

/** Parse the note, build (or merge) the canvas, write it, open it. */
export async function convertNote(plugin: NoteToCanvasPlugin, file: TFile): Promise<void> {
  const { app, settings } = plugin;

  const markdown = await app.vault.read(file);
  const roots = parseSections(markdown, settings.noteToCanvasMaxDepth);
  if (roots.length === 0) {
    new Notice(`"${file.basename}" is empty — nothing to put on a canvas.`);
    return;
  }

  const fresh = buildCanvas(roots, {
    cardWidth: settings.noteToCanvasCardWidth,
    cardHeight: settings.noteToCanvasCardHeight,
    includeBody: settings.noteToCanvasIncludeBody,
    notePath: file.path,
  });

  const path = canvasPathFor(file.path, settings.noteToCanvasFolder);
  const existing = await readExistingCanvas(app, path);

  let data = fresh;
  if (existing) {
    if (isForeignCanvas(existing)) {
      const ok = await confirm(
        app,
        "Overwrite this canvas?",
        `"${path}" already exists and was not generated from this note. Overwriting replaces everything on it.`
      );
      if (!ok) return;
    } else {
      data = mergeCanvas(existing, fresh);
    }
  }

  const written = await writeCanvas(app, path, data);
  if (!written) return;

  const count = fresh.nodes.length;
  new Notice(`${existing ? "Updated" : "Created"} ${path} — ${count} card${count === 1 ? "" : "s"}.`);
  await openCanvas(app, written);
}

/** True for a markdown file we can convert. */
function isNote(file: TAbstractFile | null): file is TFile {
  return file instanceof TFile && file.extension === "md";
}

/**
 * Turn the active note into a canvas, one card per heading.
 * Available from the command palette, the editor right-click menu, and the file explorer.
 */
export function registerNoteToCanvas(
  plugin: NoteToCanvasPlugin,
  menuRegistry?: FileMenuRegistry,
): void {
  const { workspace } = plugin.app;

  plugin.addCommand({
    id: "convert-note-to-canvas",
    name: TITLE,
    checkCallback: (checking: boolean) => {
      if (!plugin.settings.enableNoteToCanvas) return false;
      const file = workspace.getActiveFile();
      if (!isNote(file)) return false;
      if (!checking) void convertNote(plugin, file);
      return true;
    },
  });

  plugin.registerEvent(
    workspace.on("editor-menu", (menu: Menu, _editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
      if (!plugin.settings.enableNoteToCanvas) return;
      const file = info.file ?? workspace.getActiveFile();
      if (!isNote(file)) return;
      menu.addItem((item) =>
        item.setTitle(TITLE).setIcon("layout-dashboard").onClick(() => void convertNote(plugin, file))
      );
    })
  );

  // The file-menu entry goes through the shared registry so it sits under the
  // one "Rico Plugin" parent instead of on the root menu.
  menuRegistry?.add((file) =>
    plugin.settings.enableNoteToCanvas && isNote(file)
      ? [
          {
            title: TITLE,
            icon: "layout-dashboard",
            onClick: () => void convertNote(plugin, file),
          },
        ]
      : [],
  );
}
