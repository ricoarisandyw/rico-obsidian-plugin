export interface RicoPluginSettings {
  enableCanvasDrawing: boolean;
  enableCanvasHammerMenu: boolean;
  enableCanvasOgLink: boolean;
  enableCanvasLayers: boolean;
  enableCanvasIconDrop: boolean;
  /** Read-only outline of the open canvas in the right sidebar. */
  enableCanvasOutline: boolean;
  enableFolderBase: boolean;
  enableTypingGame: boolean;
  enableRunInTerminal: boolean;
  /** Right-click actions read from 60-System/scripts/actions.json. */
  enableScriptActions: boolean;
  /** Right-click -> "New file..." for any extension in the list below. */
  enableNewFile: boolean;
  /** Commands and tab right-click items that close tabs even when pinned. */
  enableForceClose: boolean;
  enableCodeEditor: boolean;
  /** Comma-separated list of extensions opened in the Obsidian editor. */
  visibleExtensions: string;
  enableHiddenFolders: boolean;
  /** gitignore-style rules: a matching hidden path is shown, `!` hides it. */
  visibilityRules: string;
  /** Keep hidden (dot) paths out of the Quick Switcher even when the explorer shows them. */
  hideHiddenFromSwitcher: boolean;
  enableTableOfContents: boolean;
  /** Pin every tab a file is opened in. */
  enableAutoPin: boolean;
  /** Right-click selected text -> "Make block reference" (adds a ^id and copies the link). */
  enableBlockReference: boolean;
  /** Sidebar panels listing block references: this note (right) and the whole vault (left). */
  enableBlockReferencePanels: boolean;
}

export const DEFAULT_VISIBLE_EXTENSIONS = "html, htm, js, ts, css, json";

export const DEFAULT_VISIBILITY_RULES = [
  "# Hidden folders/files to show in the explorer (gitignore-style).",
  "# A matching path is shown. Start a line with ! to hide it again.",
  ".obsidian/",
  ".trash/",
  "!node_modules/",
  "!.git/",
].join("\n");

export const DEFAULT_SETTINGS: RicoPluginSettings = {
  enableCanvasDrawing: true,
  enableCanvasHammerMenu: true,
  enableCanvasOgLink: true,
  enableCanvasLayers: true,
  enableCanvasIconDrop: true,
  enableCanvasOutline: true,
  enableFolderBase: true,
  enableTypingGame: true,
  enableRunInTerminal: true,
  enableScriptActions: true,
  enableNewFile: true,
  enableForceClose: true,
  enableCodeEditor: true,
  visibleExtensions: DEFAULT_VISIBLE_EXTENSIONS,
  enableHiddenFolders: true,
  visibilityRules: DEFAULT_VISIBILITY_RULES,
  hideHiddenFromSwitcher: true,
  enableTableOfContents: true,
  enableAutoPin: false,
  enableBlockReference: true,
  enableBlockReferencePanels: true,
};

/** Merge saved data over the defaults and drop keys that no longer exist (e.g. enableFlexView). */
export function normalizeSettings(raw: unknown): RicoPluginSettings {
  const saved = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const result = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (saved[key] !== undefined && typeof saved[key] === typeof result[key]) {
      result[key] = saved[key];
    }
  }
  return result as unknown as RicoPluginSettings;
}
