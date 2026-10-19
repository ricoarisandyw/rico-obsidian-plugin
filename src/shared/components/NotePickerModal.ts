import { App, FuzzySuggestModal, TFile } from "obsidian";

/**
 * A thin fuzzy picker over a fixed list of notes. Native Obsidian fuzzy
 * suggester — the right primitive for "pick a note" interactions. Reusable for
 * future canvas tools.
 */
export class NotePickerModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly files: TFile[],
    private readonly onChoose: (file: TFile) => void
  ) {
    super(app);
    this.setPlaceholder("Pick a linked/backlinked note…");
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.basename;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}
