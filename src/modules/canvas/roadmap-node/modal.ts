import { App, FuzzySuggestModal, Modal, Notice, TFile, setIcon } from "obsidian";
import { RoadmapLink, RoadmapNodeData, RoadmapStatus, STATUS_META, PICKABLE_STATUSES } from "./types";
import { basename } from "./render";

/** Pick an existing markdown note, or create one named after whatever was typed. */
export class ArticleSuggestModal extends FuzzySuggestModal<TFile> {
  private onPick: (path: string) => void;

  constructor(app: App, onPick: (path: string) => void) {
    super(app);
    this.onPick = onPick;
    this.setPlaceholder("Pick a note — or type a new name and press Enter");
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onPick(file.path);
  }

  /**
   * Nothing matched the typed text: offer to create that note.
   * FuzzySuggestModal has no hook for this, so we watch for Enter on an empty list.
   */
  onOpen(): void {
    super.onOpen();
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const hasResults = this.resultContainerEl.querySelector(".suggestion-item");
      const typed = this.inputEl.value.trim();
      if (hasResults || !typed) return;
      e.preventDefault();
      void this.createAndPick(typed);
    });
  }

  private async createAndPick(name: string): Promise<void> {
    const path = name.endsWith(".md") ? name : `${name}.md`;
    try {
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) {
        this.onPick(existing.path);
      } else {
        const file = await this.app.vault.create(path, `# ${basename(path)}\n\n`);
        new Notice(`Created ${file.path}`);
        this.onPick(file.path);
      }
      this.close();
    } catch (err) {
      new Notice(`Could not create the note: ${(err as Error).message}`);
    }
  }
}

export interface RoadmapFormResult {
  title: string;
  status: RoadmapStatus;
  articlePath: string;
  links: RoadmapLink[];
}

/** Create or edit a roadmap card: title, status, linked note, extra links. */
export class RoadmapNodeModal extends Modal {
  private draft: RoadmapFormResult;
  private isEdit: boolean;
  private onSubmit: (result: RoadmapFormResult) => void;
  private articleRowEl!: HTMLElement;
  private linksEl!: HTMLElement;

