import { ItemView, Keymap, MarkdownView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { copyBlockLink } from "./link";
import {
  BlockRow,
  BlockSummary,
  BrokenRef,
  filterRows,
  summarize,
  totalCitations,
} from "./references";
import { BlockIndex } from "./scanner";

export const NOTE_VIEW_TYPE = "rico-block-refs-note";
export const VAULT_VIEW_TYPE = "rico-block-refs-vault";

const RENDER_DELAY_MS = 250;

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const baseName = (path: string): string => path.replace(/^.*\//, "").replace(/\.md$/i, "");

/** Shared plumbing: refresh when notes change, and small helpers to draw rows. */
abstract class BlockRefsView extends ItemView {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private renderId = 0;

  constructor(leaf: WorkspaceLeaf, protected index: BlockIndex) {
    super(leaf);
  }

  abstract getViewType(): string;
  abstract getDisplayText(): string;
  /** Rebuild the content. `isStale()` turns true when a newer refresh has started. */
  protected abstract render(isStale: () => boolean): Promise<void>;

  getIcon(): string {
    return "link";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("rico-blockrefs");
    const { metadataCache, vault } = this.app;

    this.registerEvent(metadataCache.on("changed", () => this.schedule()));
    this.registerEvent(metadataCache.on("resolved", () => this.schedule()));
    this.registerEvent(metadataCache.on("deleted", () => this.schedule()));
    this.registerEvent(vault.on("rename", () => this.schedule()));
    this.watch();
    this.refresh();
  }

  async onClose(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.renderId++;
  }

  /** Subclasses add their own events here. */
  protected watch(): void {}

  protected schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refresh();
    }, RENDER_DELAY_MS);
  }

  protected refresh(): void {
    const id = ++this.renderId;
    void this.render(() => id !== this.renderId);
  }

  protected openBlock(path: string, id: string, event: MouseEvent): void {
    void this.app.workspace.openLinkText(`${path}#^${id}`, "", Keymap.isModEvent(event));
  }

  protected openNote(path: string, event: MouseEvent): void {
    void this.app.workspace.openLinkText(path, "", Keymap.isModEvent(event));
  }

  protected message(text: string): void {
    this.contentEl.empty();
    this.contentEl.createDiv({ cls: "rico-blockrefs-empty", text });
  }

  /** One block: its id, how often it is cited, the text, and who cites it. */
  protected drawRow(parent: HTMLElement, row: BlockRow): void {
    const el = parent.createDiv({ cls: "rico-blockrefs-row" });
    el.addEventListener("click", (event) => this.openBlock(row.path, row.id, event));

    const head = el.createDiv({ cls: "rico-blockrefs-head" });
    head.createEl("code", { cls: "rico-blockrefs-id", text: `^${row.id}` });
    const total = totalCitations(row);
    head.createSpan({
      cls: total === 0 ? "rico-blockrefs-count rico-blockrefs-unused" : "rico-blockrefs-count",
      text: total === 0 ? "not cited" : `cited ${total}×`,
    });
    const copy = head.createEl("button", {
      cls: "clickable-icon rico-blockrefs-copy",
      attr: { "aria-label": "Copy link to this block" },
    });
    setIcon(copy, "copy");
    copy.addEventListener("click", (event) => {
      event.stopPropagation();
      const file = this.app.vault.getAbstractFileByPath(row.path);
      void copyBlockLink(this.app, file instanceof TFile ? file : null, row.id);
    });

    el.createDiv({ cls: "rico-blockrefs-snippet", text: row.snippet || "(no text)" });

    if (row.cited.length > 0) {
      const cited = el.createDiv({ cls: "rico-blockrefs-cited" });
      for (const citation of row.cited) {
        const chip = cited.createEl("a", {
          cls: "rico-blockrefs-chip",
          text: citation.count > 1 ? `${baseName(citation.source)} ×${citation.count}` : baseName(citation.source),
          attr: { title: citation.source },
        });
        chip.addEventListener("click", (event) => {
          event.stopPropagation();
          this.openNote(citation.source, event);
        });
      }
    }
  }

  /** Links like `[[Note#^id]]` whose block no longer exists. */
  protected drawBroken(parent: HTMLElement, broken: BrokenRef[], showSource: boolean): void {
    if (broken.length === 0) return;
    parent.createEl("h6", { cls: "rico-blockrefs-section", text: `Broken links (${broken.length})` });
    for (const ref of broken) {
      const el = parent.createDiv({ cls: "rico-blockrefs-row rico-blockrefs-broken" });
      el.addEventListener("click", (event) => this.openNote(ref.source, event));
      const head = el.createDiv({ cls: "rico-blockrefs-head" });
      head.createEl("code", { cls: "rico-blockrefs-id", text: `${baseName(ref.target)}#^${ref.id}` });
      if (ref.count > 1) head.createSpan({ cls: "rico-blockrefs-count", text: `×${ref.count}` });
      el.createDiv({
        cls: "rico-blockrefs-snippet",
        text: showSource ? `Block not found. Linked from ${ref.source}` : "Block not found in that note",
      });
    }
  }
}

