import { ItemView, Notice, Plugin, WorkspaceLeaf } from "obsidian";

export const VIEW_TYPE_TYPING_GAME = "typing-game";

export function cleanMarkdown(raw: string): string {
  return raw
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^>\s*/gm, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractChunk(rawContent: string): string | null {
  const clean = cleanMarkdown(rawContent);
  if (!clean) return null;
  if (clean.length <= 100) return clean;

  const parts = clean.split(/\.\s+/);
  const sentences = parts
    .map((p, i) => (i < parts.length - 1 ? p + "." : p))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length <= 1) {
    return clean.slice(0, 100);
  }

  const startIdx = Math.floor(Math.random() * sentences.length);
  let result = "";
  let i = 0;

  while (result.length < 100 && i < sentences.length) {
    const s = sentences[(startIdx + i) % sentences.length];
    result = result ? result + " " + s : s;
    i++;
  }

  return result.trim();
}

export class TypingGameView extends ItemView {
  private timerInterval: any = null;
  private filename = "";
  private rawContent = "";
  private targetText = "";
  private typedText = "";
  private startTime: number | null = null;
  private isFinished = false;

  private wpmEl!: HTMLElement;
  private accEl!: HTMLElement;
  private timerEl!: HTMLElement;
  private progressFill!: HTMLElement;
  private textEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private resultEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_TYPING_GAME;
  }
  getDisplayText(): string {
    return "Typing Game";
  }
  getIcon(): string {
    return "keyboard";
  }

  async onOpen(): Promise<void> {}

  async startGame(filename: string, rawContent: string): Promise<void> {
    if (this.timerInterval) clearInterval(this.timerInterval);

    this.filename = filename;
    this.rawContent = rawContent;
    this.typedText = "";
    this.startTime = null;
    this.isFinished = false;

    const chunk = extractChunk(rawContent);
    if (!chunk) {
      new Notice("Could not extract readable text from this note.");
      return;
    }
    this.targetText = chunk;
    this.buildUI();
  }

  buildUI(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.className = (root.className + " tg-root").trim();

    const wrapper = root.createEl("div", { cls: "tg-wrapper" });

    this.buildHeader(wrapper);
    this.buildProgressBar(wrapper);
    this.buildTextDisplay(wrapper);
    this.buildInput(wrapper);

    wrapper.createEl("p", {
      cls: "tg-hint",
      text: "Click the text area below and start typing — Esc to get a new chunk",
    });

    this.resultEl = wrapper.createEl("div", { cls: "tg-result" });
    setTimeout(() => this.inputEl?.focus(), 50);
  }

  buildHeader(wrapper: HTMLElement): void {
    const header = wrapper.createEl("div", { cls: "tg-header" });
    header.createEl("span", {
      cls: "tg-filename",
      text: `📄 ${this.filename}`,
    });

    const stats = header.createEl("div", { cls: "tg-stats" });
    this.wpmEl = stats.createEl("span", { cls: "tg-stat", text: "WPM: —" });
    this.accEl = stats.createEl("span", { cls: "tg-stat", text: "Accuracy: —" });
    this.timerEl = stats.createEl("span", { cls: "tg-stat", text: "Time: 0s" });
  }

  buildProgressBar(wrapper: HTMLElement): void {
    const bar = wrapper.createEl("div", { cls: "tg-progress-bar" });
    this.progressFill = bar.createEl("div", { cls: "tg-progress-fill" });
  }

  buildTextDisplay(wrapper: HTMLElement): void {
    this.textEl = wrapper.createEl("div", { cls: "tg-text" });
    this.textEl.addEventListener("click", () => this.inputEl && this.inputEl.focus());
    this.renderChars();
  }

  buildInput(wrapper: HTMLElement): void {
    this.inputEl = wrapper.createEl("textarea", { cls: "tg-input" });
    this.inputEl.placeholder = "Type here…";
    this.inputEl.spellcheck = false;
    this.inputEl.setAttribute("autocorrect", "off");
    this.inputEl.setAttribute("autocapitalize", "none");
    this.inputEl.setAttribute("autocomplete", "off");

    this.inputEl.addEventListener("input", () => this.handleInput());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.tryAgain();
    });
  }

  renderChars(): void {
    this.textEl.empty();
    for (let i = 0; i < this.targetText.length; i++) {
      const ch = this.targetText[i];
      const span = this.textEl.createEl("span", { text: ch });

      if (i < this.typedText.length) {
        span.addClass(this.typedText[i] === ch ? "tg-correct" : "tg-wrong");
      } else if (i === this.typedText.length) {
        span.addClass("tg-cursor");
      }
    }
  }

  handleInput(): void {
    if (this.isFinished) return;

    let val = this.inputEl.value;
    if (val.length > this.targetText.length) {
      val = val.slice(0, this.targetText.length);
      this.inputEl.value = val;
    }
    this.typedText = val;

    if (this.typedText.length === 1 && !this.startTime) {
      this.startTime = Date.now();
      this.startTimer();
      this.wpmEl.addClass("active");
      this.accEl.addClass("active");
      this.timerEl.addClass("active");
    }

    this.renderChars();
    this.updateStats();
    this.updateProgress();

    if (this.typedText.length === this.targetText.length) {
      this.finish();
    }
  }

  updateStats(): void {
    if (!this.startTime) return;
    const elapsed = (Date.now() - this.startTime) / 1000;
    const wpm =
      elapsed > 0
        ? Math.round(this.typedText.length / 5 / (elapsed / 60))
        : 0;

    let correct = 0;
    for (let i = 0; i < this.typedText.length; i++) {
      if (this.typedText[i] === this.targetText[i]) correct++;
    }
    const acc =
      this.typedText.length > 0
        ? Math.round((correct / this.typedText.length) * 100)
        : 100;

    this.wpmEl.textContent = `WPM: ${wpm}`;
    this.accEl.textContent = `Accuracy: ${acc}%`;
  }

  updateProgress(): void {
    const pct = (this.typedText.length / this.targetText.length) * 100;
    this.progressFill.style.width = `${pct}%`;
  }

  startTimer(): void {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (!this.startTime || this.isFinished) return;
      const s = Math.floor((Date.now() - this.startTime) / 1000);
      this.timerEl.textContent = `Time: ${s}s`;
    }, 500);
  }

  finish(): void {
    this.isFinished = true;
    clearInterval(this.timerInterval);
    this.progressFill.style.width = "100%";

    const elapsed = (Date.now() - this.startTime!) / 1000;
    const wpm = Math.round(this.targetText.length / 5 / (elapsed / 60));

    let correct = 0;
    for (let i = 0; i < this.typedText.length; i++) {
      if (this.typedText[i] === this.targetText[i]) correct++;
    }
    const acc = Math.round((correct / this.targetText.length) * 100);
    const errors = this.targetText.length - correct;

    this.resultEl.empty();
    this.resultEl.addClass("tg-result-visible");
    this.resultEl.createEl("div", { cls: "tg-result-title", text: "🎉 Complete!" });

    const grid = this.resultEl.createEl("div", { cls: "tg-result-grid" });
    const addCell = (value: any, label: string) => {
      const cell = grid.createEl("div", { cls: "tg-result-cell" });
      cell.createEl("div", { cls: "tg-result-value", text: String(value) });
      cell.createEl("div", { cls: "tg-result-label", text: label });
    };

    addCell(wpm, "WPM");
    addCell(`${acc}%`, "Accuracy");
    addCell(`${elapsed.toFixed(1)}s`, "Time");
    addCell(errors, "Errors");

    const btn = this.resultEl.createEl("button", {
      cls: "tg-retry-btn",
      text: "↺ New Chunk",
    });
    btn.addEventListener("click", () => this.tryAgain());
    this.resultEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async tryAgain(): Promise<void> {
    await this.startGame(this.filename, this.rawContent);
  }

  async onClose(): Promise<void> {
    if (this.timerInterval) clearInterval(this.timerInterval);
  }
}

export function registerTypingGame(plugin: Plugin): void {
  plugin.registerView(
    VIEW_TYPE_TYPING_GAME,
    (leaf) => new TypingGameView(leaf)
  );

  plugin.addRibbonIcon("keyboard", "Typing Game", () =>
    launchTypingGameFromActiveFile(plugin)
  );

  plugin.addCommand({
    id: "start-typing-game",
    name: "Start Typing Game from current note",
    callback: () => launchTypingGameFromActiveFile(plugin),
  });
}

async function launchTypingGameFromActiveFile(plugin: Plugin): Promise<void> {
  const file = plugin.app.workspace.getActiveFile();
  if (!file) {
    new Notice("Open a note first, then launch the Typing Game.");
    return;
  }

  const content = await plugin.app.vault.read(file);
  const { workspace } = plugin.app;

  let leaf = workspace.getLeavesOfType(VIEW_TYPE_TYPING_GAME)[0];
  if (!leaf) {
    leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_TYPING_GAME, active: true });
  }
  workspace.revealLeaf(leaf);

  const view = leaf.view;
  if (view instanceof TypingGameView) {
    await view.startGame(file.basename, content);
  }
}