  constructor(
    app: App,
    initial: Partial<RoadmapNodeData>,
    onSubmit: (result: RoadmapFormResult) => void,
    isEdit = false
  ) {
    super(app);
    this.isEdit = isEdit;
    this.onSubmit = onSubmit;
    this.draft = {
      title: initial.title ?? "",
      status: initial.status ?? "none",
      articlePath: initial.articlePath ?? "",
      links: [...(initial.links ?? [])],
    };
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("rico-roadmap-modal");
    contentEl.createEl("h3", { text: this.isEdit ? "Edit roadmap node" : "Add roadmap node" });

    // Title
    contentEl.createEl("label", { cls: "rico-roadmap-modal-label", text: "Title" });
    const titleEl = contentEl.createEl("input", { cls: "rico-roadmap-modal-input" });
    titleEl.type = "text";
    titleEl.placeholder = "Internet";
    titleEl.value = this.draft.title;
    titleEl.addEventListener("input", () => {
      this.draft.title = titleEl.value;
    });

    // Status
    contentEl.createEl("label", { cls: "rico-roadmap-modal-label", text: "Status" });
    const statusRow = contentEl.createDiv({ cls: "rico-roadmap-modal-status" });
    const buttons = new Map<RoadmapStatus, HTMLElement>();
    const paint = () => {
      for (const [status, btn] of buttons) {
        btn.toggleClass("is-active", this.draft.status === status);
      }
    };
    for (const status of ["none", ...PICKABLE_STATUSES] as RoadmapStatus[]) {
      const meta = STATUS_META[status];
      const btn = statusRow.createEl("button", {
        cls: `rico-roadmap-status-btn ${meta.cls}`,
        attr: { type: "button" },
      });
      setIcon(btn.createSpan(), meta.icon);
      btn.createSpan({ text: meta.label });
      btn.addEventListener("click", () => {
        this.draft.status = status;
        paint();
      });
      buttons.set(status, btn);
    }
    paint();

    // Linked article
    contentEl.createEl("label", { cls: "rico-roadmap-modal-label", text: "Article" });
    this.articleRowEl = contentEl.createDiv({ cls: "rico-roadmap-modal-article" });
    this.renderArticleRow();

    // Extra links
    contentEl.createEl("label", { cls: "rico-roadmap-modal-label", text: "Extra links (optional)" });
    this.linksEl = contentEl.createDiv({ cls: "rico-roadmap-modal-links" });
    this.renderLinks();

    // Actions
    const actions = contentEl.createDiv({ cls: "rico-roadmap-modal-actions" });
    const cancel = actions.createEl("button", { text: "Cancel", attr: { type: "button" } });
    cancel.addEventListener("click", () => this.close());
    const submit = actions.createEl("button", {
      cls: "mod-cta",
      text: this.isEdit ? "Save" : "Add card",
      attr: { type: "button" },
    });
    submit.addEventListener("click", () => this.submit());

    titleEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.submit();
    });
    window.setTimeout(() => titleEl.focus(), 0);
  }

  private renderArticleRow(): void {
    this.articleRowEl.empty();
    const label = this.draft.articlePath || "No note linked";
    this.articleRowEl.createSpan({
      cls: `rico-roadmap-modal-path${this.draft.articlePath ? "" : " is-empty"}`,
      text: label,
    });
    const pick = this.articleRowEl.createEl("button", {
      text: this.draft.articlePath ? "Change" : "Pick note",
      attr: { type: "button" },
    });
    pick.addEventListener("click", () => {
      new ArticleSuggestModal(this.app, (path) => {
        this.draft.articlePath = path;
        // Borrow the note's name when the title is still blank.
        if (!this.draft.title.trim()) this.draft.title = basename(path);
        this.renderArticleRow();
        const titleInput = this.contentEl.querySelector(".rico-roadmap-modal-input") as HTMLInputElement | null;
        if (titleInput) titleInput.value = this.draft.title;
      }).open();
    });
    if (this.draft.articlePath) {
      const clear = this.articleRowEl.createEl("button", { text: "Clear", attr: { type: "button" } });
      clear.addEventListener("click", () => {
        this.draft.articlePath = "";
        this.renderArticleRow();
      });
    }
  }

  private renderLinks(): void {
    this.linksEl.empty();
    this.draft.links.forEach((link, i) => {
      const row = this.linksEl.createDiv({ cls: "rico-roadmap-modal-link" });
      const labelEl = row.createEl("input", { attr: { placeholder: "Label" } });
      labelEl.type = "text";
      labelEl.value = link.label;
      labelEl.addEventListener("input", () => {
        this.draft.links[i].label = labelEl.value;
      });
      const urlEl = row.createEl("input", { attr: { placeholder: "https://…" } });
      urlEl.type = "url";
      urlEl.value = link.url;
      urlEl.addEventListener("input", () => {
        this.draft.links[i].url = urlEl.value;
      });
      const remove = row.createEl("button", { text: "✕", attr: { type: "button", "aria-label": "Remove link" } });
      remove.addEventListener("click", () => {
        this.draft.links.splice(i, 1);
        this.renderLinks();
      });
    });
    const add = this.linksEl.createEl("button", {
      cls: "rico-roadmap-modal-addlink",
      text: "+ Add link",
      attr: { type: "button" },
    });
    add.addEventListener("click", () => {
      this.draft.links.push({ label: "", url: "" });
      this.renderLinks();
    });
  }

  private submit(): void {
    if (!this.draft.title.trim() && !this.draft.articlePath) {
      new Notice("Give the card a title or link a note.");
      return;
    }
    // Drop half-filled link rows.
    const links = this.draft.links
      .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
      .filter((l) => l.url)
      .map((l) => ({ label: l.label || l.url, url: l.url }));
    this.onSubmit({ ...this.draft, title: this.draft.title.trim(), links });
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
