import { App, EventRef, Plugin } from "obsidian";
import { leafId } from "./shared/lib/leaf-id";

import { CanvasDrawingOverlay } from "./modules/canvas/drawing/overlay";
import {
  closeHammerPopup,
  injectHammerButton,
  injectHammerButtonIntoMenu,
  removeAllHammerButtons,
} from "./modules/canvas/hammer-menu";
import { Canvas, getActiveCanvas } from "./shared/utils/canvas";

// Register canvas tools for hammer popup menu
import "./modules/canvas/icon-new-tab/index";
import "./modules/canvas/backlink-picker/index";

import { OgLinkCanvasManager } from "./modules/canvas/og-link";
import { CanvasLayersManager } from "./modules/canvas/layers";
import { CanvasIconDropManager } from "./modules/canvas/icon-drop";
import { registerCanvasOutline } from "./modules/canvas/outline";
import { registerCanvasNetworkGraph } from "./modules/canvas/network-graph";
import { registerNoteToCanvas } from "./modules/canvas/note-to-canvas";
import { registerCanvasRoadmapNode } from "./modules/canvas/roadmap-node";
import { registerFolderBase } from "./modules/folder-base";
import { registerTypingGame } from "./modules/typing-game";
import { registerQuiz } from "./modules/quiz";
import { registerRunInTerminal } from "./modules/run-in-terminal";
import { registerCodeEditor } from "./modules/code-editor";
import { registerNewFile } from "./modules/new-file";
import { registerTabClose } from "./modules/tab-close";
import { registerScriptActions } from "./modules/script-actions";
import { HiddenFoldersManager } from "./modules/hidden-folders";
import { TocManager } from "./modules/toc";
import { registerAutoPin } from "./modules/auto-pin";
import { registerBlockReference } from "./modules/block-reference";
import { registerBlockReferencePanels } from "./modules/block-reference/panels";
import { registerSemanticSearch } from "./modules/semantic-search";
import { registerSemanticGraph } from "./modules/semantic-graph";
import { FileMenuRegistry } from "./shared/lib/menu-registry";
import { registerMermaidLinks } from "./modules/mermaid-links";
import { removeAllRails } from "./modules/canvas/tool-rail";
import { DEFAULT_SETTINGS, normalizeSettings, RicoPluginSettings } from "./types";
import { RicoSettingTab } from "./settings/settings-tab";

const MENU_SELECTOR = ".canvas-menu";

function resolveCanvas(app: App, args: unknown[]): Canvas | undefined {
  for (const arg of args) {
    const candidate = arg as Canvas | undefined;
    if (candidate?.menu?.menuEl) return candidate;
  }
  return getActiveCanvas(app);
}

export default class RicoObsidianPlugin extends Plugin {
  settings: RicoPluginSettings = DEFAULT_SETTINGS;

  // Drawing overlay manager
  private overlays: Map<string, CanvasDrawingOverlay> = new Map();
  private menuObserver: MutationObserver | null = null;
  private ogLinkManager: OgLinkCanvasManager | null = null;
  private layersManager: CanvasLayersManager | null = null;
  private iconDropManager: CanvasIconDropManager | null = null;
  hiddenFoldersManager: HiddenFoldersManager | null = null;
  private tocManager: TocManager | null = null;

  /**
   * The one "Rico Plugin" parent in the right-click menu.
   *
   * Modules contribute providers to this instead of registering their own
   * file-menu listener, which is the only way they can share a single parent
   * row — separate listeners cannot see each other's items.
   */
  readonly fileMenu = new FileMenuRegistry({
    grouped: () => this.settings.groupContextMenu,
  });

