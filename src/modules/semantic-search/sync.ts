import { Notice, TAbstractFile, TFile, type Plugin } from "obsidian";
import type { Embedder } from "./embedder";
import { MissingModelError } from "./embedder";
import type { VectorStore } from "./store";
import { isExcluded, parseExcludeFilter } from "./search";
import type { RicoPluginSettings } from "../../types";

/** Folders never worth embedding, regardless of the user's filter. */
const ALWAYS_EXCLUDED = [".trash/", ".obsidian/", ".models/"];

export function isAlwaysExcluded(path: string): boolean {
  return ALWAYS_EXCLUDED.some((prefix) => path.startsWith(prefix) || path.includes(`/${prefix}`));
}

export interface IndexVaultResult {
  /** Notes embedded on this run. */
  indexed: number;
  /** Notes already current, so left alone. */
  skipped: number;
  /** Notes that threw. */
  failed: number;
  total: number;
  /** First error, so the caller can report something concrete. */
  firstError: unknown;
}

function files2count(indexed: number, skipped: number, failed: number): number {
  return indexed + skipped + failed;
}

/**
 * Keeps the index in step with the vault.
 *
 * Only changed files are re-embedded: embedding is the slow part, and most
 * vault events touch one file.
 */
export class IndexSync {
  private queue = new Set<string>();
  private timer: number | null = null;
  private running = false;

  constructor(
    private plugin: Plugin,
    private store: VectorStore,
    private embedder: Embedder,
    private settings: () => RicoPluginSettings,
  ) {}

  private get excludeFragments(): string[] {
    return parseExcludeFilter(this.settings().semanticSearchExcludeFilter);
  }

  /** Markdown only, outside the trash, and not matching the exclude filter. */
  shouldIndex(file: TAbstractFile): file is TFile {
    if (!(file instanceof TFile) || file.extension !== "md") return false;
    // Obsidian's local trash still lists files; embedding deleted notes would
    // surface them as "related" long after they were thrown away.
    if (isAlwaysExcluded(file.path)) return false;
    const fragments = this.excludeFragments;
    return !(fragments.length && isExcluded(file.path, fragments));
  }

  /**
   * Text kept in the index for exact and fuzzy matching.
   * Bounded, because the index is loaded into memory in full.
   */
  private snippet(text: string): string {
    const max = this.settings().semanticSearchSnippetChars;
    if (!max || max <= 0) return "";
    return text.slice(0, max);
  }

  private async readForEmbedding(file: TFile): Promise<string> {
    const raw = await this.plugin.app.vault.cachedRead(file);
    const max = this.settings().semanticSearchMaxChars;
    // The title carries real signal, especially for short notes.
    const text = `${file.basename}\n\n${raw}`;
    return max > 0 ? text.slice(0, max) : text;
  }

  /** Embed one file unless it is already current. */
  async indexFile(file: TFile, force = false): Promise<boolean> {
    if (!this.shouldIndex(file)) return false;
    if (!force && this.store.isCurrent(file.path, file.stat.mtime)) return false;
    // No readiness check here: it costs four disk hits per note. Callers that
    // loop (indexVault, drain) check once before starting, and the single-note
    // command below checks on its own.
    const text = await this.readForEmbedding(file);
    if (!text.trim()) {
      this.store.delete(file.path);
      return false;
    }
    const vec = await this.embedder.embed(text, "passage");
    if (!vec.length) return false;
    this.store.set(file.path, file.stat.mtime, vec, {
      text: this.snippet(text),
      kind: file.extension === "canvas" ? "canvas" : "md",
      ctime: file.stat.ctime,
    });
    return true;
  }

