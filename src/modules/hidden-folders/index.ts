import { App, Notice, Platform, Plugin, TFile, TFolder } from "obsidian";
import type RicoObsidianPlugin from "../../main";
import { DEFAULT_VISIBILITY_RULES } from "../../types";
import { installSwitcherFilter } from "./switcher-filter";
import { isShownByRules, matchPath, parseRules, type Rule } from "../../shared/utils/ignore-rules";

export interface AdapterInternals {
  getRealPath: (normalizedPath: string) => string;
  getFullPath: (normalizedPath: string) => string;
  _exists: (fullPath: string, normalizedPath: string) => Promise<boolean>;
  reconcileFileInternal: (realPath: string, normalizedPath: string) => Promise<void>;
  reconcileDeletion: (realPath: string, normalizedPath: string) => Promise<void>;
  list: (normalizedPath: string) => Promise<{ files: string[]; folders: string[] }>;
}

const DEFAULT_RULES = parseRules(DEFAULT_VISIBILITY_RULES);

/** Safety limits for the vault walk so a huge folder can't freeze Obsidian. */
const MAX_SCAN_DEPTH = 12;
const MAX_SCAN_ENTRIES = 20000;

function hasHiddenSegment(path: string): boolean {
  return path.split("/").some((seg) => seg.startsWith("."));
}

/**
 * True when the path is a hidden (dot-prefixed) path that the rules want shown.
 * Normal paths are indexed by Obsidian already, so they are never patched.
 */
export function isTargetHiddenPath(
  path: string,
  rules: Rule[] = DEFAULT_RULES,
  isDir?: boolean
): boolean {
  const norm = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!hasHiddenSegment(norm)) return false;
  return isShownByRules(rules, norm, isDir);
}

export class HiddenFoldersManager {
  private plugin: RicoObsidianPlugin;
  private unpatch: (() => void) | null = null;
  private unpatchSwitcher: (() => void) | null = null;
  private surfacedPaths: Set<string> = new Set();
  private toggling = false;
  private isHidingAll = false;

  constructor(plugin: RicoObsidianPlugin) {
    this.plugin = plugin;
  }

  private cachedRulesText: string | null = null;
  private cachedRules: Rule[] = [];

  private getRules(): Rule[] {
    const text = this.plugin.settings.visibilityRules ?? DEFAULT_VISIBILITY_RULES;
    if (text !== this.cachedRulesText) {
      this.cachedRules = parseRules(text);
      this.cachedRulesText = text;
    }
    return this.cachedRules;
  }

  init(): void {
    if (typeof Platform !== "undefined" && !Platform.isDesktopApp && typeof process === "undefined") {
      return;
    }

    this.installPatch();
    this.installSwitcherFilter();

    this.plugin.addCommand({
      id: "toggle-show-hidden-folders",
      name: "Toggle hidden folders visibility",
      callback: () => this.toggleVisibility(),
    });

    this.plugin.app.workspace.onLayoutReady(async () => {
      if (this.plugin.settings.enableHiddenFolders) {
        await this.surfaceTargetFolders();
      }
    });

    // Also surface immediately if layout is already ready
    if (this.plugin.settings.enableHiddenFolders) {
      setTimeout(() => this.surfaceTargetFolders(), 500);
    }
  }

  destroy(): void {
    if (this.unpatch) {
      this.unpatch();
      this.unpatch = null;
    }
    this.unpatchSwitcher?.();
    this.unpatchSwitcher = null;
    this.hideAll();
  }

  private installSwitcherFilter(): void {
    if (this.unpatchSwitcher) return;
    this.unpatchSwitcher = installSwitcherFilter(
      this.plugin.app,
      () => this.plugin.settings.hideHiddenFromSwitcher
    );
  }

  private installPatch(): void {
    const adapter = this.plugin.app.vault.adapter as unknown as AdapterInternals;
    if (!adapter || typeof adapter.reconcileDeletion !== "function") return;

    const originalReconcileDeletion = adapter.reconcileDeletion;

    const wrapped = async (realPath: string, path: string): Promise<void> => {
      if (
        this.isHidingAll ||
        !this.plugin.settings.enableHiddenFolders ||
        !isTargetHiddenPath(path, this.getRules())
      ) {
        return originalReconcileDeletion.call(adapter, realPath, path);
      }

      // Path is within .obsidian or .trash
      try {
        const fullPath =
          typeof adapter.getFullPath === "function"
            ? adapter.getFullPath(path)
            : path;
        const exists =
          typeof adapter._exists === "function"
            ? await adapter._exists(fullPath, path)
            : true;

        if (!exists) {
          this.surfacedPaths.delete(path);
          return originalReconcileDeletion.call(adapter, realPath, path);
        }

        if (this.plugin.settings.enableHiddenFolders) {
          if (typeof adapter.reconcileFileInternal === "function") {
            await adapter.reconcileFileInternal(realPath, path);
            this.surfacedPaths.add(path);
            return;
          }
        }
      } catch {
        // Fall back to original on error
      }
      return originalReconcileDeletion.call(adapter, realPath, path);
    };

    adapter.reconcileDeletion = wrapped as any;
    this.unpatch = () => {
      adapter.reconcileDeletion = originalReconcileDeletion;
    };
  }

