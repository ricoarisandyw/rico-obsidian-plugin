import { App, Modal, Setting } from "obsidian";
import { parseStopwords } from "./cluster-all";

interface StopwordsOptions {
  /** Words the user has already added. */
  current: string[];
  /** Words the map dropped on its own for the level on screen. */
  detected: string[];
  /** Called with the final list when the user saves. */
  save: (words: string[]) => Promise<void>;
}

/**
 * Where the user manages the words ignored when naming groups.
 *
 * Two lists: the words the map dropped on its own, shown as chips that add to
 * the user's list when clicked, and the user's own list, a plain text box.
 */
export class StopwordsModal extends Modal {
  private readonly options: StopwordsOptions;
  private inputEl!: HTMLTextAreaElement;
  private chipsEl!: HTMLElement;

  constructor(app: App, options: StopwordsOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("rico-sc-stopwords");
    this.titleEl.setText("Stopwords");

    contentEl.createEl("p", {
      cls: "rico-sc-stopwords-hint",
      text:
        "Words listed here are ignored when the map picks keywords and group names. " +
        "Separate them with commas, spaces or new lines.",
    });

    this.inputEl = contentEl.createEl("textarea", {
      cls: "rico-sc-stopwords-input",
      attr: { rows: "4", placeholder: "aku, should, banyak", spellcheck: "false" },
    });
    this.inputEl.value = this.options.current.join(", ");
    this.inputEl.addEventListener("input", () => this.renderChips());

    contentEl.createEl("div", {
      cls: "rico-sc-stopwords-label",
      text: "Found automatically (used by most groups). Click one to add it to your list.",
    });
    this.chipsEl = contentEl.createDiv({ cls: "rico-sc-stopwords-chips" });
    this.renderChips();

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => this.close()),
      )
      .addButton((button) =>
        button
          .setButtonText("Save")
          .setCta()
          .onClick(async () => {
            await this.options.save(parseStopwords(this.inputEl.value));
            this.close();
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** Detected words not yet on the user's list, as clickable chips. */
  private renderChips(): void {
    this.chipsEl.empty();
    const mine = new Set(parseStopwords(this.inputEl.value));
    const rest = this.options.detected.filter((word) => !mine.has(word));
    if (!rest.length) {
      this.chipsEl.createSpan({
        cls: "rico-sc-stopwords-none",
        text: this.options.detected.length ? "All added." : "Nothing detected for this level.",
      });
      return;
    }
    for (const word of rest) {
      const chip = this.chipsEl.createEl("button", { cls: "rico-sc-stopwords-chip", text: word });
      chip.addEventListener("click", () => {
        const next = [...parseStopwords(this.inputEl.value), word];
        this.inputEl.value = next.join(", ");
        this.renderChips();
      });
    }
  }
}
