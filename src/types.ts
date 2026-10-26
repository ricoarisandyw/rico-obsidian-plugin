export interface RicoPluginSettings {
  enableCanvasDrawing: boolean;
  enableCanvasHammerMenu: boolean;
  enableCanvasOgLink: boolean;
  enableCanvasLayers: boolean;
  enableCanvasIconDrop: boolean;
  /** Read-only outline of the open canvas in the right sidebar. */
  enableCanvasOutline: boolean;
  /** Read-only force-directed network graph of the open canvas in the right sidebar. */
  enableCanvasNetworkGraph: boolean;
  /** roadmap.sh-style canvas cards: title, status, and a linked article. */
  enableCanvasRoadmapNode: boolean;
  /** Status a freshly created roadmap card starts in. */
  roadmapNodeDefaultStatus: string;
  /** Convert a markdown note into a canvas, one card per heading. */
  enableNoteToCanvas: boolean;
  /** Deepest heading level that gets its own card (1-6). */
  noteToCanvasMaxDepth: number;
  /** Width of a generated card. */
  noteToCanvasCardWidth: number;
  /** Height of a generated card. */
  noteToCanvasCardHeight: number;
  /** Folder for generated canvases; empty means beside the note. */
  noteToCanvasFolder: string;
  /** Put the section text in the card; off embeds a link back to the note instead. */
  noteToCanvasIncludeBody: boolean;
  enableFolderBase: boolean;
  enableTypingGame: boolean;
  /** Multiple-choice quiz practice built from notes in "DB Quiz" folders. */
  enableQuiz: boolean;
  /** Folder name that holds quiz notes. */
  quizFolderName: string;
  /** Seconds allowed per question before it counts as wrong. */
  quizQuestionSeconds: number;
  /** Leave out questions you marked irrelevant more often than relevant. */
  quizSkipBadQuestions: boolean;
  /** How many questions the "Create quiz group" prompt asks your agent for. */
  quizDefaultCount: number;
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
  /** Wikilinks inside mermaid diagrams become clickable Obsidian links. */
  enableMermaidLinks: boolean;
  /** Also feed those links to Graph View and the backlink panel. */
  mermaidLinksGraph: boolean;
  /** Semantic search: find related notes by meaning using a local embedding model. */
  enableSemanticSearch: boolean;
  /** Model id from the registry in modules/semantic-search/model-registry.ts. */
  semanticSearchModelKey: string;
  /** Vault-relative folder holding the downloaded model files. */
  semanticSearchModelPath: string;
  /** How many related notes to show (default 20). */
  semanticSearchResultsLimit: number;
  /** Comma-separated path fragments excluded from indexing and results. */
  semanticSearchExcludeFilter: string;
  /** Show the folder path under each result. */
  semanticSearchShowFullPath: boolean;
  /** Re-embed a note shortly after it is edited. */
  semanticSearchAutoIndex: boolean;
  /** Characters of a note sent to the model (0 = no limit). */
  semanticSearchMaxChars: number;
  /** Hide results scoring below this (0-1). */
  semanticSearchMinScore: number;
  /** Notes embedded per model call. Higher is faster but uses more memory. */
  semanticSearchBatchSize: number;
  /** Search while typing. Off means the search runs on Enter. */
  semanticSearchAsYouType: boolean;
  /** How long to wait after the last keystroke before searching. */
  semanticSearchDebounceMs: number;
  /** Which scorers contribute to the total. */
  semanticSearchUseVector: boolean;
  semanticSearchUseExact: boolean;
  semanticSearchUseFuzzy: boolean;
  /** Weights, always kept summing to 1.0. */
  semanticSearchWeightVector: number;
  semanticSearchWeightExact: number;
  semanticSearchWeightFuzzy: number;
  /** Drop results without the exact term, rather than scoring them 0. */
  semanticSearchExactRequired: boolean;
  /** Show the per-scorer breakdown when a result is clicked. */
  semanticSearchShowBreakdown: boolean;
  /** Characters of each note kept in the index for exact/fuzzy matching. */
  semanticSearchSnippetChars: number;
  /** Index .canvas files alongside notes. */
  semanticSearchIndexCanvas: boolean;
  /** How long after an edit before the note is re-embedded. */
  semanticSearchAutoIndexDelayMs: number;
  /** Semantic graph: the nearest connections of the active note, drawn as a node graph. */
  enableSemanticGraph: boolean;
  /** How many nearest notes to draw per hop. */
  semanticGraphLimit: number;
  /** Drop anything scoring at or below this (0-1). */
  semanticGraphMinScore: number;
  /** How far alt-click may expand from the centre note. */
  semanticGraphMaxHops: number;
  /** Stretch scores across their own range, so the panel is used end to end. */
  semanticGraphSpread: boolean;
  /** Topic groups to colour and gather on one side each. 0 or 1 turns it off. */
  semanticGraphClusters: number;
  /** Which scorers contribute, kept separate from the search panel's. */
  semanticGraphUseVector: boolean;
  semanticGraphUseExact: boolean;
  semanticGraphUseFuzzy: boolean;
  /** Weights, always kept summing to 1.0. */
  semanticGraphWeightVector: number;
  semanticGraphWeightExact: number;
  semanticGraphWeightFuzzy: number;
  /** Draw labels under the circles. Off makes a dense graph readable. */
  semanticGraphShowLabels: boolean;
  /** Re-centre on the note you open, rather than staying put. */
  semanticGraphFollowActive: boolean;
  /** Semantic cluster: every note in the vault, grouped by topic and drawn as clouds. */
  enableSemanticCluster: boolean;
  /**
   * How many groups the top level of the map is split into; 0 chooses from the
   * vault's size. Set from the control on the map itself, not from Settings,
   * and remembered so reopening the tab keeps it.
   */
  semanticClusterCount: number;
  /** Groups smaller than this are folded into their nearest neighbour. */
  semanticClusterMinSize: number;
  /** Extra comma-separated path fragments to leave out, on top of search's exclude filter. */
  semanticClusterExclude: string;
  /** Draw each group's name above its cloud. */
  semanticClusterShowLabels: boolean;
  /** Keep notes that hold little beyond their title, such as unfinished drafts. */
  semanticClusterIncludeEmpty: boolean;
  /** Words the user never wants as group names or keywords, comma or line separated. */
  semanticClusterStopwords: string;
  /** Gather this plugin's right-click items under one "Rico Plugin" parent. */
  groupContextMenu: boolean;
}