/** Right sidebar: the blocks of the note you are looking at. */
export class NoteBlocksView extends BlockRefsView {
  private file: TFile | null = null;

  getViewType(): string {
    return NOTE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Block references (this note)";
  }

  protected watch(): void {
    const { workspace } = this.app;
    this.file = this.markdownFile(workspace.getActiveFile());

    const follow = (file: TFile | null) => {
      const next = this.markdownFile(file);
      // Clicking inside this panel makes no file active: keep showing the last note.
      if (!next || next === this.file) return;
      this.file = next;
      this.refresh();
    };
    this.registerEvent(workspace.on("file-open", (file) => follow(file)));
    this.registerEvent(
      workspace.on("active-leaf-change", () => follow(workspace.getActiveViewOfType(MarkdownView)?.file ?? null))
    );
  }

  private markdownFile(file: TFile | null): TFile | null {
    return file && file.extension === "md" ? file : null;
  }

  protected async render(isStale: () => boolean): Promise<void> {
    const file = this.file;
    if (!file || !this.app.vault.getAbstractFileByPath(file.path)) {
      this.message("Open a note to see its block references.");
      return;
    }

    const blocks = await this.index.blocksOf(file);
    if (isStale()) return;
    const { rows, broken } = summarize(blocks, this.index.refs(), this.index.existing());
    const own = broken.filter((ref) => ref.source === file.path);

    this.contentEl.empty();
    const uncited = rows.filter((row) => row.cited.length === 0).length;
    this.contentEl.createDiv({ cls: "rico-blockrefs-title", text: file.basename });
    this.contentEl.createDiv({
      cls: "rico-blockrefs-stats",
      text: rows.length === 0 ? "No blocks" : `${plural(rows.length, "block")} · ${uncited} not cited`,
    });

    if (rows.length === 0 && own.length === 0) {
      this.message("No block references here yet. Select text, right-click, and choose “Make block reference”.");
      return;
    }
    for (const row of rows) this.drawRow(this.contentEl, row);
    this.drawBroken(this.contentEl, own, false);
  }
}

/** Left sidebar: every block in the vault, with search. */
export class VaultBlocksView extends BlockRefsView {
  private summary: BlockSummary = { rows: [], broken: [] };
  private query = "";
  private uncitedOnly = false;
  private statsEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;

  getViewType(): string {
    return VAULT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Block references (vault)";
  }

  protected async render(isStale: () => boolean): Promise<void> {
    const blocks = await this.index.allBlocks();
    if (isStale()) return;
    this.summary = summarize(blocks, this.index.refs(), this.index.existing());
    this.drawFrame();
    this.drawList();
  }

  /** Search box and filter. Built once per refresh so typing never loses focus. */
  private drawFrame(): void {
    this.contentEl.empty();

    const controls = this.contentEl.createDiv({ cls: "rico-blockrefs-controls" });
    const input = controls.createEl("input", {
      cls: "rico-blockrefs-search",
      type: "search",
      placeholder: "Search id, text or note…",
    });
    input.value = this.query;
    input.addEventListener("input", () => {
      this.query = input.value;
      this.drawList();
    });

    const label = controls.createEl("label", { cls: "rico-blockrefs-filter" });
    const box = label.createEl("input", { type: "checkbox" });
    box.checked = this.uncitedOnly;
    label.createSpan({ text: "Not cited only" });
    box.addEventListener("change", () => {
      this.uncitedOnly = box.checked;
      this.drawList();
    });

    this.statsEl = this.contentEl.createDiv({ cls: "rico-blockrefs-stats" });
    this.listEl = this.contentEl.createDiv({ cls: "rico-blockrefs-list" });
  }

  private drawList(): void {
    const { rows, broken } = this.summary;
    if (!this.listEl || !this.statsEl) return;

    const shown = filterRows(rows, this.query, this.uncitedOnly);
    const notes = new Set(rows.map((r) => r.path)).size;
    const uncited = rows.filter((r) => r.cited.length === 0).length;
    this.statsEl.setText(
      `${plural(rows.length, "block")} in ${plural(notes, "note")} · ${uncited} not cited · ${plural(broken.length, "broken link")}` +
        (shown.length !== rows.length ? ` · showing ${shown.length}` : "")
    );

    this.listEl.empty();
    if (rows.length === 0) {
      this.listEl.createDiv({ cls: "rico-blockrefs-empty", text: "No block references in this vault yet." });
    } else if (shown.length === 0) {
      this.listEl.createDiv({ cls: "rico-blockrefs-empty", text: "Nothing matches." });
    }

    let current = "";
    for (const row of shown) {
      if (row.path !== current) {
        current = row.path;
        this.listEl.createEl("h6", { cls: "rico-blockrefs-section", text: row.path });
      }
      this.drawRow(this.listEl, row);
    }
    if (!this.uncitedOnly && !this.query) this.drawBroken(this.listEl, broken, true);
  }
}
