import { App, Modal } from "obsidian";

/**
 * Asks for a full file name. `submit` returns an error message to show (the prompt
 * stays open), or null when the file was created (the prompt closes).
 */
export class NewFileModal extends Modal {
  private readonly folderLabel: string;
  private readonly allowed: string[];
  private readonly submit: (value: string) => Promise<string | null>;
  private input!: HTMLInputElement;
  private errorEl!: HTMLElement;
  private busy = false;

  constructor(
    app: App,
    folderLabel: string,
    allowed: string[],
    submit: (value: string) => Promise<string | null>
  ) {
    super(app);
    this.folderLabel = folderLabel;
    this.allowed = allowed;
    this.submit = submit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("rico-new-file");
    this.titleEl.setText("New file");

    contentEl.createEl("p", {
      cls: "rico-new-file-hint",
      text: `In ${this.folderLabel}. Allowed: ${this.allowed.join(", ")}.`,
    });

    this.input = contentEl.createEl("input", {
      type: "text",
      cls: "rico-new-file-input",
      attr: { placeholder: "name.ext  (or folder/name.ext)", spellcheck: "false" },
    });
    this.errorEl = contentEl.createDiv({ cls: "rico-new-file-error" });

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const create = buttons.createEl("button", { text: "Create", cls: "mod-cta" });
    const cancel = buttons.createEl("button", { text: "Cancel" });

    create.addEventListener("click", () => void this.handleSubmit());
    cancel.addEventListener("click", () => this.close());
    this.input.addEventListener("input", () => this.showError(""));
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.handleSubmit();
      }
    });

    this.input.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private showError(message: string): void {
    this.errorEl.setText(message);
  }

  private async handleSubmit(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const error = await this.submit(this.input.value);
      if (error) {
        this.showError(error);
        this.input.focus();
      } else {
        this.close();
      }
    } finally {
      this.busy = false;
    }
  }
}
