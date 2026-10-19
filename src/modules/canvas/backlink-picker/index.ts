import { Notice } from "obsidian";
import { NotePickerModal } from "../../../shared/components/NotePickerModal";
import { registerCanvasTool } from "../../../shared/lib/canvas-tool-registry";
import { addRelationEdge, getNodeFile } from "../../../shared/utils/canvas";
import { getRelatedFiles } from "../../../shared/utils/links";

/**
 * ⛓️‍💥 Backlink picker: for the selected file card, pick one of the note's
 * existing links/backlinks and automatically draw the relation line on the
 * canvas (creating the target card first if it isn't already present).
 */
registerCanvasTool({
  id: "backlink-picker",
  group: "canvas",
  emoji: "⛓️‍💥",
  label: "Backlink picker",
  isAvailable: (ctx) => !!getNodeFile(ctx),
  run: (ctx) => {
    const file = getNodeFile(ctx);
    if (!file) return;

    const related = getRelatedFiles(ctx.app, file);
    if (related.length === 0) {
      new Notice("No links/backlinks for this note");
      return;
    }

    new NotePickerModal(ctx.app, related, (picked) =>
      addRelationEdge(ctx, picked)
    ).open();
  },
});