  async toggleVisibility(): Promise<void> {
    if (this.toggling) return;
    this.toggling = true;
    try {
      this.plugin.settings.enableHiddenFolders =
        !this.plugin.settings.enableHiddenFolders;
      await this.plugin.savePluginSettings();
      if (this.plugin.settings.enableHiddenFolders) {
        await this.surfaceTargetFolders();
        new Notice("Hidden folders: Visible");
      } else {
        await this.hideAll();
        new Notice("Hidden folders: Hidden");
      }
    } finally {
      this.toggling = false;
    }
  }

  /** Re-apply the rules after the user edits them: hide what was surfaced, then surface again. */
  async reloadRules(): Promise<void> {
    await this.hideAll();
    if (this.plugin.settings.enableHiddenFolders) {
      await this.surfaceTargetFolders();
    }
  }

  async surfaceTargetFolders(): Promise<void> {
    const rules = this.getRules();
    if (rules.length === 0) return;
    await this.walk("/", rules, { left: MAX_SCAN_ENTRIES }, 0);
  }

  private async surfacePath(path: string): Promise<void> {
    const adapter = this.plugin.app.vault.adapter as unknown as AdapterInternals;
    const fullPath =
      typeof adapter.getFullPath === "function" ? adapter.getFullPath(path) : path;
    const exists =
      typeof adapter._exists === "function"
        ? await adapter._exists(fullPath, path)
        : true;
    if (!exists) return;

    const realPath =
      typeof adapter.getRealPath === "function" ? adapter.getRealPath(path) : path;
    if (typeof adapter.reconcileFileInternal === "function") {
      await adapter.reconcileFileInternal(realPath, path);
      this.surfacedPaths.add(path);
    }
  }

  private async walk(
    folder: string,
    rules: Rule[],
    budget: { left: number },
    depth: number
  ): Promise<void> {
    if (depth > MAX_SCAN_DEPTH || budget.left <= 0) return;
    const adapter = this.plugin.app.vault.adapter as unknown as AdapterInternals;
    if (!adapter || typeof adapter.list !== "function") return;

    try {
      const res = await adapter.list(folder);
      if (!res) return;

      for (const file of res.files ?? []) {
        if (--budget.left < 0) return;
        if (isTargetHiddenPath(file, rules, false)) {
          await this.surfacePath(file);
        }
      }

      for (const subDir of res.folders ?? []) {
        if (--budget.left < 0) return;
        // Folders hidden by a `!` rule (node_modules, .git...) are never entered.
        if (matchPath(rules, subDir, true) === "excluded") continue;
        if (isTargetHiddenPath(subDir, rules, true)) {
          await this.surfacePath(subDir);
        }
        await this.walk(subDir, rules, budget, depth + 1);
      }
    } catch {
      // Ignore errors for individual paths
    }
  }

  async hideAll(): Promise<void> {
    this.isHidingAll = true;
    try {
      const adapter = this.plugin.app.vault.adapter as unknown as AdapterInternals;
      const paths = Array.from(this.surfacedPaths);
      for (const path of paths) {
        try {
          const real =
            typeof adapter.getRealPath === "function"
              ? adapter.getRealPath(path)
              : path;
          await adapter.reconcileDeletion?.(real, path);
          this.forceRemove(path);
        } catch {
          // Ignore
        }
      }
      this.surfacedPaths.clear();
    } finally {
      this.isHidingAll = false;
    }
  }

  private forceRemove(path: string): void {
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (file) {
      const parent = file.parent;
      if (parent && Array.isArray(parent.children)) {
        const idx = parent.children.indexOf(file);
        if (idx >= 0) parent.children.splice(idx, 1);
      }
    }

    const vaultAny = this.plugin.app.vault as any;
    if (vaultAny.fileMap && path in vaultAny.fileMap) {
      delete vaultAny.fileMap[path];
    }

    const explorerLeaves = this.plugin.app.workspace.getLeavesOfType("file-explorer");
    for (const leaf of explorerLeaves) {
      const view = leaf.view as any;
      if (view?.fileItems && path in view.fileItems) {
        const item = view.fileItems[path];
        if (item?.el && typeof item.el.remove === "function") {
          item.el.remove();
        }
        delete view.fileItems[path];
      }
    }
  }
}
