import { TextFileView, WorkspaceLeaf } from "obsidian";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { languageExtension } from "./languages";
import { codeEditorTheme } from "./theme";

export const CODE_VIEW_TYPE = "rico-code-editor";

/** Opens non-markdown text files (json, css, ts, js, ...) in a real code editor. */
export class CodeFileView extends TextFileView {
  private editor: EditorView | null = null;
  /** True while we push text into the editor ourselves, so it doesn't trigger a save. */
  private applying = false;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.contentEl.addClass("rico-code-editor");
  }

  getViewType(): string {
    return CODE_VIEW_TYPE;
  }

  getIcon(): string {
    return "file-code";
  }

  /** Keep the extension in the tab title ("package.json", not "package"). */
  getDisplayText(): string {
    return this.file?.name ?? "Code";
  }

  canAcceptExtension(): boolean {
    return true;
  }

  getViewData(): string {
    return this.editor ? this.editor.state.doc.toString() : this.data;
  }

  setViewData(data: string, clear: boolean): void {
    this.data = data;
    const view = this.ensureEditor();

    if (clear) {
      // A different file: fresh state = fresh undo history and the right language.
      view.setState(this.makeState(data));
      return;
    }

    if (view.state.doc.toString() === data) return;
    this.applying = true;
    try {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: data } });
    } finally {
      this.applying = false;
    }
  }

  clear(): void {
    this.data = "";
    this.editor?.setState(this.makeState(""));
  }

  async onClose(): Promise<void> {
    this.editor?.destroy();
    this.editor = null;
  }

  private ensureEditor(): EditorView {
    if (!this.editor) {
      this.editor = new EditorView({
        state: this.makeState(this.data ?? ""),
        parent: this.contentEl,
      });
    }
    return this.editor;
  }

  private makeState(doc: string): EditorState {
    const extension = this.file?.extension ?? "";
    return EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        ...languageExtension(extension),
        ...codeEditorTheme(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !this.applying) this.requestSave();
        }),
      ],
    });
  }
}
