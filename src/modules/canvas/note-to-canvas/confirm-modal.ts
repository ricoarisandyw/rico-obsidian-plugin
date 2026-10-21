import { App, Modal } from "obsidian";

/**
 * Yes/no prompt, used before overwriting a canvas this feature did not create.
 * Resolves false when the user closes it any other way.
 */
export class ConfirmModal extends Modal {
  private readonly message: string;
  private readonly confirmLabel: string;
  private readonly resolve: (ok: boolean) => void;
  private answered = false;

  constructor(app: App, title: string, message: string, confirmLabel: string, resolve: (ok: boolean) => void) {
    super(app);
    this.message = message;
    this.confirmLabel = confirmLabel;
    this.resolve = resolve;
    this.titleEl.setText(title);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("rico-n2c-confirm");
    contentEl.createEl("p", { text: this.message });

    const buttons = contentEl.createDiv({ cls: "rico-n2c-confirm-buttons" });
    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());

    const confirm = buttons.createEl("button", { cls: "mod-warning", text: this.confirmLabel });
    confirm.addEventListener("click", () => {
      this.answered = true;
      this.resolve(true);
      this.close();
    });
    confirm.focus();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.answered) this.resolve(false);
  }
}

/** Promise-shaped wrapper around ConfirmModal. */
export function confirm(app: App, title: string, message: string, confirmLabel = "Overwrite"): Promise<boolean> {
  return new Promise((resolve) => new ConfirmModal(app, title, message, confirmLabel, resolve).open());
}
