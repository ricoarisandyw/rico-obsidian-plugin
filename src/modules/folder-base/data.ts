import { App, TFile } from "obsidian";

export type ColumnType = "text" | "number" | "checkbox" | "date" | "list";

export interface Row {
  file: TFile;
  frontmatter: Record<string, unknown>;
}

export function collectRows(app: App, folderPath: string): Row[] {
  const folder = app.vault.getFolderByPath(folderPath);
  if (!folder) return [];
  const rows: Row[] = [];
  for (const child of folder.children) {
    if (child instanceof TFile && child.extension === "md") {
      const fm = app.metadataCache.getFileCache(child)?.frontmatter ?? {};
      rows.push({ file: child, frontmatter: { ...fm } });
    }
  }
  rows.sort((a, b) => a.file.basename.localeCompare(b.file.basename));
  return rows;
}

export function discoverColumns(rows: Row[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.frontmatter)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUM_RE = /^-?\d+(\.\d+)?$/;

export function inferColumnType(rows: Row[], key: string): ColumnType {
  let sawValue = false;
  let allList = true;
  let allBool = true;
  let allNum = true;
  let allDate = true;
  for (const row of rows) {
    const v = row.frontmatter[key];
    if (v === undefined || v === null || v === "") continue;
    sawValue = true;
    if (!Array.isArray(v)) allList = false;
    if (typeof v !== "boolean") allBool = false;
    if (!(typeof v === "number" || (typeof v === "string" && NUM_RE.test(v)))) allNum = false;
    if (!(typeof v === "string" && DATE_RE.test(v))) allDate = false;
  }
  if (!sawValue) return "text";
  if (allList) return "list";
  if (allBool) return "checkbox";
  if (allNum) return "number";
  if (allDate) return "date";
  return "text";
}

export function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map((v) => String(v ?? "")).join(", ");
  return String(value);
}

export function parseInputValue(raw: string, type: ColumnType): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  switch (type) {
    case "list":
      return trimmed
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    case "number": {
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : trimmed;
    }
    default:
      return trimmed;
  }
}
