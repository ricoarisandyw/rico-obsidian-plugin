/**
 * Putting a diagram's relations into Obsidian's link index, so they show up in
 * Graph View and in the backlink panel.
 *
 * `resolvedLinks` / `unresolvedLinks` are documented for reading, not writing.
 * Writing to them is what makes diagram edges visible to the native graph, and
 * other plugins do the same, but it is an internal structure that a future
 * Obsidian release could change. Everything that depends on that assumption is
 * confined to this file and written defensively: if the shape is not what we
 * expect, we leave the index alone rather than corrupting it.
 *
 * Only our own entries are ever removed, tracked per source file, so a note's
 * real links are never touched.
 */

import { App, TFile } from "obsidian";

/** What we added for one note, so it can be taken back out again. */
interface Contribution {
  /** Destination paths we incremented in `resolvedLinks[source]`. */
  resolved: string[];
  /** Destination names we incremented in `unresolvedLinks[source]`. */
  unresolved: string[];
}

export class MermaidGraphIndex {
  private contributions = new Map<string, Contribution>();

  constructor(private app: App) {}

  /**
   * Replace this note's diagram-derived links with `linktexts`.
   *
   * `sourcePath` is the note holding the diagram; each linktext is resolved
   * the way Obsidian would resolve it from that note, so a link lands on the
   * same file a wikilink in the body would.
   */
  update(sourcePath: string, linktexts: readonly string[]): void {
    this.clearFor(sourcePath);
    if (linktexts.length === 0) return;

    const resolved = this.resolvedFor(sourcePath);
    const unresolved = this.unresolvedFor(sourcePath);
    if (!resolved || !unresolved) return;

    const added: Contribution = { resolved: [], unresolved: [] };

    for (const linktext of new Set(linktexts)) {
      // Strip the subpath: the graph links notes, not headings.
      const name = linktext.split("#")[0].trim();
      if (!name) continue;

      const file = this.app.metadataCache.getFirstLinkpathDest(name, sourcePath);
      if (file instanceof TFile) {
        if (file.path === sourcePath) continue; // never self-link
        resolved[file.path] = (resolved[file.path] ?? 0) + 1;
        added.resolved.push(file.path);
      } else {
        // No such note yet: Graph View draws these as hollow nodes.
        unresolved[name] = (unresolved[name] ?? 0) + 1;
        added.unresolved.push(name);
      }
    }

    if (added.resolved.length || added.unresolved.length) {
      this.contributions.set(sourcePath, added);
    }
  }

  /** Take back everything we added for one note. */
  clearFor(sourcePath: string): void {
    const added = this.contributions.get(sourcePath);
    if (!added) return;
    this.contributions.delete(sourcePath);

    const resolved = this.resolvedFor(sourcePath, false);
    if (resolved) {
      for (const path of added.resolved) decrement(resolved, path);
    }
    const unresolved = this.unresolvedFor(sourcePath, false);
    if (unresolved) {
      for (const name of added.unresolved) decrement(unresolved, name);
    }
  }

  /** Take back everything we added, for plugin unload. */
  clearAll(): void {
    for (const sourcePath of Array.from(this.contributions.keys())) {
      this.clearFor(sourcePath);
    }
  }

  /** Paths we currently contribute to, for tests and diagnostics. */
  trackedPaths(): string[] {
    return Array.from(this.contributions.keys());
  }

  private resolvedFor(sourcePath: string, create = true): Record<string, number> | null {
    return bucket(this.app.metadataCache?.resolvedLinks, sourcePath, create);
  }

  private unresolvedFor(sourcePath: string, create = true): Record<string, number> | null {
    return bucket(this.app.metadataCache?.unresolvedLinks, sourcePath, create);
  }
}

/**
 * Fetch (or create) the per-source entry of a link index, refusing anything
 * that is not the shape we expect — the index is Obsidian's, not ours.
 */
function bucket(
  index: Record<string, Record<string, number>> | undefined,
  sourcePath: string,
  create: boolean
): Record<string, number> | null {
  if (!index || typeof index !== "object") return null;
  const existing = index[sourcePath];
  if (existing && typeof existing === "object") return existing;
  if (!create) return null;
  const fresh: Record<string, number> = {};
  index[sourcePath] = fresh;
  return fresh;
}

/** Undo one increment, removing the key when it reaches zero. */
function decrement(target: Record<string, number>, key: string): void {
  const count = target[key];
  if (typeof count !== "number") return;
  if (count <= 1) delete target[key];
  else target[key] = count - 1;
}
