import { Editor, MarkdownFileInfo, MarkdownView, Menu, Notice, Plugin, TFile } from "obsidian";
import { blockLink, copyToClipboard } from "./link";
import { anchorLine, planBlockReference } from "./logic";

const TITLE = "Make block reference";

type BlockReferencePlugin = Plugin & { settings: { enableBlockReference: boolean } };

/**
 * Give the paragraph under the selection a `^id` (or reuse the one it has) and copy a link to it:
 *   1. find the block that holds the end of the selection
 *   2. write the `^id` at the right place for that kind of block
 *   3. copy `[[Note#^id]]` so it can be pasted into another note
 */
async function makeBlockReference(plugin: BlockReferencePlugin, editor: Editor, file: TFile | null): Promise<void> {
  const from = editor.getCursor("from");
  const to = editor.getCursor("to");
  const plan = planBlockReference(editor.getValue().split("\n"), anchorLine(from, to));

  if (!plan.ok) {
    new Notice(plan.reason);
    return;
  }

  if (plan.insert) {
    const { line, text } = plan.insert;
    editor.replaceRange(text, { line, ch: editor.getLine(line).length });
  }

  const link = blockLink(plugin.app, file, plan.id);
  const copied = await copyToClipboard(link);
  const what = plan.reused ? "Block already has a reference" : "Block reference added";
  new Notice(copied ? `${what}, link copied: ${link}` : `${what}: ${link}`);
}

/** Right-click on selected text -> "Make block reference", plus a command for the keyboard. */
export function registerBlockReference(plugin: BlockReferencePlugin): void {
  const { workspace } = plugin.app;

  plugin.registerEvent(
    workspace.on("editor-menu", (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
      if (!plugin.settings.enableBlockReference || !editor.somethingSelected()) return;
      const file = info.file ?? workspace.getActiveFile();
      menu.addItem((item) =>
        item
          .setTitle(TITLE)
          .setIcon("link")
          .setSection("selection")
          .onClick(() => void makeBlockReference(plugin, editor, file))
      );
    })
  );

  plugin.addCommand({
    id: "make-block-reference",
    name: TITLE,
    editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
      if (!plugin.settings.enableBlockReference) return false;
      if (!checking) void makeBlockReference(plugin, editor, view.file ?? workspace.getActiveFile());
      return true;
    },
  });
}
