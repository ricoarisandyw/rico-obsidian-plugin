/**
 * Known embedding models.
 *
 * Everything runs locally: the files are downloaded by hand into the model
 * folder (see docs/semantic-search-model-setup.md) and loaded from disk.
 * Nothing here fetches anything at runtime.
 */
export interface ModelSpec {
  /** Stable id, also the folder name under the model path. */
  key: string;
  /** Shown in the settings dropdown. */
  name: string;
  /** Vector length. Vectors of another length are treated as stale. */
  dims: number;
  /** Rough download size, for the settings description. */
  size: string;
  /**
   * E5 models are trained with "query:" on the thing you search from and
   * "passage:" on the things being searched. Skipping this measurably hurts
   * results, so the embedder applies it automatically when this is true.
   */
  usesE5Prefixes: boolean;
  /** HuggingFace repo. Only fetched when the user presses Download. */
  repo: string;
  /** Rough total download size in bytes, for progress estimates. */
  bytes: number;
  /** Languages the model actually handles well. */
  languages: string;
}

export const MODELS: ModelSpec[] = [
  {
    key: "multilingual-e5-small",
    name: "Multilingual E5 Small (Indonesian + English)",
    dims: 384,
    size: "~120MB",
    usesE5Prefixes: true,
    repo: "Xenova/multilingual-e5-small",
    bytes: 118000000,
    languages: "100+ languages including Indonesian",
  },
  {
    key: "multilingual-e5-base",
    name: "Multilingual E5 Base (better, heavier)",
    dims: 768,
    size: "~280MB",
    usesE5Prefixes: true,
    repo: "Xenova/multilingual-e5-base",
    bytes: 280000000,
    languages: "100+ languages including Indonesian",
  },
  {
    key: "paraphrase-multilingual-MiniLM-L12-v2",
    name: "Paraphrase Multilingual MiniLM",
    dims: 384,
    size: "~120MB",
    usesE5Prefixes: false,
    repo: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    bytes: 118000000,
    languages: "50+ languages including Indonesian",
  },
  {
    key: "all-MiniLM-L6-v2",
    name: "All MiniLM L6 (English only, smallest)",
    dims: 384,
    size: "~90MB",
    usesE5Prefixes: false,
    repo: "Xenova/all-MiniLM-L6-v2",
    bytes: 90000000,
    languages: "English only — poor results on Indonesian",
  },
];

/** Files transformers.js needs. Used by "Check model" and the setup doc. */
export const REQUIRED_MODEL_FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/model_quantized.onnx",
];

export function getModel(key: string): ModelSpec {
  return MODELS.find((m) => m.key === key) ?? MODELS[0];
}

/**
 * Where a required file is downloaded from.
 * Only ever called after the user presses Download.
 */
export function fileUrl(spec: ModelSpec, file: string): string {
  return `https://huggingface.co/${spec.repo}/resolve/main/${file}?download=true`;
}

/** Vault-relative folder for a model, given the configured base path. */
export function modelFolder(basePath: string, key: string): string {
  const base = (basePath || ".models").replace(/\/+$/, "");
  return `${base}/${key}`;
}

/** Human-readable byte size, e.g. "118 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
