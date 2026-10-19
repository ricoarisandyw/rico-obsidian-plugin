import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  HiddenFoldersManager,
  isTargetHiddenPath,
} from "../src/modules/hidden-folders";
import { App, Plugin } from "./mocks/obsidian";

describe("Hidden Folders Manager (.obsidian & .trash)", () => {
  describe("isTargetHiddenPath validation", () => {
    it("should allow .obsidian and nested files/folders", () => {
      expect(isTargetHiddenPath(".obsidian")).toBe(true);
      expect(isTargetHiddenPath(".obsidian/app.json")).toBe(true);
      expect(isTargetHiddenPath(".obsidian/snippets/custom.css")).toBe(true);
      expect(isTargetHiddenPath(".obsidian/plugins/my-plugin/manifest.json")).toBe(true);
    });

    it("should allow .trash and nested files/folders", () => {
      expect(isTargetHiddenPath(".trash")).toBe(true);
      expect(isTargetHiddenPath(".trash/old-note.md")).toBe(true);
      expect(isTargetHiddenPath(".trash/subfolder/file.png")).toBe(true);
    });

    it("should exclude heavy build folders inside plugins", () => {
      expect(isTargetHiddenPath(".obsidian/plugins/test/node_modules")).toBe(false);
      expect(isTargetHiddenPath(".obsidian/plugins/test/node_modules/pkg/index.js")).toBe(false);
      expect(isTargetHiddenPath(".obsidian/.git")).toBe(false);
      expect(isTargetHiddenPath(".obsidian/.git/config")).toBe(false);
    });

    it("should reject other hidden files like .git, .DS_Store, .env", () => {
      expect(isTargetHiddenPath(".git")).toBe(false);
      expect(isTargetHiddenPath(".git/HEAD")).toBe(false);
      expect(isTargetHiddenPath(".DS_Store")).toBe(false);
      expect(isTargetHiddenPath(".env")).toBe(false);
      expect(isTargetHiddenPath("folder/.hidden")).toBe(false);
      expect(isTargetHiddenPath("notes/regular-note.md")).toBe(false);
    });
  });

  describe("Adapter patching & lifecycle", () => {
    let app: App;
    let mockPlugin: any;
    let manager: HiddenFoldersManager;
    let reconcileDeletionCalls: string[];
    let reconcileFileInternalCalls: string[];

    beforeEach(() => {
      reconcileDeletionCalls = [];
      reconcileFileInternalCalls = [];

      app = new App();
      (app.vault as any).adapter = {
        getFullPath: (p: string) => `/vault/${p}`,
        getRealPath: (p: string) => p,
        _exists: async (_full: string, _norm: string) => true,
        reconcileDeletion: async (_rp: string, p: string) => {
          reconcileDeletionCalls.push(p);
        },
        reconcileFileInternal: async (_rp: string, p: string) => {
          reconcileFileInternalCalls.push(p);
        },
        list: async (folder: string) => {
          if (folder === "/" || folder === "") {
            return {
              files: [".DS_Store"],
              folders: [".obsidian", ".trash", ".git", ".smart-env", "notes"],
            };
          }
          if (folder === ".git") {
            return { files: [".git/HEAD"], folders: [] };
          }
          if (folder === ".smart-env") {
            return { files: [".smart-env/index.ajson"], folders: [] };
          }
          if (folder === ".obsidian") {
            return {
              files: [".obsidian/app.json"],
              folders: [".obsidian/snippets", ".obsidian/node_modules"],
            };
          }
          if (folder === ".obsidian/snippets") {
            return {
              files: [".obsidian/snippets/style.css"],
              folders: [],
            };
          }
          if (folder === ".trash") {
            return {
              files: [".trash/deleted.md"],
              folders: [],
            };
          }
          return { files: [], folders: [] };
        },
      };

      mockPlugin = {
        app,
        settings: { enableHiddenFolders: true },
        savePluginSettings: async () => {},
        addCommand: () => {},
      };

      manager = new HiddenFoldersManager(mockPlugin);
      manager.init();
    });

    afterEach(() => {
      manager.destroy();
    });

    it("should intercept reconcileDeletion for allowed target hidden files", async () => {
      const adapter = (app.vault as any).adapter;

      // When Obsidian tries to delete .obsidian/app.json from index:
      await adapter.reconcileDeletion(".obsidian/app.json", ".obsidian/app.json");

      // Should have intercepted and called reconcileFileInternal instead of original deletion
      expect(reconcileFileInternalCalls).toContain(".obsidian/app.json");
      expect(reconcileDeletionCalls).not.toContain(".obsidian/app.json");
    });

    it("should not intercept reconcileDeletion for non-target files like .git or regular files", async () => {
      const adapter = (app.vault as any).adapter;

      await adapter.reconcileDeletion(".git/HEAD", ".git/HEAD");
      expect(reconcileDeletionCalls).toContain(".git/HEAD");
      expect(reconcileFileInternalCalls).not.toContain(".git/HEAD");

      await adapter.reconcileDeletion("note.md", "note.md");
      expect(reconcileDeletionCalls).toContain("note.md");
    });

    it("surfaceTargetFolders should recursively surface .obsidian and .trash", async () => {
      await manager.surfaceTargetFolders();

      expect(reconcileFileInternalCalls).toContain(".obsidian");
      expect(reconcileFileInternalCalls).toContain(".obsidian/app.json");
      expect(reconcileFileInternalCalls).toContain(".obsidian/snippets");
      expect(reconcileFileInternalCalls).toContain(".obsidian/snippets/style.css");
      expect(reconcileFileInternalCalls).toContain(".trash");
      expect(reconcileFileInternalCalls).toContain(".trash/deleted.md");
    });

    it("surfaceTargetFolders should skip excluded folders like .git and node_modules", async () => {
      await manager.surfaceTargetFolders();

      expect(reconcileFileInternalCalls).not.toContain(".git");
      expect(reconcileFileInternalCalls).not.toContain(".git/HEAD");
      expect(reconcileFileInternalCalls).not.toContain(".obsidian/node_modules");
      expect(reconcileFileInternalCalls).not.toContain(".DS_Store");
      expect(reconcileFileInternalCalls).not.toContain(".smart-env");
    });

    it("custom rules decide what gets surfaced", async () => {
      mockPlugin.settings.visibilityRules = ".smart-env/\n!.obsidian/";
      await manager.surfaceTargetFolders();

      expect(reconcileFileInternalCalls).toContain(".smart-env");
      expect(reconcileFileInternalCalls).toContain(".smart-env/index.ajson");
      expect(reconcileFileInternalCalls).not.toContain(".obsidian");
      expect(reconcileFileInternalCalls).not.toContain(".trash");
    });

    it("reloadRules should un-surface old paths and surface the new ones", async () => {
      await manager.surfaceTargetFolders();
      reconcileDeletionCalls.length = 0;
      reconcileFileInternalCalls.length = 0;

      mockPlugin.settings.visibilityRules = ".trash/";
      await manager.reloadRules();

      expect(reconcileDeletionCalls).toContain(".obsidian");
      expect(reconcileFileInternalCalls).toContain(".trash");
      expect(reconcileFileInternalCalls).not.toContain(".obsidian");
    });

    it("hideAll should un-surface all registered paths", async () => {
      await manager.surfaceTargetFolders();
      reconcileDeletionCalls.length = 0;

      await manager.hideAll();

      expect(reconcileDeletionCalls).toContain(".obsidian");
      expect(reconcileDeletionCalls).toContain(".trash");
    });

    it("toggleVisibility should flip settings and update visibility", async () => {
      expect(mockPlugin.settings.enableHiddenFolders).toBe(true);

      await manager.toggleVisibility();
      expect(mockPlugin.settings.enableHiddenFolders).toBe(false);

      await manager.toggleVisibility();
      expect(mockPlugin.settings.enableHiddenFolders).toBe(true);
    });
  });
});
