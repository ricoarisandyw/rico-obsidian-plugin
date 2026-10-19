import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/** Light "Notion" palette to match the vault's CSS snippet. */
const palette = {
  text: "#374151",
  muted: "#6b7280",
  faint: "#9ca3af",
  keyword: "#7c3aed",
  string: "#15803d",
  number: "#b45309",
  property: "#1d4ed8",
  type: "#0f766e",
  tag: "#b91c1c",
  regexp: "#be185d",
  invalid: "#dc2626",
};

const highlightStyle = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment], color: palette.muted, fontStyle: "italic" },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword], color: palette.keyword },
  { tag: [t.string, t.special(t.string), t.character], color: palette.string },
  { tag: [t.number, t.bool, t.null, t.atom], color: palette.number },
  { tag: [t.propertyName, t.attributeName], color: palette.property },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: palette.property },
  { tag: [t.typeName, t.className, t.namespace], color: palette.type },
  { tag: [t.tagName, t.angleBracket], color: palette.tag },
  { tag: t.regexp, color: palette.regexp },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: palette.muted },
  { tag: [t.variableName, t.name], color: palette.text },
  { tag: t.heading, fontWeight: "700" },
  { tag: t.link, color: palette.property, textDecoration: "underline" },
  { tag: t.invalid, color: palette.invalid },
]);

const theme = EditorView.theme(
  {
    "&": {
      height: "100%",
      color: palette.text,
      backgroundColor: "#ffffff",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily: "var(--font-monospace-theme, var(--font-monospace))",
      fontSize: "13.5px",
      lineHeight: "1.55",
    },
    ".cm-content": { padding: "12px 0", caretColor: "#111827" },
    ".cm-line": { padding: "0 12px" },
    ".cm-gutters": {
      backgroundColor: "#f7f7f5",
      color: palette.faint,
      border: "none",
      borderRight: "1px solid rgba(55, 53, 47, 0.09)",
    },
    ".cm-activeLine": { backgroundColor: "rgba(55, 53, 47, 0.035)" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(55, 53, 47, 0.06)", color: palette.text },
    ".cm-selectionBackground": { backgroundColor: "rgba(35, 131, 226, 0.18) !important" },
    "&.cm-focused .cm-selectionBackground": { backgroundColor: "rgba(35, 131, 226, 0.25) !important" },
    ".cm-cursor": { borderLeftColor: "#111827" },
    ".cm-matchingBracket": { backgroundColor: "rgba(35, 131, 226, 0.18)", outline: "none" },
    ".cm-searchMatch": { backgroundColor: "rgba(242, 201, 76, 0.45)" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "rgba(242, 153, 74, 0.6)" },
    ".cm-foldPlaceholder": { backgroundColor: "#efefed", border: "none", color: palette.muted },
    ".cm-panels": { backgroundColor: "#f7f7f5", color: palette.text },
  },
  { dark: false }
);

export function codeEditorTheme(): Extension[] {
  return [theme, syntaxHighlighting(highlightStyle)];
}
