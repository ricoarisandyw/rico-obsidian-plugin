import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type RicoObsidianPlugin from "../main";
import {
  DEFAULT_QUIZ_FOLDER,
  DEFAULT_VISIBILITY_RULES,
  DEFAULT_VISIBLE_EXTENSIONS,
  RicoPluginSettings,
} from "../types";
import { getModel } from "../modules/semantic-search/model-registry";
import { ModelManager } from "../modules/semantic-search/model-manager";
import { ModelManagerUi } from "../modules/semantic-search/model-manager-ui";
import { rebalanceWeights } from "../modules/semantic-search/scoring";

type ToggleKey = {
  [K in keyof RicoPluginSettings]: RicoPluginSettings[K] extends boolean ? K : never;
}[keyof RicoPluginSettings];

export class RicoSettingTab extends PluginSettingTab {
  plugin: RicoObsidianPlugin;
  /** Kept across redraws so a running download survives reopening settings. */
  private modelManager: ModelManager | null = null;
  private modelUi: ModelManagerUi | null = null;

  constructor(app: App, plugin: RicoObsidianPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Rico Obsidian Plugin Suite" });

    this.renderCanvasGroup(containerEl);
    this.renderDatabaseGroup(containerEl);
    this.renderFilesGroup(containerEl);
    this.renderToolsGroup(containerEl);
    this.renderQuizGroup(containerEl);
    this.renderMermaidLinksGroup(containerEl);
    this.renderMenuGroup(containerEl);
    this.renderSemanticSearchGroup(containerEl);
    this.renderSemanticGraphGroup(containerEl);
  }

  // ---- Groups ----

  private renderCanvasGroup(containerEl: HTMLElement): void {
    this.heading(containerEl, "Canvas");

    this.toggle(containerEl, {
      key: "enableCanvasDrawing",
      name: "Freehand Drawing",
      desc: "Free drawing on Obsidian Canvas: pen, line, arrow, shapes, and eraser.",
      onChange: (val) => {
        if (val) this.plugin.syncOverlays();
      },
    });
    this.toggle(containerEl, {
      key: "enableCanvasHammerMenu",
      name: "Hammer Popup Menu",
      desc: "Enable the 🔨 node popup menu with quick card actions (open in new tab, backlink picker).",
    });
    this.toggle(containerEl, {
      key: "enableCanvasOgLink",
      name: "OG Link Cards",
      desc: "Enable rich Open Graph card previews for URLs in Canvas.",
    });
    this.toggle(containerEl, {
      key: "enableCanvasLayers",
      name: "Layers Panel",
      desc: "Enable Photoshop-style layers panel and z-index ordering for Canvas.",
    });
    this.toggle(containerEl, {
      key: "enableCanvasIconDrop",
      name: "Icon Drop",
      desc: "Drag-and-drop icons from the Iconize plugin's icon packs onto Canvas.",
    });
    this.toggle(containerEl, {
      key: "enableCanvasOutline",
      name: "Canvas Outline",
      desc: "Read-only markdown view of the open canvas in the right sidebar (groups become headings, every arrow is listed as a bullet under its nodes, click to zoom to a node). Open it from the command palette. Changes apply after reloading the plugin.",
    });
    this.toggle(containerEl, {
      key: "enableCanvasNetworkGraph",
      name: "Canvas Network Graph",
      desc: "Read-only force-directed graph of the open canvas in the right sidebar (circle size = number of connections, color = node type, click to zoom to a node). Open it from the command palette. Changes apply after reloading the plugin.",
    });
    this.toggle(containerEl, {
      key: "enableCanvasRoadmapNode",
      name: "Roadmap Node",
      desc: "roadmap.sh-style cards on canvas: a title, a status (Learning / Done / Skip), and a linked note. Click a card to read the note in the right sidebar. Add one from the command palette or the node right-click menu.",
    });

    new Setting(containerEl)
      .setName("Roadmap Node: default status")
      .setDesc("Status a newly created roadmap card starts in.")
      .addDropdown((drop) =>
        drop
          .addOptions({ none: "Not started", learning: "Learning", done: "Done", skip: "Skip" })
          .setValue(this.plugin.settings.roadmapNodeDefaultStatus)
          .onChange(async (val) => {
            this.plugin.settings.roadmapNodeDefaultStatus = val;
            await this.plugin.savePluginSettings();
          })
      );

    this.toggle(containerEl, {
      key: "enableNoteToCanvas",
      name: "Note to Canvas",
      desc: "Turn a markdown note into a canvas, one card per heading, arrows from parent heading to child. Run it from the command palette, the editor right-click menu, or right-click the note in the file explorer. Re-running keeps cards you moved by hand.",
    });

    new Setting(containerEl)
      .setName("Note to Canvas: split depth")
      .setDesc("Deepest heading level that gets its own card (1-6). Deeper headings stay inside their parent card.")
      .addText((text) =>
        text
          .setPlaceholder("6")
          .setValue(String(this.plugin.settings.noteToCanvasMaxDepth))
          .onChange(async (val) => {
            const n = Number.parseInt(val, 10);
            this.plugin.settings.noteToCanvasMaxDepth = Number.isFinite(n) ? Math.min(6, Math.max(1, n)) : 6;
            await this.plugin.savePluginSettings();
          })
      );

    new Setting(containerEl)
      .setName("Note to Canvas: card size")
      .setDesc("Width and height of each generated card, in canvas pixels.")
      .addText((text) =>
        text
          .setPlaceholder("width (400)")
          .setValue(String(this.plugin.settings.noteToCanvasCardWidth))
          .onChange(async (val) => {
            const n = Number.parseInt(val, 10);
            this.plugin.settings.noteToCanvasCardWidth = Number.isFinite(n) && n > 0 ? n : 400;
            await this.plugin.savePluginSettings();
          })
      )
      .addText((text) =>
        text
          .setPlaceholder("height (240)")
          .setValue(String(this.plugin.settings.noteToCanvasCardHeight))
          .onChange(async (val) => {
            const n = Number.parseInt(val, 10);
            this.plugin.settings.noteToCanvasCardHeight = Number.isFinite(n) && n > 0 ? n : 240;
            await this.plugin.savePluginSettings();
          })
      );

    new Setting(containerEl)
      .setName("Note to Canvas: output folder")
      .setDesc('Where generated canvases go, e.g. "Canvas". Leave empty to save beside the note.')
      .addText((text) =>
        text
          .setPlaceholder("(beside the note)")
          .setValue(this.plugin.settings.noteToCanvasFolder)
          .onChange(async (val) => {
            this.plugin.settings.noteToCanvasFolder = val;
            await this.plugin.savePluginSettings();
          })
      );

    this.toggle(containerEl, {
      key: "noteToCanvasIncludeBody",
      name: "Note to Canvas: full text in cards",
      desc: "On, each card holds the section's text. Off, the card holds the heading plus an embed linking back to that section of the note.",
    });
  }

