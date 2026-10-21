import { requestUrl, type Plugin } from "obsidian";
import {
  MODELS,
  REQUIRED_MODEL_FILES,
  fileUrl,
  getModel,
  modelFolder,
  type ModelSpec,
} from "./model-registry";

/**
 * Reads what is on disk and, when asked, downloads or deletes a model.
 *
 * No UI in here. Network access happens only inside `download`, and only
 * because the user pressed a button.
 */

export type ModelState = "ready" | "partial" | "missing";

export interface FileStatus {
  file: string;
  present: boolean;
  bytes: number;
}

export interface ModelStatus {
  key: string;
  state: ModelState;
  folder: string;
  files: FileStatus[];
  /** How many required files are present. */
  presentCount: number;
  /** Total bytes on disk. */
  bytes: number;
}

export interface DownloadProgress {
  /** 0-1 across the whole model. */
  fraction: number;
  /** File being fetched right now. */
  file: string;
  fileIndex: number;
  fileCount: number;
  /** Files that were already on disk and got skipped. */
  skipped: number;
}

export class DownloadCancelled extends Error {
  constructor() {
    super("Download cancelled.");
    this.name = "DownloadCancelled";
  }
}

export class DownloadFailed extends Error {
  constructor(
    readonly file: string,
    readonly cause: unknown,
  ) {
    super(`Could not download "${file}".`);
    this.name = "DownloadFailed";
  }
}

/** Progress across files, weighted by each file's share of the total. */
export function computeFraction(fileIndex: number, fileCount: number, withinFile = 0): number {
  if (fileCount <= 0) return 0;
  const clamped = Math.min(Math.max(withinFile, 0), 1);
  return Math.min((fileIndex + clamped) / fileCount, 1);
}

/** Roll per-file presence into a single state. */
export function rollUpState(files: FileStatus[]): ModelState {
  const present = files.filter((f) => f.present).length;
  if (present === 0) return "missing";
  if (present === files.length) return "ready";
  return "partial";
}

export class ModelManager {
  private cancelled = false;
  private running: string | null = null;

  constructor(
    private plugin: Plugin,
    private basePath: () => string,
  ) {}

  folderFor(key: string): string {
    return modelFolder(this.basePath(), key);
  }

  /**
   * What is on disk for one model.
   * A zero-byte file counts as missing: a failed write leaves one behind, and
   * treating it as present would break loading in a confusing way.
   */
  async status(key: string): Promise<ModelStatus> {
    const adapter = this.plugin.app.vault.adapter;
    const folder = this.folderFor(key);
    const files: FileStatus[] = [];

    for (const file of REQUIRED_MODEL_FILES) {
      const path = `${folder}/${file}`;
      let present = false;
      let bytes = 0;
      try {
        if (await adapter.exists(path)) {
          const stat = await adapter.stat(path);
          bytes = stat?.size ?? 0;
          present = bytes > 0;
        }
      } catch {
        present = false;
      }
      files.push({ file, present, bytes });
    }

    return {
      key,
      folder,
      files,
      state: rollUpState(files),
      presentCount: files.filter((f) => f.present).length,
      bytes: files.reduce((sum, f) => sum + f.bytes, 0),
    };
  }

  async allStatuses(): Promise<ModelStatus[]> {
    return Promise.all(MODELS.map((m) => this.status(m.key)));
  }

  get isDownloading(): boolean {
    return this.running !== null;
  }

  get downloadingKey(): string | null {
    return this.running;
  }

  cancel(): void {
    this.cancelled = true;
  }

  /**
   * Fetch the required files one at a time.
   *
   * Files already on disk are skipped, so a run that failed halfway picks up
   * where it stopped. Cancellation is checked between files, never mid-write,
   * so a partial file is never left behind by cancelling.
   */
  async download(key: string, onProgress?: (p: DownloadProgress) => void): Promise<number> {
    if (this.running) throw new Error("Another model is already downloading.");
    const spec: ModelSpec = getModel(key);
    const folder = this.folderFor(key);
    const adapter = this.plugin.app.vault.adapter;

    this.running = key;
    this.cancelled = false;
    let downloaded = 0;
    let skipped = 0;

    try {
      await this.ensureFolder(folder);
      // onnx/ must exist before the model file lands in it.
      if (REQUIRED_MODEL_FILES.some((f) => f.includes("/"))) {
        await this.ensureFolder(`${folder}/onnx`);
      }

      for (let i = 0; i < REQUIRED_MODEL_FILES.length; i++) {
        if (this.cancelled) throw new DownloadCancelled();
        const file = REQUIRED_MODEL_FILES[i];
        const path = `${folder}/${file}`;

        // Already here from an earlier run.
        let exists = false;
        try {
          exists = (await adapter.exists(path)) && ((await adapter.stat(path))?.size ?? 0) > 0;
        } catch {
          exists = false;
        }
        if (exists) {
          skipped++;
          onProgress?.({
            fraction: computeFraction(i + 1, REQUIRED_MODEL_FILES.length),
            file,
            fileIndex: i,
            fileCount: REQUIRED_MODEL_FILES.length,
            skipped,
          });
          continue;
        }

        onProgress?.({
          fraction: computeFraction(i, REQUIRED_MODEL_FILES.length),
          file,
          fileIndex: i,
          fileCount: REQUIRED_MODEL_FILES.length,
          skipped,
        });

        try {
          const response = await requestUrl({ url: fileUrl(spec, file), method: "GET" });
          if (this.cancelled) throw new DownloadCancelled();
          await adapter.writeBinary(path, response.arrayBuffer);
          downloaded++;
        } catch (err) {
          if (err instanceof DownloadCancelled) throw err;
          throw new DownloadFailed(file, err);
        }

        onProgress?.({
          fraction: computeFraction(i + 1, REQUIRED_MODEL_FILES.length),
          file,
          fileIndex: i,
          fileCount: REQUIRED_MODEL_FILES.length,
          skipped,
        });
      }
    } finally {
      this.running = null;
      this.cancelled = false;
    }

    return downloaded;
  }

  /** Remove every required file, then the folders if they are empty. */
  async remove(key: string): Promise<void> {
    const adapter = this.plugin.app.vault.adapter;
    const folder = this.folderFor(key);

    for (const file of REQUIRED_MODEL_FILES) {
      const path = `${folder}/${file}`;
      try {
        if (await adapter.exists(path)) await adapter.remove(path);
      } catch (err) {
        console.error("[semantic-search] could not remove", path, err);
      }
    }

    // Deepest first, and only if empty, so nothing else of yours is lost.
    for (const dir of [`${folder}/onnx`, folder]) {
      try {
        if (!(await adapter.exists(dir))) continue;
        const listing = await adapter.list(dir);
        if (listing.files.length === 0 && listing.folders.length === 0) await adapter.rmdir(dir, false);
      } catch {
        // A non-empty folder is fine to leave alone.
      }
    }
  }

  private async ensureFolder(path: string): Promise<void> {
    const adapter = this.plugin.app.vault.adapter;
    try {
      if (!(await adapter.exists(path))) await adapter.mkdir(path);
    } catch (err) {
      console.error("[semantic-search] could not create folder", path, err);
    }
  }
}
