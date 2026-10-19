import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type RicoObsidianPlugin from "../main";
import {
  DEFAULT_VISIBILITY_RULES,
  DEFAULT_VISIBLE_EXTENSIONS,
  RicoPluginSettings,
} from "../types";

type ToggleKey = {
  [K in keyof RicoPluginSettings]: RicoPluginSettings[K] extends boolean ? K : never;
}[keyof RicoPluginSettings];

export class RicoSettingTab extends PluginSettingTab {
  plugin: RicoObsidianPlugin;

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
  }

  // ---- Groups ----

  private renderCanvasGroup(containerEl: HTMLElement): void {
    this.heading(containerEl, "Canvas");

    this.toggle(containerEl, {
      key: "enableCanvasDrawing",
      name: "Freehand Drawing",
      desc: "Enable pencil tool, frames, and layers overlay on Obsidian Canvas.",
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
