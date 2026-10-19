/** Which syntax colors an extension gets. No editor imports here, so it is easy to test. */
export type CodeLanguageId = "json" | "javascript" | "typescript" | "css" | "html";

const BY_EXTENSION: Record<string, CodeLanguageId> = {
  json: "json",
  jsonc: "json",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  css: "css",
  html: "html",
  htm: "html",
};

/** Case-insensitive, accepts "ts" or ".ts". Returns null for plain text. */
export function languageIdFor(extension: string): CodeLanguageId | null {
  const ext = (extension ?? "").trim().replace(/^\./, "").toLowerCase();
  return BY_EXTENSION[ext] ?? null;
}

/** JSX syntax is only needed for these two. */
export function usesJsx(extension: string): boolean {
  const ext = (extension ?? "").trim().replace(/^\./, "").toLowerCase();
  return ext === "jsx" || ext === "tsx";
}
