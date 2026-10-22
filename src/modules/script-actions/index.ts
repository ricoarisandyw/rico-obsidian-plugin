import type { FileMenuRegistry } from "../../shared/lib/menu-registry";
import type { MenuEntry } from "../../shared/lib/menu-group";
import { Notice, Plugin, TFile, TFolder } from "obsidian";
import {
  ACTIONS_PATH,
  MenuTarget,
  ScriptAction,
  buildCommand,
  matchesAction,
  parseActions,
  shellQuote,
  varsFor,
} from "./logic";
import { getChildProcess, getVaultPath, runInMacTerminal } from "../run-in-terminal";

const GROUP_TITLE = "In System Actions";
const GROUP_ICON = "zap";

function nodeRequire<T>(name: string): T | null {
  try {
    const req = (window as unknown as { require?: (m: string) => unknown }).require;
    return (req ? req(name) : require(name)) as T;
  } catch {
    return null;
  }
}

/**
 * Read actions.json straight from disk. A menu has to be built synchronously,
 * and re-reading each time means edits show up on the very next right-click.
 */
function readActionsFile(vaultPath: string): string | null {
  const fs = nodeRequire<typeof import("fs")>("fs");
  const path = nodeRequire<typeof import("path")>("path");
  if (!fs || !path) return null;
  try {
    return fs.readFileSync(path.join(vaultPath, ACTIONS_PATH), "utf-8");
  } catch {
    return null;
  }
}

function runSilent(vaultPath: string, action: ScriptAction, command: string): void {
  const cp = getChildProcess();
  if (!cp) {
    new Notice("❌ Node.js child_process is not available in this environment.");
    return;
  }
  // A login shell so PATH (bun, python3, ...) matches your Terminal.
  cp.exec(`zsh -lic ${shellQuote(command)}`, { cwd: vaultPath }, (err: Error | null, stdout: string, stderr: string) => {
    if (err) {
      const detail = (stderr || err.message).trim().split("\n").slice(-2).join(" ");
      new Notice(`❌ ${action.title} failed: ${detail}`, 8000);
      return;
    }
    const last = stdout.trim().split("\n").pop();
    new Notice(`✅ ${action.title}${last ? `: ${last}` : " done"}`, 6000);
  });
}

function runAction(vaultPath: string, action: ScriptAction, target: MenuTarget, name: string): void {
  const command = buildCommand(action.command, varsFor(target, name, vaultPath));
  if (action.mode === "silent") {
    runSilent(vaultPath, action, command);
  } else {
    new Notice(`🚀 ${action.title}...`);
    runInMacTerminal(vaultPath, command);
  }
}

export function registerScriptActions(
  plugin: Plugin & { settings: { enableScriptActions: boolean } },
  menuRegistry?: FileMenuRegistry,
): void {
  menuRegistry?.add((file) => {
    if (!plugin.settings.enableScriptActions) return [];

    const isFolder = file instanceof TFolder;
    if (!isFolder && !(file instanceof TFile)) return [];
    if (isFolder && file.isRoot()) return [];

    const vaultPath = getVaultPath(plugin);
    if (!vaultPath) return [];

    const text = readActionsFile(vaultPath);
    if (text === null) return []; // no actions.json, nothing to add

    const { actions, errors } = parseActions(text);
    const entries: MenuEntry[] = [];

    if (errors.length > 0) {
      entries.push({
        title: "⚠️ actions.json has a problem",
        icon: "alert-triangle",
        onClick: () => new Notice(`${ACTIONS_PATH}\n${errors.join("\n")}`, 12000),
      });
    }

    const target: MenuTarget = {
      path: file.path,
      isFolder,
      extension: file instanceof TFile ? file.extension : "",
    };

    for (const action of actions) {
      if (!matchesAction(action, target)) continue;
      entries.push({
        title: action.title,
        icon: action.icon,
        onClick: () => runAction(vaultPath, action, target, file.name),
      });
    }
    if (!entries.length) return [];

    // Nested one level down so a long actions.json does not crowd the other
    // modules' entries in the "Rico Plugin" menu.
    return [{ title: GROUP_TITLE, icon: GROUP_ICON, onClick: () => undefined, children: entries }];
  });
}
