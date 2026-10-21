import type { Plugin } from "obsidian";
import { REQUIRED_MODEL_FILES, getModel, type ModelSpec } from "./model-registry";
import { normalize } from "./search";

/**
 * Turns text into a unit-length vector using a model stored in the vault.
 *
 * Strictly local: transformers.js is configured with remote fetching off, so a
 * missing file fails with a clear message instead of quietly downloading.
 */

export class MissingModelError extends Error {
  constructor(
    message: string,
    readonly missing: string[],
    readonly folder: string,
  ) {
    super(message);
    this.name = "MissingModelError";
  }
}

export class Embedder {
  private pipelinePromise: Promise<unknown> | null = null;
  private spec: ModelSpec;
  private lastPath = "";

  constructor(
    private plugin: Plugin,
    private modelKeyOf: () => string,
    private modelPathOf: () => string,
  ) {
    this.spec = getModel(modelKeyOf());
  }

  /**
   * Pick up a model or folder change made in settings.
   * The built pipeline is tied to one model, so it is dropped when either moves.
   */
  private syncSpec(): void {
    const key = this.modelKeyOf();
    const path = this.modelPathOf();
    if (key === this.spec.key && path === this.lastPath) return;
    this.spec = getModel(key);
    this.lastPath = path;
    this.pipelinePromise = null;
    this.readyCache = null;
  }

  get dims(): number {
    this.syncSpec();
    return this.spec.dims;
  }

  get modelKey(): string {
    this.syncSpec();
    return this.spec.key;
  }

  /** Vault-relative folder holding this model's files. */
  get folder(): string {
    this.syncSpec();
    const base = (this.modelPathOf() || ".models").replace(/\/+$/, "");
    return `${base}/${this.spec.key}`;
  }

  /** Which required files are not on disk yet. */
  async missingFiles(): Promise<string[]> {
    const adapter = this.plugin.app.vault.adapter;
    const missing: string[] = [];
    for (const file of REQUIRED_MODEL_FILES) {
      try {
        if (!(await adapter.exists(`${this.folder}/${file}`))) missing.push(file);
      } catch {
        missing.push(file);
      }
    }
    return missing;
  }

  /**
   * Cached because this is called on every note switch and every search, and
   * four disk checks per call adds up fast. Cleared whenever the model or
   * folder changes, and by refreshReady() after a download.
   */
  private readyCache: boolean | null = null;

  async isReady(): Promise<boolean> {
    this.syncSpec();
    if (this.readyCache !== null) return this.readyCache;
    this.readyCache = (await this.missingFiles()).length === 0;
    return this.readyCache;
  }

  /** Re-check the disk, e.g. after a model is downloaded or deleted. */
  refreshReady(): void {
    this.readyCache = null;
  }

  private async buildPipeline(): Promise<unknown> {
    this.syncSpec();
    const missing = await this.missingFiles();
    if (missing.length) {
      throw new MissingModelError(
        `Model "${this.spec.name}" is not in ${this.folder}. See docs/semantic-search-model-setup.md.`,
        missing,
        this.folder,
      );
    }

    const transformers = await import("@huggingface/transformers");
    const { env, pipeline } = transformers as {
      env: Record<string, unknown>;
      pipeline: (task: string, model: string, opts?: unknown) => Promise<unknown>;
    };

    // The web build of transformers stubs out node:fs, so it can only load a
    // model over HTTP -- it will never read a disk path, however correct that
    // path is. Obsidian is a browser context, so we keep the web build (the
    // node build needs onnxruntime-node, which is a native module) and instead
    // hand transformers a fetch that serves the vault's own files.
    //
    // Requests arrive as "<remoteHost><remotePathTemplate><file>", so we point
    // the host at a sentinel URL we can recognise and strip.
    const sentinel = "https://rico-local.invalid/";
    const adapter = this.plugin.app.vault.adapter;
    const folder = this.folder;
    const realFetch: typeof fetch | undefined =
      typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined;

    env.allowRemoteModels = true; // Required, or it refuses before calling fetch.
    env.allowLocalModels = false;
    env.useBrowserCache = false;
    env.remoteHost = sentinel;
    env.remotePathTemplate = "{model}/";

    env.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith(sentinel)) {
        // Not ours: let the real fetch handle it, or refuse if there is none.
        if (realFetch) return realFetch(input as RequestInfo, init);
        return new Response(null, { status: 404, statusText: "Not Found" });
      }