  /** Walk the whole vault, skipping anything unchanged. */
  async indexVault(
    onProgress?: (done: number, total: number) => void,
  ): Promise<IndexVaultResult> {
    if (this.running) {
      new Notice("Semantic search: indexing already in progress.");
      return { indexed: 0, skipped: 0, failed: 0, total: 0, firstError: null };
    }
    this.running = true;
    const startedAt = Date.now();
    let indexed = 0;
    let skipped = 0;
    let failed = 0;
    let firstError: unknown = null;
    try {
      // Fail loudly and early rather than letting every file error in turn.
      if (!(await this.embedder.isReady())) {
        const missing = await this.embedder.missingFiles();
        throw new MissingModelError(
          `The embedding model is not downloaded yet (${missing.length} file(s) missing from ${this.embedder.folder}). ` +
            `Open Settings -> Semantic Search -> Models and press Download.`,
          missing,
          this.embedder.folder,
        );
      }
      const allMarkdown = this.plugin.app.vault.getMarkdownFiles();
      const files = allMarkdown.filter((f) => this.shouldIndex(f));
      console.log(">>> semantic-search: indexVault", {
        markdownFiles: allMarkdown.length,
        afterExcludeFilter: files.length,
        excludeFilter: this.settings().semanticSearchExcludeFilter,
      });
      // Drop vectors for files that no longer qualify.
      const known = new Set(files.map((f) => f.path));
      for (const entry of this.store.all()) {
        if (!known.has(entry.path)) this.store.delete(entry.path);
      }
      // Embed in batches: the model call has fixed overhead, so handing it
      // several notes at once is far faster than one call per note.
      const batchSize = Math.max(1, this.settings().semanticSearchBatchSize || 8);
      let done = 0;

      for (let start = 0; start < files.length; start += batchSize) {
        const batch = files.slice(start, start + batchSize);
        const pending: { file: TFile; text: string }[] = [];

        for (const file of batch) {
          if (this.store.isCurrent(file.path, file.stat.mtime)) {
            skipped++;
            continue;
          }
          try {
            const text = await this.readForEmbedding(file);
            if (!text.trim()) {
              this.store.delete(file.path);
              skipped++;
              continue;
            }
            pending.push({ file, text });
          } catch (err) {
            failed++;
            if (!firstError) firstError = err;
            console.error("[semantic-search] could not read", file.path, err);
          }
        }

        if (pending.length) {
          try {
            const vectors = await this.embedder.embedMany(
              pending.map((p) => p.text),
              "passage",
            );
            pending.forEach((p, i) => {
              const vec = vectors[i];
              if (vec?.length) {
                this.store.set(p.file.path, p.file.stat.mtime, vec, {
                  text: this.snippet(p.text),
                  kind: p.file.extension === "canvas" ? "canvas" : "md",
                  ctime: p.file.stat.ctime,
                });
                indexed++;
              } else {
                failed++;
              }
            });
          } catch (err) {
            if (err instanceof MissingModelError) throw err;
            failed += pending.length;
            if (!firstError) firstError = err;
            console.error("[semantic-search] batch failed", err);
          }
        }

        done += batch.length;
        onProgress?.(done, files.length);
        // Yield so the UI stays responsive on a long index.
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      await this.store.flush();
      const elapsedMs = Date.now() - startedAt;
      console.log(">>> semantic-search: indexing done", {
        indexed,
        skipped,
        failed,
        seconds: Math.round(elapsedMs / 100) / 10,
        msPerNote: indexed ? Math.round(elapsedMs / indexed) : 0,
        batchSize: this.settings().semanticSearchBatchSize,
        maxChars: this.settings().semanticSearchMaxChars,
      });
    } finally {
      this.running = false;
    }
    return { indexed, skipped, failed, total: files2count(indexed, skipped, failed), firstError };
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Edits arrive per keystroke-ish, so changed files are collected and embedded
   * once things go quiet.
   */
  private enqueue(path: string): void {
    this.queue.add(path);
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, this.settings().semanticSearchAutoIndexDelayMs || 30000);
  }

  private async drain(): Promise<void> {
    const paths = [...this.queue];
    this.queue.clear();
    // Background indexing stays silent until a model is actually downloaded,
    // rather than throwing a library-level error per edited note.
    if (!(await this.embedder.isReady())) {
      console.log(">>> semantic-search: skipping auto-index, model not downloaded");
      return;
    }
    for (const path of paths) {
      const file = this.plugin.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      try {
        await this.indexFile(file);
      } catch (err) {
        if (err instanceof MissingModelError) return; // Stay quiet until the model is set up.
        console.error("[semantic-search] failed to index", path, err);
      }
    }
    this.store.scheduleSave();
  }

  /** Watch the vault so the index does not drift. */
  registerEvents(): void {
    const { vault } = this.plugin.app;

    this.plugin.registerEvent(
      vault.on("modify", (file) => {
        if (!this.settings().semanticSearchAutoIndex) return;
        if (this.shouldIndex(file)) this.enqueue(file.path);
      }),
    );

    this.plugin.registerEvent(
      vault.on("create", (file) => {
        if (!this.settings().semanticSearchAutoIndex) return;
        if (this.shouldIndex(file)) this.enqueue(file.path);
      }),
    );

    this.plugin.registerEvent(
      vault.on("delete", (file) => {
        this.store.delete(file.path);
        this.store.scheduleSave();
      }),
    );

    this.plugin.registerEvent(
      vault.on("rename", (file, oldPath) => {
        // Content is unchanged, so move the vector rather than re-embedding.
        this.store.rename(oldPath, file.path);
        this.store.scheduleSave();
      }),
    );
  }
}
