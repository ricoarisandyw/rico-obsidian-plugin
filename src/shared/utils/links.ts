import { App, TFile } from "obsidian";

/**
 * Return the notes related to `file` via Obsidian links — both outgoing links
 * and backlinks — using only public metadata APIs.
 *
 * - Outgoing: keys of `resolvedLinks[file.path]`.
 * - Backlinks: source paths whose `resolvedLinks[src]` contains `file.path`.
 *
 * The result is deduped, excludes the file itself, mapped to TFiles, and sorted
 * by basename.
 */
export function getRelatedFiles(app: App, file: TFile): TFile[] {
  const resolved = app.metadataCache.resolvedLinks ?? {};
  const paths = new Set<string>();

  // Outgoing links from this note.
  const outgoing = resolved[file.path];
  if (outgoing) {
    for (const target of Object.keys(outgoing)) paths.add(target);
  }

  // Backlinks: any source that links to this note.
  for (const src of Object.keys(resolved)) {
    if (resolved[src]?.[file.path]) paths.add(src);
  }

  // Never include the note itself.
  paths.delete(file.path);

  const files: TFile[] = [];
  for (const path of paths) {
    const abstract = app.vault.getAbstractFileByPath(path);
    if (abstract instanceof TFile) files.push(abstract);
  }

  files.sort((a, b) => a.basename.localeCompare(b.basename));
  return files;
}
