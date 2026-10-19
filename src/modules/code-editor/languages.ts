import type { Extension } from "@codemirror/state";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { languageIdFor, usesJsx } from "./language-map";

/** Syntax colors for a file extension. Unknown extensions get plain text (no extension). */
export function languageExtension(extension: string): Extension[] {
  switch (languageIdFor(extension)) {
    case "json":
      return [json()];
    case "javascript":
      return [javascript({ jsx: usesJsx(extension) })];
    case "typescript":
      return [javascript({ typescript: true, jsx: usesJsx(extension) })];
    case "css":
      return [css()];
    case "html":
      return [html()];
    default:
      return [];
  }
}