  async onload(): Promise<void> {
    await this.loadSettings();

    console.log("🚀 Rico Obsidian Plugin suite loaded");

    // One listener for every module's right-click items, registered before the
    // modules themselves so their providers are in place by the first click.
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => this.fileMenu.fill(menu, file)),
    );


    // 1. Canvas Drawing Module
    if (this.settings.enableCanvasDrawing) {
      this.registerEvent(
        this.app.workspace.on("layout-change", () => this.syncOverlays())
      );
      this.registerEvent(
        this.app.workspace.on("active-leaf-change", () => this.syncOverlays())
      );
      setTimeout(() => this.syncOverlays(), 400);
    }

    // 2. Canvas Hammer Menu Module
    if (this.settings.enableCanvasHammerMenu) {
      const workspaceOn = (
        this.app.workspace as unknown as {
          on: (name: string, cb: (...args: unknown[]) => void) => EventRef;
        }
      ).on;

      const ref = workspaceOn.call(
        this.app.workspace,
        "canvas:popup-menu",
        (...args: unknown[]) => {
          const canvas = resolveCanvas(this.app, args);
          if (canvas) {
            injectHammerButton(this.app, canvas);
          }
        }
      );
      this.registerEvent(ref);

      this.menuObserver = new MutationObserver(() => this.scanAndInjectHammer());
      this.menuObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });

      this.app.workspace.onLayoutReady(() => {
        this.syncOverlays();
        this.scanAndInjectHammer();
      });
      this.scanAndInjectHammer();
    }

    // 3. Canvas OG Link Module
    if (this.settings.enableCanvasOgLink) {
      this.ogLinkManager = new OgLinkCanvasManager(this);
      this.ogLinkManager.init();
    }

    // 4. Canvas Layers Module
    if (this.settings.enableCanvasLayers) {
      this.layersManager = new CanvasLayersManager(this);
      this.layersManager.init();
    }

    // 4b. Canvas Icon Drop Module
    if (this.settings.enableCanvasIconDrop) {
      this.iconDropManager = new CanvasIconDropManager(this);
      this.iconDropManager.init();
    }

    // 4c. Canvas Outline Module (read-only outline in the right sidebar)
    if (this.settings.enableCanvasOutline) {
      registerCanvasOutline(this);
    }

    // 4d. Canvas Network Graph Module (read-only graph view in the right sidebar)
    if (this.settings.enableCanvasNetworkGraph) {
      registerCanvasNetworkGraph(this);
    }

    // 4d2. Roadmap Node Module (roadmap.sh-style cards: title, status, article)
    // Always registered; the handlers check the setting, so the toggle applies instantly.
    registerCanvasRoadmapNode(this);

    // 4e. Note to Canvas Module (markdown headings become canvas cards)
    // Always registered; the handlers check the setting, so the toggle applies instantly.
    registerNoteToCanvas(this, this.fileMenu);

    // 5. Folder Base Module
    if (this.settings.enableFolderBase) {
      registerFolderBase(this, this.fileMenu);
    }

    // 6. Typing Game Module
    if (this.settings.enableTypingGame) {
      registerTypingGame(this);
    }

    // 6b. Quiz Builder Module
    if (this.settings.enableQuiz) {
      registerQuiz(this, this.fileMenu);
    }

    // 7. Run in Terminal Module
    if (this.settings.enableRunInTerminal) {
      registerRunInTerminal(this, this.fileMenu);
    }

    // 7b. Script Actions Module (right-click actions defined in scripts/actions.json)
    if (this.settings.enableScriptActions) {
      registerScriptActions(this, this.fileMenu);
    }

    // 7c. New File Module (right-click -> "New file..." with any allowed extension)
    if (this.settings.enableNewFile) {
      registerNewFile(this, this.fileMenu);
    }

    // 7d. Force close tabs (all / others, pinned included)
    if (this.settings.enableForceClose) {
      registerTabClose(this);
    }

    // 8. Code Editor (user-chosen list of extensions, opened in a real code editor)
    if (this.settings.enableCodeEditor) {
      registerCodeEditor(this);
    }

    // 9. Hidden Folders Module (rule-based, gitignore-style)
    if (this.settings.enableHiddenFolders) {
      this.hiddenFoldersManager = new HiddenFoldersManager(this);
      this.hiddenFoldersManager.init();
    }

    // 10. Floating Table of Contents Module
    if (this.settings.enableTableOfContents) {
      this.tocManager = new TocManager(this);
      this.tocManager.init();
    }

    // 11. Auto Pin Module
    // Always registered; the handler checks the setting, so the toggle applies instantly.
    registerAutoPin(this);

    // 12. Block Reference Module (right-click selected text -> "Make block reference")
    // Always registered; the handler checks the setting, so the toggle applies instantly.
    registerBlockReference(this);

    // 12b. Block Reference panels (right sidebar: this note, left sidebar: whole vault)
    if (this.settings.enableSemanticSearch) {
      // Never let one module's failure abort onload and take the rest of the
      // plugin (ribbon icons, settings tab) down with it.
      try {
        registerSemanticSearch(this);
      } catch (err) {
        console.error(">>> semantic-search: failed to register", err);
      }
    }

    // 12c. Semantic Graph (right sidebar: nearest connections of the active note).
    // Reads the index semantic search builds; keeps its own scoring weights.
    if (this.settings.enableSemanticGraph) {
      try {
        registerSemanticGraph(this);
      } catch (err) {
        console.error(">>> semantic-graph: failed to register", err);
      }
    }
    if (this.settings.enableBlockReferencePanels) {
      registerBlockReferencePanels(this);
    }

    // 13. Mermaid Links (wikilinks in diagrams -> clickable + graph view).
    // Always registered; the handlers check the setting.
    registerMermaidLinks(this);

    // Settings tab
    this.addSettingTab(new RicoSettingTab(this.app, this));
  }

  // ---- Drawing Overlays API ----
  syncOverlays(): void {
    if (!this.settings.enableCanvasDrawing) return;
    const activeIds = new Set<string>();
    for (const leaf of this.app.workspace.getLeavesOfType("canvas")) {
      const id = leafId(leaf);
      activeIds.add(id);
      if (!this.overlays.has(id)) {
        const overlay = new CanvasDrawingOverlay(leaf, this.app, this);
        overlay.attach();
        this.overlays.set(id, overlay);
      }
    }
    for (const [id, overlay] of this.overlays) {
      if (!activeIds.has(id)) {
        overlay.detach();
        this.overlays.delete(id);
      }
    }
  }

  /**
   * Public API: resolve the drawing overlay for a canvas.
   * Required for canvas tools and layers integration.
   */
  getOverlayForCanvas(canvas: unknown): CanvasDrawingOverlay | null {
    for (const overlay of this.overlays.values()) {
      const view = overlay.leaf?.view as unknown as { canvas?: unknown };
      if (view?.canvas === canvas) return overlay;
    }
    return null;
  }

  // ---- Code editor extensions ----
  /**
   * Register each chosen extension on its own, so one that Obsidian already owns
   * (like "md") is skipped instead of breaking the rest. Obsidian cannot un-register
   * at runtime, so edits to the list apply after a plugin reload.
   */
  // ---- Hidden folders API ----
  async applyVisibilityRules(): Promise<void> {
    if (!this.settings.enableHiddenFolders) return;
    if (!this.hiddenFoldersManager) {
      this.hiddenFoldersManager = new HiddenFoldersManager(this);
      this.hiddenFoldersManager.init();
    }
    await this.hiddenFoldersManager.reloadRules();
  }

  // ---- Table of Contents API ----
  getTocManager(): TocManager | null {
    return this.tocManager;
  }

  enableTocManager(): void {
    if (this.tocManager) return;
    this.tocManager = new TocManager(this);
    this.tocManager.init();
  }

  disableTocManager(): void {
    this.tocManager?.destroy();
    this.tocManager = null;
  }

  private scanAndInjectHammer(): void {
    if (!this.settings.enableCanvasHammerMenu) return;
    const menus = document.querySelectorAll<HTMLElement>(MENU_SELECTOR);
    menus.forEach((menuEl) => {
      injectHammerButtonIntoMenu(this.app, menuEl);
    });
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = normalizeSettings(data?.ricoSettings);
  }

  async savePluginSettings(): Promise<void> {
    const data = (await this.loadData()) ?? {};
    data.ricoSettings = this.settings;
    await this.saveData(data);
  }

  onunload(): void {
    for (const overlay of this.overlays.values()) {
      overlay.detach();
    }
    this.overlays.clear();

    closeHammerPopup();
    removeAllHammerButtons();
    // Individual unregisters leave the (now empty) rail container behind.
    removeAllRails();
    this.menuObserver?.disconnect();
    this.menuObserver = null;

    this.layersManager?.destroy();
    this.layersManager = null;

    this.iconDropManager?.destroy();
    this.iconDropManager = null;

    this.hiddenFoldersManager?.destroy();
    this.hiddenFoldersManager = null;

    this.tocManager?.destroy();
    this.tocManager = null;

    console.log("Rico Obsidian Plugin suite unloaded");
  }
}
