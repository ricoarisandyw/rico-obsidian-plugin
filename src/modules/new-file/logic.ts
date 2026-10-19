import { parseExtensions } from "../../shared/utils/extensions";

/** Windows/macOS-unsafe characters, plus control characters. */
const ILLEGAL = /[\\:*?"<>|\u0000-\u001f]/;
const MAX_SEGMENT = 255;

export type NameResult =
  | { ok: true; path: string; extension: string; addedMd: boolean }
  | { ok: false; error: string };

function fail(error: string): NameResult {
  return { ok: false, error };
}

/** Markdown is always allowed. The settings list only counts while the code editor is on. */
export function allowedExtensions(visibleExtensions: string, codeEditorEnabled: boolean): string[] {
  const list = ["md"];
  if (codeEditorEnabled) {
    for (const ext of parseExtensions(visibleExtensions)) {
      if (!list.includes(ext)) list.push(ext);
    }
  }
  return list;
}

/**
 * Check what the user typed. Accepts "name.ext" or "folder/sub/name.ext".
 * A name with no extension becomes "<name>.md".
 */
export function checkFileName(input: string, allowed: string[]): NameResult {
  const raw = (input ?? "").trim();
  if (!raw) return fail("Type a file name, like notes.md or data.json.");
  if (ILLEGAL.test(raw)) return fail('Names can\'t contain \\ : * ? " < > |');

  const relative = raw.replace(/^\/+/, "");
  if (relative.endsWith("/")) return fail("Add a file name after the folder, like utils/helpers.ts.");

  const segments = relative.split("/");
  for (const segment of segments) {
    if (segment === "") return fail("Folder names can't be empty (check for //).");
    if (segment === "." || segment === "..") return fail("Names can't contain . or .. parts.");
    if (segment.startsWith(".")) return fail("Names can't start with a dot.");
    if (/[. ]$/.test(segment)) return fail("Names can't end with a dot or a space.");
    if (segment.length > MAX_SEGMENT) return fail("That name is too long.");
  }

  const last = segments[segments.length - 1];
  const dot = last.lastIndexOf(".");

  if (dot === -1) {
    segments[segments.length - 1] = `${last}.md`;
    return { ok: true, path: segments.join("/"), extension: "md", addedMd: true };
  }

  const extension = last.slice(dot + 1).toLowerCase();
  if (!allowed.includes(extension)) {
    return fail(`".${extension}" isn't allowed. Allowed: ${allowed.join(", ")}.`);
  }
  return { ok: true, path: segments.join("/"), extension, addedMd: false };
}

/** The folder a new file goes in: the clicked folder, or the parent of a clicked file. "" = vault root. */
export function resolveTargetFolder(clickedPath: string, isFolder: boolean): string {
  const clean = (clickedPath ?? "").replace(/^\/+|\/+$/g, "");
  if (isFolder) return clean;
  const slash = clean.lastIndexOf("/");
  return slash === -1 ? "" : clean.slice(0, slash);
}

export function joinPath(folder: string, relative: string): string {
  return folder ? `${folder}/${relative}` : relative;
}
