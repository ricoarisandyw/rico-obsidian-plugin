import type { Plugin } from "obsidian";
import type { IndexEntry } from "./search";

/**
 * The vector index.
 *
 * Kept in its own JSON file rather than in plugin settings: vectors are large
 * and settings get read and rewritten constantly, so mixing them would make
 * every settings change rewrite megabytes.
 *
 * It lives in the vault (`.rico-plugin/`), not in the plugin folder. The plugin
 * folder is often a symlink to a git checkout during development, and writing
 * an 8MB generated file into the repository on every index is both noise in
 * `git status` and data that belongs to the vault, not to the source.
 */

/** Vault-relative folder for this plugin's generated data. */
export const DATA_FOLDER = ".rico-plugin";

const INDEX_FILE = "semantic-index.json";

/** Bumped when the entry shape changes, which forces a rebuild. */
const INDEX_VERSION = 2;

interface StoredEntry {
  mtime: number;
  vec: number[];
  text?: string;
  kind?: "md" | "canvas";
  ctime?: number;
}

interface IndexFile {
  version?: number;
  /** Which model produced these vectors. Changing model invalidates them. */
  modelKey: string;
  dims: number;
  entries: Record<string, StoredEntry>;
}

export class VectorStore {
  private entries = new Map<string, IndexEntry>();
  private modelKey = "";
  private dims = 0;
  private dirty = false;
  private saveTimer: number | null = null;

  constructor(private plugin: Plugin) {}

  private get path(): string {
    return `${DATA_FOLDER}/${INDEX_FILE}`;
  }

  /** Where the index used to live, before it moved into the vault. */
  private get legacyPath(): string {
    return `${this.plugin.manifest.dir}/${INDEX_FILE}`;
  }

  /**
   * Move an index written by an older version into the new folder.
   *
   * Without this every user would silently lose their index and have to
   * re-embed the whole vault, which for a large vault is many minutes of work.
   */
  private async migrate(): Promise<void> {
    const adapter = this.plugin.app.vault.adapter;
    try {
      if (await adapter.exists(this.path)) return;
      if (!(await adapter.exists(this.legacyPath))) return;

      console.log(">>> semantic-search: moving index into", DATA_FOLDER);
      const raw = await adapter.read(this.legacyPath);
      await this.ensureFolder();
      await adapter.write(this.path, raw);
      // Only remove the old copy once the new one is safely written.
      await adapter.remove(this.legacyPath);
    } catch (err) {
      console.error("[semantic-search] could not move the old index", err);
    }
  }

  /** Create the data folder if it is not there yet. */
  private async ensureFolder(): Promise<void> {
    const adapter = this.plugin.app.vault.adapter;
    if (!(await adapter.exists(DATA_FOLDER))) {
      await adapter.mkdir(DATA_FOLDER);
    }
  }

  /**
   * Load the saved index. If it was built by a different model the entries are
   * dropped, because vectors from two models are not comparable.
   */
  async load(modelKey: string, dims: number): Promise<void> {
    this.modelKey = modelKey;
    this.dims = dims;
    this.entries.clear();
    this.cachedAll = null;

    await this.migrate();

    const adapter = this.plugin.app.vault.adapter;
    try {
      if (!(await adapter.exists(this.path))) return;
      const raw = await adapter.read(this.path);
      const data = JSON.parse(raw) as IndexFile;
      if (data.modelKey !== modelKey || data.dims !== dims) {
        // Stale index from another model — start clean.
        return;
      }
      if ((data.version ?? 1) !== INDEX_VERSION) {
        // Older shape (no text/kind): rebuild rather than half-populate it.
        console.log(">>> semantic-search: index version changed, rebuilding");
        return;
      }
      for (const [path, entry] of Object.entries(data.entries ?? {})) {
        if (entry?.vec?.length !== dims) continue;
        this.entries.set(path, {
          path,
          mtime: entry.mtime,
          vec: entry.vec,
          text: entry.text,
          kind: entry.kind,
          ctime: entry.ctime,
        });
      }
    } catch (err) {
      console.error("[semantic-search] failed to load index", err);
    }
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    const data: IndexFile = {
      version: INDEX_VERSION,
      modelKey: this.modelKey,
      dims: this.dims,
      entries: Object.fromEntries(
        [...this.entries.values()].map((e) => [
          e.path,
          { mtime: e.mtime, vec: e.vec, text: e.text, kind: e.kind, ctime: e.ctime },
        ]),
      ),
    };
    try {
      await this.ensureFolder();
      await this.plugin.app.vault.adapter.write(this.path, JSON.stringify(data));
      this.dirty = false;
    } catch (err) {
      console.error("[semantic-search] failed to save index", err);
    }
  }

  /** Batch writes so indexing a vault does not hit the disk per note. */
  scheduleSave(delayMs = 2000): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, delayMs);
  }

  get(path: string): IndexEntry | undefined {
    return this.entries.get(path);
  }

  /**
   * Live view of the entries, rebuilt only when something changed.
   * Search runs on every keystroke, so copying thousands of entries each time
   * was pure waste. Callers must not mutate the result.
   */
  private cachedAll: IndexEntry[] | null = null;

  all(): IndexEntry[] {
    if (!this.cachedAll) this.cachedAll = [...this.entries.values()];
    return this.cachedAll;
  }

  get size(): number {
    return this.entries.size;
  }

  set(path: string, mtime: number, vec: number[], extra: Partial<IndexEntry> = {}): void {
    this.entries.set(path, { path, mtime, vec, ...extra });
    this.cachedAll = null;
    this.dirty = true;
  }

  delete(path: string): void {
    if (this.entries.delete(path)) {
      this.cachedAll = null;
      this.dirty = true;
    }
  }

  /** Move a vector when a file is renamed, so it is not re-embedded. */
  rename(oldPath: string, newPath: string): void {
    const entry = this.entries.get(oldPath);
    if (!entry) return;
    this.entries.delete(oldPath);
    this.entries.set(newPath, { ...entry, path: newPath });
    this.cachedAll = null;
    this.dirty = true;
  }

  /** True when the file has not changed since it was embedded. */
  isCurrent(path: string, mtime: number): boolean {
    const entry = this.entries.get(path);
    return !!entry && entry.mtime === mtime;
  }

  clear(): void {
    this.entries.clear();
    this.cachedAll = null;
    this.dirty = true;
  }

  async flush(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.save();
  }
}
