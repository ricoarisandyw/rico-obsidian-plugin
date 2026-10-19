import { Menu, TFile } from "obsidian";
import { FolderBaseConfig } from "./config";
import { ColumnType, Row, formatValue, parseInputValue } from "./data";

export interface TableHandlers {
  onSortCycle(column: string): void;
  onHideColumn(column: string): void;
  onCommit(file: TFile, key: string, value: unknown): Promise<void>;
  onOpenNote(file: TFile, newLeaf: boolean): void;
  onEditorOpen(): void;
  onEditorClose(): void;
}

const URL_RE = /^https?:\/\//;

export function renderTable(
  container: HTMLElement,
  rows: Row[],
  columns: string[],
  types: Map<string, ColumnType>,
  config: FolderBaseConfig,
  handlers: TableHandlers
): void {
  container.empty();
  const table = container.createEl("table", { cls: "folder-base-table" });
  const headRow = table.createEl("thead").createEl("tr");

  attachHeader(headRow.createEl("th"), "Name", "name", config, handlers, false);
  for (const col of columns) {
    attachHeader(headRow.createEl("th"), col, col, config, handlers, true);
  }

  const tbody = table.createEl("tbody");
  for (const row of rows) {
    const tr = tbody.createEl("tr");
    const nameTd = tr.createEl("td", { cls: "folder-base-name-cell" });
    const link = nameTd.createEl("a", {
      text: row.file.basename,
      cls: "internal-link",
      href: "#",
    });
    link.addEventListener("click", (ev) => {
      ev.preventDefault();
      handlers.onOpenNote(row.file, ev.ctrlKey || ev.metaKey);
    });
    for (const col of columns) {
      renderCell(tr.createEl("td"), row, col, types.get(col) ?? "text", handlers);
    }
  }
}

function attachHeader(
  th: HTMLElement,
  label: string,
  column: string,
  config: FolderBaseConfig,
  handlers: TableHandlers,
  hideable: boolean
): void {
  th.addClass("folder-base-header");
  th.createSpan({ text: label });
  const sort = config.sort;
  if (sort && sort.column === column) {
    th.createSpan({
      cls: "folder-base-sort-indicator",
      text: sort.direction === "asc" ? " ↑" : " ↓",
    });
  }
  th.addEventListener("click", () => handlers.onSortCycle(column));
  if (hideable) {
    th.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle(`Hide column "${column}"`)
          .setIcon("eye-off")
          .onClick(() => handlers.onHideColumn(column))
      );
      menu.showAtMouseEvent(ev);
    });
  }
}

function renderCell(
  td: HTMLElement,
  row: Row,
  key: string,
  type: ColumnType,
  handlers: TableHandlers
): void {
  td.addClass("folder-base-cell");

  if (type === "checkbox") {
    const cb = td.createEl("input", { type: "checkbox" });
    cb.checked = row.frontmatter[key] === true;
    cb.addEventListener("change", () => {
      row.frontmatter[key] = cb.checked;
      void handlers.onCommit(row.file, key, cb.checked);
    });
    return;
  }

  const draw = () => {
    td.empty();
    const value = row.frontmatter[key];
    const text = formatValue(value);
    if (typeof value === "string" && URL_RE.test(text)) {
      td.createEl("a", { text, href: text, cls: "external-link" });
    } else {
      td.setText(text);
    }
  };
  draw();

  td.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).tagName === "A") return;
    if (td.querySelector("input")) return;
    beginEdit(td, row, key, type, handlers, draw);
  });
}

function beginEdit(
  td: HTMLElement,
  row: Row,
  key: string,
  type: ColumnType,
  handlers: TableHandlers,
  draw: () => void
): void {
  const original = row.frontmatter[key];
  td.empty();
  const input = td.createEl("input", {
    type: type === "date" ? "date" : "text",
    cls: "folder-base-cell-input",
  });
  input.value = formatValue(original);
  handlers.onEditorOpen();
  input.focus();
  input.select();

  let done = false;
  const finish = async (commit: boolean) => {
    if (done) return;
    done = true;
    if (commit) {
      const newValue = parseInputValue(input.value, type);
      const changed =
        JSON.stringify(newValue ?? null) !== JSON.stringify(original ?? null);
      if (changed) {
        row.frontmatter[key] = newValue;
        draw();
        handlers.onEditorClose();
        await handlers.onCommit(row.file, key, newValue);
        return;
      }
    }
    draw();
    handlers.onEditorClose();
  };

  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void finish(true);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      void finish(false);
    }
  });
  input.addEventListener("blur", () => void finish(true));
}