      // ".../<modelKey>/<file>" -> the file's path inside the vault.
      const rest = decodeURIComponent(url.slice(sentinel.length).split("?")[0]);
      const file = rest.startsWith(`${this.spec.key}/`)
        ? rest.slice(this.spec.key.length + 1)
        : rest;
      const path = `${folder}/${file}`;

      try {
        if (!(await adapter.exists(path))) {
          // Name the exact file it wanted: a 404 here almost always means the
          // requested variant differs from the one on disk.
          console.warn(">>> semantic-search: model file not found", { wanted: file, path });
          return new Response(null, { status: 404, statusText: "Not Found" });
        }
        console.log(">>> semantic-search: serving", file);
        const buffer = await adapter.readBinary(path);
        const type = file.endsWith(".json") ? "application/json" : "application/octet-stream";
        return new Response(buffer, { status: 200, headers: { "Content-Type": type } });
      } catch (err) {
        console.error(">>> semantic-search: could not read", path, err);
        return new Response(null, { status: 500, statusText: "Read Failed" });
      }
    };

    console.log(">>> semantic-search: loading model", {
      modelKey: this.spec.key,
      servingFrom: folder,
    });

    // v4 replaced `quantized: true` with `dtype`. "q8" maps to the "_quantized"
    // filename suffix, which is the file the setup doc tells you to download.
    //
    // Device is left unset on purpose: the supported list is decided at runtime
    // (Obsidian reports as Node, so it offers coreml/cpu rather than wasm) and
    // naming one that is not supported throws. Letting it auto-detect works on
    // every platform.
    return pipeline("feature-extraction", this.spec.key, { dtype: "q8" });
  }

  /** Built once, on first use, so plugin startup stays fast. */
  private pipeline(): Promise<unknown> {
    if (!this.pipelinePromise) {
      this.pipelinePromise = this.buildPipeline().catch((err) => {
        // Let the next call retry instead of caching the failure.
        this.pipelinePromise = null;
        throw err;
      });
    }
    return this.pipelinePromise;
  }

  /**
   * E5 models want "passage:" on stored text and "query:" on the thing you
   * search from. Other models get the text unchanged.
   */
  private prefixed(text: string, kind: "query" | "passage"): string {
    return this.spec.usesE5Prefixes ? `${kind}: ${text}` : text;
  }

  /**
   * Embed several texts in one model call.
   *
   * The per-call overhead (tokenizer setup, tensor allocation, ORT dispatch) is
   * largely fixed, so a batch of 8 is far cheaper than 8 separate calls.
   */
  async embedMany(
    texts: string[],
    kind: "query" | "passage" = "passage",
  ): Promise<number[][]> {
    this.syncSpec();
    const inputs = texts.map((t) => this.prefixed((t ?? "").trim(), kind));
    if (!inputs.length) return [];

    const extractor = (await this.pipeline()) as (
      input: string[],
      opts: unknown,
    ) => Promise<{ data: ArrayLike<number>; dims: number[] }>;

    const output = await extractor(inputs, { pooling: "mean", normalize: false });
    const flat = output.data;
    // Output is [batch, dims] flattened; slice it back into one vector per text.
    const width = output.dims?.[output.dims.length - 1] ?? this.spec.dims;
    const vectors: number[][] = [];
    for (let i = 0; i < inputs.length; i++) {
      const start = i * width;
      const slice: number[] = new Array(width);
      for (let j = 0; j < width; j++) slice[j] = Number(flat[start + j]);
      vectors.push(normalize(slice));
    }
    return vectors;
  }

  async embed(text: string, kind: "query" | "passage" = "passage"): Promise<number[]> {
    this.syncSpec();
    const trimmed = (text ?? "").trim();
    if (!trimmed) return [];
    const extractor = (await this.pipeline()) as (
      input: string,
      opts: unknown,
    ) => Promise<{ data: ArrayLike<number> }>;
    const output = await extractor(this.prefixed(trimmed, kind), {
      pooling: "mean",
      normalize: false,
    });
    // Normalize here rather than trusting the model, so every stored vector is
    // unit length and search stays a plain dot product.
    return normalize(Array.from(output.data));
  }

  unload(): void {
    this.pipelinePromise = null;
  }
}
