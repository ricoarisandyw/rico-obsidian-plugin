import {
  App,
  FuzzySuggestModal,
  Menu,
  Modal,
  Setting,
  TextFileView,
  TFolder,
  WorkspaceLeaf,
  debounce,
} from "obsidian";
import {
  FolderBaseConfig,
  defaultConfig,
  parseConfig,
  serializeConfig,
} from "./config";
import {
  ColumnType,
  Row,
  collectRows,
  discoverColumns,
  inferColumnType,
} from "./data";
import { renderTable } from "./table";
import { FrontmatterWriter } from "./writer";

export const VIEW_TYPE_FBASE = "folder-base-view";

export class FolderBaseView extends TextFileView {
  config: FolderBaseConfig = defaultConfig();
  private writer: FrontmatterWriter;
  private parseError: string | null = null;
  private editorsOpen = 0;
  private pendingRefresh = false;
  private scheduleRefresh = debounce(() => this.refresh(), 250, true);

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.writer = new FrontmatterWriter(this.app);
  }

  getViewType(): string {
    return VIEW_TYPE_FBASE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Folder base";
  }

  getIcon(): string {
    return "table";
  }

  setViewData(data: string, _clear: boolean): void {
    this.data = data;
    try {
      this.config = parseConfig(data);
      this.parseError = null;
    } catch (e) {
      this.parseError = e instanceof Error ? e.message : String(e);
    }
    this.refresh();
  }

  getViewData(): string {
    this.data = serializeConfig(this.config);
    return this.data;
  }

  clear(): void {
    this.config = defaultConfig();
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("folder-base-content");

    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (!this.isInTargetFolder(file.path)) return;
        if (this.writer.consumeSelfWrite(file.path)) return;
        this.scheduleRefresh();
      })
    );
    this.registerEvent(
      this.app.vault.on("create", (f) => {
        if (this.isInTargetFolder(f.path)) this.scheduleRefresh();
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (f) => {
        if (this.isInTargetFolder(f.path)) this.scheduleRefresh();
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (f, oldPath) => {
        if (oldPath === this.config.folder && f instanceof TFolder) {
          this.config.folder = f.path;
          this.requestSave();
          this.scheduleRefresh();
          return;
        }
        if (this.isInTargetFolder(oldPath) || this.isInTargetFolder(f.path)) {
          this.scheduleRefresh();
        }
      })
    );
  }

  private isInTargetFolder(path: string): boolean {
    const folder = this.config.folder;
    if (!folder) return false;
    const idx = path.lastIndexOf("/");
    const parent = idx === -1 ? "" : path.substring(0, idx);
    return parent === folder || (folder === "/" && parent === "");
  }

  refresh(): void {
    if (this.editorsOpen > 0) {
      this.pendingRefresh = true;
      return;
    }
    this.pendingRefresh = false;
    const el = this.contentEl;
    const scrollTop = el.scrollTop;
    el.empty();

    if (this.parseError) {
      el.createDiv({
        cls: "folder-base-error",
        text: `Invalid .fbase file: ${this.parseError}`,
      });
      return;
    }

    const folderExists =
      this.config.folder && this.app.vault.getFolderByPath(this.config.folder);
    if (!folderExists) {
      const empty = el.createDiv({ cls: "folder-base-empty" });
      empty.createEl("p", {
        text: this.config.folder
          ? `Folder not found: ${this.config.folder}`
          : "No folder selected.",
      });
      const btn = empty.createEl("button", { text: "Choose folder" });
      btn.addEventListener("click", () => this.chooseFolder());
      return;
    }

    const rows = collectRows(this.app, this.config.folder);
    const discovered = discoverColumns(rows);
    const columns =
      this.config.columns.length > 0 ? this.config.columns.slice() : discovered;
    const types = new Map<string, ColumnType>();
    for (const col of columns) types.set(col, inferColumnType(rows, col));

    this.sortRows(rows, types);

    this.renderToolbar(el, rows.length, discovered);
    const wrap = el.createDiv({ cls: "folder-base-table-wrap" });
    renderTable(wrap, rows, columns, types, this.config, {
      onSortCycle: (col) => this.cycleSort(col),
      onHideColumn: (col) => this.hideColumn(col, discovered),
      onCommit: (file, key, value) => this.writer.writeCell(file, key, value),
      onOpenNote: (file, newLeaf) =>
        this.app.workspace.openLinkText(file.path, "", newLeaf),
      onEditorOpen: () => {
        this.editorsOpen++;
      },
      onEditorClose: () => {
        this.editorsOpen = Math.max(0, this.editorsOpen - 1);
        if (this.editorsOpen === 0 && this.pendingRefresh) this.scheduleRefresh();
      },
    });
    el.scrollTop = scrollTop;
  }

  private sortRows(rows: Row[], types: Map<string, ColumnType>): void {
    const sort = this.config.sort;
    if (!sort) return;
    const dir = sort.direction === "asc" ? 1 : -1;
    const col = sort.column;
    const type = types.get(col);
    const isEmpty = (v: unknown) => v === undefined || v === null || v === "";
    rows.sort((a, b) => {
      const av = col === "name" ? a.file.basename : a.frontmatter[col];
      const bv = col === "name" ? b.file.basename : b.frontmatter[col];
      if (isEmpty(av) && isEmpty(bv)) return 0;
      if (isEmpty(av)) return 1;
      if (isEmpty(bv)) return -1;
      if (type === "number") return (Number(av) - Number(bv)) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  private cycleSort(column: string): void {
    const sort = this.config.sort;
    if (!sort || sort.column !== column) {
      this.config.sort = { column, direction: "asc" };
    } else if (sort.direction === "asc") {
      this.config.sort = { column, direction: "desc" };
    } else {
      this.config.sort = null;
    }
    this.requestSave();
    this.refresh();
  }

  private visibleColumns(discovered: string[]): string[] {
    return this.config.columns.length > 0
      ? this.config.columns.slice()
      : discovered.slice();
  }

  private hideColumn(column: string, discovered: string[]): void {
    this.config.columns = this.visibleColumns(discovered).filter(
      (c) => c !== column
    );
    this.requestSave();
    this.refresh();
  }

  private renderToolbar(
    el: HTMLElement,
    rowCount: number,
    discovered: string[]
  ): void {
    const bar = el.createDiv({ cls: "folder-base-toolbar" });
    bar.createSpan({ cls: "folder-base-title", text: this.config.folder });
    bar.createSpan({ cls: "folder-base-count", text: `${rowCount} notes` });
    bar.createDiv({ cls: "folder-base-spacer" });

    const colsBtn = bar.createEl("button", { text: "Columns" });
    colsBtn.addEventListener("click", (ev) =>
      this.showColumnsMenu(ev, discovered)
    );

    const addBtn = bar.createEl("button", { text: "+ Column" });
    addBtn.addEventListener("click", () => {
      new TextPromptModal(this.app, "New property name", (name) => {
        const key = name.trim();
        if (!key) return;
        const visible = this.visibleColumns(discovered);
        if (!visible.includes(key)) visible.push(key);
        this.config.columns = visible;
        this.requestSave();
        this.refresh();
      }).open();
    });

    const folderBtn = bar.createEl("button", { text: "Change folder" });
    folderBtn.addEventListener("click", () => this.chooseFolder());
  }

  private showColumnsMenu(ev: MouseEvent, discovered: string[]): void {
    const all = [...new Set([...discovered, ...this.config.columns])];
    const visible = new Set(this.visibleColumns(discovered));
    const menu = new Menu();
    for (const col of all) {
      menu.addItem((item) =>
        item
          .setTitle(col)
          .setChecked(visible.has(col))
          .onClick(() => {
            const vis = this.visibleColumns(discovered);
            this.config.columns = vis.includes(col)
              ? vis.filter((c) => c !== col)
              : [...vis, col];
            this.requestSave();
            this.refresh();
          })
      );
    }
    menu.showAtMouseEvent(ev);
  }

  private chooseFolder(): void {
    new FolderSuggestModal(this.app, (folder) => {
      this.config.folder = folder.path;
      this.requestSave();
      this.refresh();
    }).open();
  }
}

class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  constructor(app: App, private onChoose: (folder: TFolder) => void) {
    super(app);
    this.setPlaceholder("Choose a folder…");
  }

  getItems(): TFolder[] {
    return this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder);
  }

  getItemText(folder: TFolder): string {
    return folder.path;
  }

  onChooseItem(folder: TFolder): void {
    this.onChoose(folder);
  }
}

class TextPromptModal extends Modal {
  private value = "";

  constructor(app: App, private title: string, private onSubmit: (value: string) => void) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.title);
    const setting = new Setting(this.contentEl);
    setting.addText((text) => {
      text.onChange((v) => (this.value = v));
      text.inputEl.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          this.submit();
        }
      });
      window.setTimeout(() => text.inputEl.focus(), 0);
    });
    new Setting(this.contentEl).addButton((btn) =>
      btn.setButtonText("Add").setCta().onClick(() => this.submit())
    );
  }

  private submit(): void {
    this.close();
    this.onSubmit(this.value);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