  private renderDatabaseGroup(containerEl: HTMLElement): void {
    this.heading(containerEl, "Database");

    this.toggle(containerEl, {
      key: "enableFolderBase",
      name: "Folder Base",
      desc: "Add \"New folder base\" to the folder menu: creates an Obsidian .base already filtered to that folder and showing the properties of its notes. Also keeps opening existing .fbase tables.",
    });
  }

  private renderFilesGroup(containerEl: HTMLElement): void {
    this.heading(containerEl, "Files & Explorer");

    // -- Extensions --
    this.toggle(containerEl, {
      key: "enableCodeEditor",
      name: "Open extra file types",
      desc: "Show these file types in the explorer and open them in a code editor (syntax colors, line numbers, search) instead of the markdown editor.",
    });

    new Setting(containerEl)
      .setName("File extensions")
      .setDesc(
        `Comma-separated, e.g. "${DEFAULT_VISIBLE_EXTENSIONS}". Syntax colors: json, js/mjs/cjs/jsx, ts/mts/cts/tsx, css, html. Other extensions open as plain text. This list also decides which names "New file…" accepts. Changes apply after reloading the plugin.`
      )
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_VISIBLE_EXTENSIONS)
          .setValue(this.plugin.settings.visibleExtensions)
          .onChange(async (val) => {
            this.plugin.settings.visibleExtensions = val;
            await this.plugin.savePluginSettings();
          })
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("reset")
          .setTooltip("Reset to default")
          .onClick(async () => {
            this.plugin.settings.visibleExtensions = DEFAULT_VISIBLE_EXTENSIONS;
            await this.plugin.savePluginSettings();
            new Notice("Extensions reset. Reload the plugin to apply.");
            this.display();
          })
      );

    // -- Hidden folders / files --
    this.toggle(containerEl, {
      key: "enableHiddenFolders",
      name: "Show hidden folders & files",
      desc: "Surface hidden (dot) folders and files in the File Explorer, based on the rules below.",
      onChange: async (val) => {
        if (val) {
          await this.plugin.applyVisibilityRules();
        } else {
          await this.plugin.hiddenFoldersManager?.hideAll();
        }
      },
    });

    this.toggle(containerEl, {
      key: "hideHiddenFromSwitcher",
      name: "Hide hidden files from Quick Switcher",
      desc: "Keep .obsidian/, .trash/ and other dot paths out of Quick Switcher results. They stay visible in the File Explorer.",
    });

    new Setting(containerEl)
      .setName("Visibility rules")
      .setDesc(
        "One rule per line, gitignore-style. A match is shown; start with ! to hide it. " +
          "Examples: .smart-env/  ·  *.log  ·  **/.cache/  ·  !node_modules/  ·  # comment"
      )
      .addTextArea((area) => {
        area
          .setPlaceholder(DEFAULT_VISIBILITY_RULES)
          .setValue(this.plugin.settings.visibilityRules)
          .onChange(async (val) => {
            this.plugin.settings.visibilityRules = val;
            await this.plugin.savePluginSettings();
          });
        area.inputEl.rows = 8;
        area.inputEl.addClass("rico-settings-textarea");
        // Re-scan only when the user leaves the box, not on every keystroke.
        area.inputEl.addEventListener("blur", () => {
          void this.plugin.applyVisibilityRules();
        });
      })
      .addExtraButton((btn) =>
        btn
          .setIcon("reset")
          .setTooltip("Reset to default")
          .onClick(async () => {
            this.plugin.settings.visibilityRules = DEFAULT_VISIBILITY_RULES;
            await this.plugin.savePluginSettings();
            await this.plugin.applyVisibilityRules();
            this.display();
          })
      );
  }

  private renderToolsGroup(containerEl: HTMLElement): void {
    this.heading(containerEl, "Tools & Extras");

    this.toggle(containerEl, {
      key: "enableRunInTerminal",
      name: "Run in Terminal",
      desc: "Enable right-click 'Run in terminal' context menu for .ts (bun), .py (python3), and .go (go) files.",
    });
    this.toggle(containerEl, {
      key: "enableNewFile",
      name: "New file (any extension)",
      desc: "Right-click a folder or file and choose \"New file…\" to create a file with any extension from \"File extensions\" (plus md). Non-markdown files open in the code editor.",
    });
    this.toggle(containerEl, {
      key: "enableScriptActions",
      name: "Script right-click actions",
      desc: "Add right-click items for files and folders from 60-System/scripts/actions.json. Edit that file to add or change actions, no rebuild needed.",
    });
    this.toggle(containerEl, {
      key: "enableTypingGame",
      name: "Typing Game",
      desc: "Enable the note typing practice game view and commands.",
    });
    this.toggle(containerEl, {
      key: "enableForceClose",
      name: "Force close tabs",
      desc: "Adds commands and tab right-click items to close all tabs or other tabs, even when they are pinned. Changes apply after reloading the plugin.",
    });
    this.toggle(containerEl, {
      key: "enableAutoPin",
      name: "Auto-pin opened tabs",
      desc: "Pin every tab a file is opened in, so the next file opens in a new tab instead of replacing it. A tab you unpin stays unpinned. A file that is already open in a tab is reused (and pinned) instead of opened twice, except for explicit \"open in new tab\" or \"open to the right\".",
    });
    this.toggle(containerEl, {
      key: "enableBlockReference",
      name: "Block reference",
      desc: "Right-click selected text and choose \"Make block reference\" to add a ^id to its paragraph and copy a link like [[Note#^id]], so other notes can cite or embed it. Also available as a command.",
    });
    this.toggle(containerEl, {
      key: "enableBlockReferencePanels",
      name: "Block reference panels",
      desc: "Two sidebar panels that list every ^id and who cites it: this note (right sidebar) and the whole vault (left sidebar), with search, \"not cited\" and broken-link checks. Open them from the command palette. Changes apply after reloading the plugin.",
    });
    this.toggle(containerEl, {
      key: "enableTableOfContents",
      name: "Floating Table of Contents",
      desc: "Show a sticky, collapsible table of contents over the active note, highlighting the current section.",
      onChange: (val) => {
        if (val) {
          if (!this.plugin.getTocManager()) this.plugin.enableTocManager();
        } else {
          this.plugin.disableTocManager();
        }
      },
    });
  }

  private renderQuizGroup(containerEl: HTMLElement): void {
    this.heading(containerEl, "Quiz");

    this.toggle(containerEl, {
      key: "enableQuiz",
      name: "Quiz builder",
      desc: 'Right-click a folder to copy a "create quiz group" prompt for your agent, then run the generated questions with a timer. Changes apply after reloading the plugin.',
    });

    new Setting(containerEl)
      .setName("Quiz folder name")
      .setDesc('Folder that holds quiz notes. Created inside whatever folder you right-click, and scanned vault-wide by "Run global quiz".')
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_QUIZ_FOLDER)
          .setValue(this.plugin.settings.quizFolderName)
          .onChange(async (val) => {
            this.plugin.settings.quizFolderName = val.trim() || DEFAULT_QUIZ_FOLDER;
            await this.plugin.savePluginSettings();
          })
      );

    new Setting(containerEl)
      .setName("Seconds per question")
      .setDesc("Time limit for each question. Running out counts as a wrong answer.")
      .addText((text) =>
        text
          .setPlaceholder("30")
          .setValue(String(this.plugin.settings.quizQuestionSeconds))
          .onChange(async (val) => {
            const n = Number.parseInt(val, 10);
            this.plugin.settings.quizQuestionSeconds = Number.isFinite(n) && n > 0 ? n : 30;
            await this.plugin.savePluginSettings();
          })
      );

    new Setting(containerEl)
      .setName("Questions per generated group")
      .setDesc('How many questions the "Create quiz group" prompt asks your agent to write.')
      .addText((text) =>
        text
          .setPlaceholder("10")
          .setValue(String(this.plugin.settings.quizDefaultCount))
          .onChange(async (val) => {
            const n = Number.parseInt(val, 10);
            this.plugin.settings.quizDefaultCount = Number.isFinite(n) && n > 0 ? n : 10;
            await this.plugin.savePluginSettings();
          })
      );

    this.toggle(containerEl, {
      key: "quizSkipBadQuestions",
      name: "Skip questions marked irrelevant",
      desc: "Leave out questions you gave more 👎 than 👍. They still show up in the scan-and-fix prompt.",
    });
  }

  private renderMenuGroup(containerEl: HTMLElement): void {
    this.heading(containerEl, "Right-click menu");

    this.toggle(containerEl, {
      key: "groupContextMenu",
      name: "Group this plugin's menu items",
      desc:
        "Put everything this plugin adds under one \u201cRico Plugin\u201d entry instead of " +
        "spreading it across the root menu. Applies on the next right-click.",
    });
  }

  private renderSemanticGraphGroup(containerEl: HTMLElement): void {
    this.heading(containerEl, "Semantic Graph");

    this.toggle(containerEl, {
      key: "enableSemanticGraph",
      name: "Semantic graph",
      desc:
        "Right-sidebar node graph of the notes nearest the one you are reading. " +
        "Reads the semantic search index, so index your vault first. " +
        "Changes apply after reloading the plugin.",
    });

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "The graph has its own scoring weights, tuned from the panel itself, so " +
        "they never disturb the search panel's.",
    });

    this.toggle(containerEl, {
      key: "semanticGraphFollowActive",
      name: "Follow the active note",
      desc: "Re-centre the graph on whichever note you open.",
    });

    this.toggle(containerEl, {
      key: "semanticGraphShowLabels",
      name: "Show labels",
      desc: "Draw note names under the circles. Turn off for a denser graph.",
    });

    this.toggle(containerEl, {
      key: "semanticGraphSpread",
      name: "Spread distances",
      desc:
        "Stretch the scores across the panel, so even close-scoring notes sit at clearly " +
        "different distances. Turn off to draw the raw score.",
    });

    new Setting(containerEl)
      .setName("Topic groups")
      .setDesc(
        "Colour related neighbours alike and gather each group on its own side. " +
          "From 2 to 8, or 0 to turn off (default 4). Needs indexed vectors.",
      )
      .addText((text) =>
        text
          .setPlaceholder("4")
          .setValue(String(this.plugin.settings.semanticGraphClusters))
          .onChange(async (val) => {
            const parsed = Number(val);
            if (!Number.isFinite(parsed) || parsed < 0 || parsed > 8) return;
            this.plugin.settings.semanticGraphClusters = Math.floor(parsed);
            await this.plugin.savePluginSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Connections per note")
      .setDesc("How many nearest notes to draw around the centre (default 12).")
      .addText((text) =>
        text
          .setPlaceholder("12")
          .setValue(String(this.plugin.settings.semanticGraphLimit))
          .onChange(async (val) => {
            const parsed = Number(val);
            if (!Number.isFinite(parsed) || parsed <= 0) return;
            this.plugin.settings.semanticGraphLimit = Math.floor(parsed);
            await this.plugin.savePluginSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Minimum score")
      .setDesc("Leave out connections scoring at or below this, from 0 to 1.")
      .addText((text) =>
        text
          .setPlaceholder("0")
          .setValue(String(this.plugin.settings.semanticGraphMinScore))
          .onChange(async (val) => {
            const parsed = Number(val);
            if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return;
            this.plugin.settings.semanticGraphMinScore = parsed;
            await this.plugin.savePluginSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Maximum hops")
      .setDesc(
        "How far alt-clicking may expand from the centre note. Each hop ranks the " +
          "whole vault again, so keep this small.",
      )
      .addText((text) =>
        text
          .setPlaceholder("2")
          .setValue(String(this.plugin.settings.semanticGraphMaxHops))
          .onChange(async (val) => {
            const parsed = Number(val);
            if (!Number.isFinite(parsed) || parsed < 1) return;
            this.plugin.settings.semanticGraphMaxHops = Math.floor(parsed);
            await this.plugin.savePluginSettings();
          }),
      );
  }

  private renderSemanticSearchGroup(containerEl: HTMLElement): void {
    this.heading(containerEl, "Semantic Search");

    this.toggle(containerEl, {
      key: "enableSemanticSearch",
      name: "Semantic search",
      desc:
        "Find related notes by meaning instead of keywords, using a model stored in your vault. " +
        "Nothing is sent over the network. Changes apply after reloading the plugin.",
    });

    const spec = getModel(this.plugin.settings.semanticSearchModelKey);

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Pick a model and press Download. Files are fetched from HuggingFace only " +
        "when you press the button, and everything runs offline after that.",
    });

    // Reuse one manager across redraws so an in-flight download is not orphaned.
    if (!this.modelManager) {
      this.modelManager = new ModelManager(this.plugin, () => this.plugin.settings.semanticSearchModelPath);
    }
    this.modelUi = new ModelManagerUi({
      app: this.app,
      manager: this.modelManager,
      onModelsChanged: () =>
        (this.plugin as unknown as { reloadSemanticIndex?: () => void }).reloadSemanticIndex?.(),
      selectedKey: () => this.plugin.settings.semanticSearchModelKey,
      indexedKey: () => this.plugin.settings.semanticSearchModelKey,
      onSelect: async (key) => {
        if (key === this.plugin.settings.semanticSearchModelKey) return;
        this.plugin.settings.semanticSearchModelKey = key;
        await this.plugin.savePluginSettings();
        new Notice("Model changed. Re-index the vault and reload the plugin.");
      },
    });
    void this.modelUi.render(containerEl);

    new Setting(containerEl)
      .setName("Model folder")
      .setDesc(
        `Vault-relative folder holding the downloaded model files. ` +
          `This model is expected in "${(this.plugin.settings.semanticSearchModelPath || ".models").replace(/\/+$/, "")}/${spec.key}". ` +
          "See docs/semantic-search-model-setup.md.",
      )
      .addText((text) =>
        text
          .setPlaceholder(".models")
          .setValue(this.plugin.settings.semanticSearchModelPath)
          .onChange(async (val) => {
            this.plugin.settings.semanticSearchModelPath = val.trim();
            await this.plugin.savePluginSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Results limit")
      .setDesc("How many related notes to show (default 20).")
      .addText((text) =>
        text
          .setPlaceholder("20")
          .setValue(String(this.plugin.settings.semanticSearchResultsLimit))
          .onChange(async (val) => {
            const parsed = Number(val);
            if (!Number.isFinite(parsed) || parsed <= 0) return;
            this.plugin.settings.semanticSearchResultsLimit = Math.floor(parsed);
            await this.plugin.savePluginSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Minimum score")
      .setDesc("Hide results below this score, from 0 to 1. Leave at 0 to show everything.")
      .addText((text) =>
        text
          .setPlaceholder("0")
          .setValue(String(this.plugin.settings.semanticSearchMinScore))
          .onChange(async (val) => {
            const parsed = Number(val);
            if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return;
            this.plugin.settings.semanticSearchMinScore = parsed;
            await this.plugin.savePluginSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Exclude filter")
      .setDesc(
        "Comma-separated path fragments to keep out of the index and results, " +
          "for example \"Archive/, Daily/\". Matching is case-sensitive.",
      )
      .addText((text) =>
        text
          .setPlaceholder("Archive/, Templates/")
          .setValue(this.plugin.settings.semanticSearchExcludeFilter)
          .onChange(async (val) => {
            this.plugin.settings.semanticSearchExcludeFilter = val;
            await this.plugin.savePluginSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Batch size")
      .setDesc(
        "Notes embedded per model call. Higher indexes faster but uses more memory. " +
          "Try 16 on a fast machine, or 4 if indexing makes Obsidian stutter.",
      )
      .addText((text) =>
        text
          .setPlaceholder("8")
          .setValue(String(this.plugin.settings.semanticSearchBatchSize))
          .onChange(async (val) => {
            const parsed = Number(val);
            if (!Number.isFinite(parsed) || parsed < 1 || parsed > 64) return;
            this.plugin.settings.semanticSearchBatchSize = Math.floor(parsed);
            await this.plugin.savePluginSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Characters per note")
      .setDesc("How much of a note is sent to the model. Lower is much faster; 2000 is usually enough to capture what a note is about. 0 means no limit.")
      .addText((text) =>
        text
          .setPlaceholder("8000")
          .setValue(String(this.plugin.settings.semanticSearchMaxChars))
          .onChange(async (val) => {
            const parsed = Number(val);
            if (!Number.isFinite(parsed) || parsed < 0) return;
            this.plugin.settings.semanticSearchMaxChars = Math.floor(parsed);
            await this.plugin.savePluginSettings();
          }),
      );

    this.toggle(containerEl, {
      key: "semanticSearchAsYouType",
      name: "Search while typing",
      desc:
        "Search as you type in the panel's search box. Turn off to search only when " +
        "you press Enter, which is lighter on a slower machine.",
    });

    new Setting(containerEl)
      .setName("Typing delay")
      .setDesc("How long to wait after the last keystroke before searching, in milliseconds.")
      .addText((text) =>
        text
          .setPlaceholder("400")
          .setValue(String(this.plugin.settings.semanticSearchDebounceMs))
          .onChange(async (val) => {
            const parsed = Number(val);
            if (!Number.isFinite(parsed) || parsed < 0 || parsed > 5000) return;
            this.plugin.settings.semanticSearchDebounceMs = Math.floor(parsed);
            await this.plugin.savePluginSettings();
          }),
      );

    this.toggle(containerEl, {
      key: "semanticSearchShowFullPath",
      name: "Show folder path",
      desc: "Show the folder path under each result.",
    });

    this.heading(containerEl, "Semantic Search: scoring");

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Three scorers can contribute to a result's score. Weights always add up to 1.0, " +
        "so moving one adjusts the others. These can also be tuned from the panel itself.",
    });

    this.toggle(containerEl, {
      key: "semanticSearchUseVector",
      name: "Use vector scoring",
      desc: "Match by meaning. Finds notes about the same thing even with different words.",
    });
    this.toggle(containerEl, {
      key: "semanticSearchUseExact",
      name: "Use exact scoring",
      desc: "Match literal text from the second search box.",
    });
    this.toggle(containerEl, {
      key: "semanticSearchUseFuzzy",
      name: "Use fuzzy scoring",
      desc: "Match near misses and typos. Off by default; vector and exact cover most needs.",
    });

    for (const [key, label] of [
      ["semanticSearchWeightVector", "Vector weight"],
      ["semanticSearchWeightExact", "Exact weight"],
      ["semanticSearchWeightFuzzy", "Fuzzy weight"],
    ] as const) {
      new Setting(containerEl)
        .setName(label)
        .setDesc("0 to 1. The other two adjust so the total stays 1.0.")
        .addSlider((slider) =>
          slider
            .setLimits(0, 1, 0.05)
            .setValue(this.plugin.settings[key])
            .setDynamicTooltip()
            .onChange(async (val) => {
              const moved = key.replace("semanticSearchWeight", "").toLowerCase() as
                | "vector"
                | "exact"
                | "fuzzy";
              const next = rebalanceWeights(
                {
                  vector: this.plugin.settings.semanticSearchWeightVector,
                  exact: this.plugin.settings.semanticSearchWeightExact,
                  fuzzy: this.plugin.settings.semanticSearchWeightFuzzy,
                },
                moved,
                val,
              );
              this.plugin.settings.semanticSearchWeightVector = next.vector;
              this.plugin.settings.semanticSearchWeightExact = next.exact;
              this.plugin.settings.semanticSearchWeightFuzzy = next.fuzzy;
              await this.plugin.savePluginSettings();
            }),
        );
    }

    this.toggle(containerEl, {
      key: "semanticSearchExactRequired",
      name: "Exact match is required",
      desc:
        "On: notes without the exact term are dropped entirely. " +
        "Off: they stay but score 0 for exact.",
    });
    this.toggle(containerEl, {
      key: "semanticSearchShowBreakdown",
      name: "Show score breakdown",
      desc: "Click a result's score to see how each scorer contributed.",
    });

    new Setting(containerEl)
      .setName("Snippet length")
      .setDesc(
        "Characters of each note kept in the index for exact and fuzzy matching. " +
          "Larger catches more but makes the index file bigger. Changing this needs a re-index.",
      )
      .addText((text) =>
        text
          .setPlaceholder("1000")
          .setValue(String(this.plugin.settings.semanticSearchSnippetChars))
          .onChange(async (val) => {
            const parsed = Number(val);
            if (!Number.isFinite(parsed) || parsed < 0) return;
            this.plugin.settings.semanticSearchSnippetChars = Math.floor(parsed);
            await this.plugin.savePluginSettings();
          }),
      );

    this.heading(containerEl, "Semantic Search: indexing");

    this.toggle(containerEl, {
      key: "semanticSearchIndexCanvas",
      name: "Index canvas files",
      desc:
        "Also index text written on canvas cards. Linked notes are not re-read, " +
        "only their names. Needs a re-index after changing.",
    });

    this.toggle(containerEl, {
      key: "semanticSearchAutoIndex",
      name: "Re-index on edit",
      desc:
        "Re-embed a note a while after you stop editing it. Turn off if Obsidian " +
        "feels slow while you write; a manual re-index still catches everything.",
    });

    new Setting(containerEl)
      .setName("Re-index delay")
      .setDesc(
        "How long after your last edit before the note is re-embedded, in milliseconds. " +
          "Higher means less background work while you write.",
      )
      .addText((text) =>
        text
          .setPlaceholder("30000")
          .setValue(String(this.plugin.settings.semanticSearchAutoIndexDelayMs))
          .onChange(async (val) => {
            const parsed = Number(val);
            if (!Number.isFinite(parsed) || parsed < 1000) return;
            this.plugin.settings.semanticSearchAutoIndexDelayMs = Math.floor(parsed);
            await this.plugin.savePluginSettings();
          }),
      );
  }

  private renderMermaidLinksGroup(containerEl: HTMLElement): void {
    this.heading(containerEl, "Mermaid Links");

    this.toggle(containerEl, {
      key: "enableMermaidLinks",
      name: "Wikilinks in mermaid diagrams",
      desc: "Write [[Note]] as a node label in a mermaid diagram and it becomes a real link: click to open, ctrl-click for a new tab, hover to preview. Works in sequenceDiagram and flowchart. Changes apply after reloading the plugin.",
    });

    this.toggle(containerEl, {
      key: "mermaidLinksGraph",
      name: "Show diagram links in Graph View",
      desc: "Also register those links with Obsidian's link index, so diagram relations appear in Graph View and in the backlink panel. Uses an internal Obsidian structure, so turn this off if a future update makes the graph behave oddly.",
      onChange: () => {
        new Notice("Reload the plugin to apply this to the graph.");
      },
    });
  }

  // ---- Helpers ----

  private heading(containerEl: HTMLElement, name: string): void {
    new Setting(containerEl).setName(name).setHeading();
  }

  private toggle(
    containerEl: HTMLElement,
    opts: {
      key: ToggleKey;
      name: string;
      desc: string;
      onChange?: (val: boolean) => void | Promise<void>;
    }
  ): void {
    new Setting(containerEl)
      .setName(opts.name)
      .setDesc(opts.desc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings[opts.key]).onChange(async (val) => {
          this.plugin.settings[opts.key] = val;
          await this.plugin.savePluginSettings();
          await opts.onChange?.(val);
        })
      );
  }
}
