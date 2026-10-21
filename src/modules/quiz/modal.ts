import { App, Modal } from "obsidian";

/** Asks what the quiz should cover and how many questions to generate. */
export class CreateQuizModal extends Modal {
  private readonly folderLabel: string;
  private readonly defaultCount: number;
  private readonly submit: (topic: string, count: number) => void;
  private topicInput!: HTMLInputElement;
  private countInput!: HTMLInputElement;

  constructor(
    app: App,
    folderLabel: string,
    defaultCount: number,
    submit: (topic: string, count: number) => void
  ) {
    super(app);
    this.folderLabel = folderLabel;
    this.defaultCount = defaultCount;
    this.submit = submit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("rico-quiz-modal");
    this.titleEl.setText("Create quiz group");

    contentEl.createEl("p", {
      cls: "rico-quiz-modal-hint",
      text: `Questions will be written into ${this.folderLabel}. The prompt is copied to your clipboard — paste it into your agent.`,
    });

    contentEl.createEl("label", { cls: "rico-quiz-modal-label", text: "Topic" });
    this.topicInput = contentEl.createEl("input", {
      type: "text",
      cls: "rico-quiz-modal-input",
      attr: { placeholder: "e.g. SOLID principles (leave empty to use the folder's notes)", spellcheck: "false" },
    });

    contentEl.createEl("label", { cls: "rico-quiz-modal-label", text: "How many questions" });
    this.countInput = contentEl.createEl("input", {
      type: "number",
      cls: "rico-quiz-modal-input",
      attr: { min: "1", max: "100" },
    });
    this.countInput.value = String(this.defaultCount);

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const copy = buttons.createEl("button", { text: "Copy prompt", cls: "mod-cta" });
    const cancel = buttons.createEl("button", { text: "Cancel" });

    copy.addEventListener("click", () => this.handleSubmit());
    cancel.addEventListener("click", () => this.close());
    for (const input of [this.topicInput, this.countInput]) {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.handleSubmit();
        }
      });
    }

    this.topicInput.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private handleSubmit(): void {
    const parsed = Number.parseInt(this.countInput.value, 10);
    const count = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : this.defaultCount;
    this.submit(this.topicInput.value.trim(), count);
    this.close();
  }
}

/** A single multi-line reason box, used for mistake reports. */
export class ReasonModal extends Modal {
  private readonly heading: string;
  private readonly hint: string;
  private readonly submit: (reason: string) => void;
  private input!: HTMLTextAreaElement;

  constructor(app: App, heading: string, hint: string, submit: (reason: string) => void) {
    super(app);
    this.heading = heading;
    this.hint = hint;
    this.submit = submit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("rico-quiz-modal");
    this.titleEl.setText(this.heading);

    contentEl.createEl("p", { cls: "rico-quiz-modal-hint", text: this.hint });

    this.input = contentEl.createEl("textarea", {
      cls: "rico-quiz-modal-textarea",
      attr: { placeholder: "What is wrong with this question?", rows: "4" },
    });

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const save = buttons.createEl("button", { text: "Save report", cls: "mod-cta" });
    const cancel = buttons.createEl("button", { text: "Cancel" });

    save.addEventListener("click", () => this.handleSubmit());
    cancel.addEventListener("click", () => this.close());
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        this.handleSubmit();
      }
    });

    this.input.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private handleSubmit(): void {
    const reason = this.input.value.trim();
    if (!reason) return;
    this.submit(reason);
    this.close();
  }
}
