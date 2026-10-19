export interface FolderBaseConfig {
  version: 1;
  folder: string;
  columns: string[];
  sort: { column: string; direction: "asc" | "desc" } | null;
  columnWidths: Record<string, number>;
}

export function defaultConfig(folder = ""): FolderBaseConfig {
  return { version: 1, folder, columns: [], sort: null, columnWidths: {} };
}

export function parseConfig(data: string): FolderBaseConfig {
  if (data.trim() === "") return defaultConfig();
  const raw = JSON.parse(data) as Record<string, unknown>;
  const def = defaultConfig();
  const sort = raw.sort as { column?: unknown; direction?: unknown } | null | undefined;
  return {
    version: 1,
    folder: typeof raw.folder === "string" ? raw.folder : def.folder,
    columns: Array.isArray(raw.columns)
      ? raw.columns.filter((c): c is string => typeof c === "string")
      : [],
    sort:
      sort && typeof sort.column === "string" && (sort.direction === "asc" || sort.direction === "desc")
        ? { column: sort.column, direction: sort.direction }
        : null,
    columnWidths:
      raw.columnWidths && typeof raw.columnWidths === "object"
        ? (raw.columnWidths as Record<string, number>)
        : {},
  };
}

export function serializeConfig(config: FolderBaseConfig): string {
  return JSON.stringify(config, null, 2);
}