/** Default model: handles Indonesian and English, ~120MB on disk. */
export const DEFAULT_SEMANTIC_MODEL_KEY = "multilingual-e5-small";

/** Vault-relative folder the model files are downloaded into. */
export const DEFAULT_SEMANTIC_MODEL_PATH = ".models";

/** Folder name scanned for quiz notes. */
export const DEFAULT_QUIZ_FOLDER = "DB Quiz";

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
  enableCanvasNetworkGraph: true,
  enableCanvasRoadmapNode: true,
  roadmapNodeDefaultStatus: "none",
  enableNoteToCanvas: true,
  noteToCanvasMaxDepth: 6,
  noteToCanvasCardWidth: 400,
  noteToCanvasCardHeight: 240,
  noteToCanvasFolder: "",
  noteToCanvasIncludeBody: true,
  enableFolderBase: true,
  enableTypingGame: true,
  enableQuiz: true,
  quizFolderName: DEFAULT_QUIZ_FOLDER,
  quizQuestionSeconds: 30,
  quizSkipBadQuestions: true,
  quizDefaultCount: 10,
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
  enableMermaidLinks: true,
  mermaidLinksGraph: true,
  enableSemanticSearch: true,
  semanticSearchModelKey: DEFAULT_SEMANTIC_MODEL_KEY,
  semanticSearchModelPath: DEFAULT_SEMANTIC_MODEL_PATH,
  semanticSearchResultsLimit: 20,
  semanticSearchExcludeFilter: "",
  semanticSearchShowFullPath: false,
  semanticSearchAutoIndex: true,
  semanticSearchMaxChars: 2000,
  semanticSearchMinScore: 0,
  semanticSearchBatchSize: 8,
  semanticSearchAsYouType: true,
  semanticSearchDebounceMs: 400,
  semanticSearchUseVector: true,
  semanticSearchUseExact: true,
  semanticSearchUseFuzzy: false,
  semanticSearchWeightVector: 0.5,
  semanticSearchWeightExact: 0.3,
  semanticSearchWeightFuzzy: 0.2,
  semanticSearchExactRequired: false,
  semanticSearchShowBreakdown: true,
  semanticSearchSnippetChars: 1000,
  semanticSearchIndexCanvas: false,
  semanticSearchAutoIndexDelayMs: 30000,
  enableSemanticGraph: true,
  semanticGraphLimit: 12,
  semanticGraphMinScore: 0,
  semanticGraphMaxHops: 2,
  semanticGraphSpread: true,
  semanticGraphClusters: 4,
  semanticGraphUseVector: true,
  semanticGraphUseExact: false,
  semanticGraphUseFuzzy: false,
  semanticGraphWeightVector: 0.6,
  semanticGraphWeightExact: 0.25,
  semanticGraphWeightFuzzy: 0.15,
  semanticGraphShowLabels: true,
  semanticGraphFollowActive: true,
  enableSemanticCluster: true,
  semanticClusterCount: 0,
  semanticClusterMinSize: 3,
  semanticClusterExclude: "",
  semanticClusterShowLabels: true,
  semanticClusterIncludeEmpty: true,
  semanticClusterStopwords: "",
  groupContextMenu: true,
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
