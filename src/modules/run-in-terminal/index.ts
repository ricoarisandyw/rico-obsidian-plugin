import type { FileMenuRegistry } from "../../shared/lib/menu-registry";
import { FileSystemAdapter, Notice, Plugin, TFile } from "obsidian";
import { exec } from "child_process";

export interface TerminalRunnerOptions {
  enableRunInTerminal: boolean;
}

export function getChildProcess(): { exec: typeof exec } | null {
  try {
    if (typeof window !== "undefined" && (window as unknown as { require?: (module: string) => unknown }).require) {
      return (window as unknown as { require: (module: string) => { exec: typeof exec } }).require("child_process");
    }
    return require("child_process");
  } catch (e) {
    console.error("Child process not available:", e);
    return null;
  }
}

/**
 * Execute command inside macOS Terminal.app
 * This ensures the user's interactive shell (.zshrc) and environment variables
 * (such as PATH for bun, python3, go) are properly loaded.
 */
export function runInMacTerminal(cwd: string, command: string): void {
  const cp = getChildProcess();
  if (!cp || !cp.exec) {
    new Notice("❌ Node.js child_process is not available in this environment.");
    return;
  }

  // Construct command to cd into vault directory and execute
  const fullCmd = `cd "${cwd.replace(/"/g, '\\"')}" && ${command}`;
  // Escape for AppleScript string literal
  const escapedCmd = fullCmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const appleScript = `tell application "Terminal"
  activate
  do script "${escapedCmd}"
end tell`;

  cp.exec(`osascript -e '${appleScript.replace(/'/g, "'\\''")}'`, (err) => {
    if (err) {
      console.error("Failed to run in Terminal:", err);
      new Notice(`❌ Failed to launch Terminal: ${err.message}`);
    }
  });
}

function getCommandForFile(file: TFile): { command: string; runtime: string } | null {
  const ext = file.extension.toLowerCase();
  const filePath = file.path;

  if (ext === "ts") {
    return { command: `bun "${filePath}"`, runtime: "bun" };
  }
  if (ext === "py") {
    return { command: `python3 "${filePath}"`, runtime: "python3" };
  }
  if (ext === "go") {
    return { command: `go run "${filePath}"`, runtime: "go" };
  }
  if (ext === "js") {
    return { command: `bun "${filePath}"`, runtime: "bun" };
  }
  if (ext === "sh") {
    return { command: `bash "${filePath}"`, runtime: "bash" };
  }

  return null;
}

export function getVaultPath(plugin: Plugin): string {
  const adapter = plugin.app.vault.adapter;
  if (adapter instanceof FileSystemAdapter) {
    return adapter.getBasePath();
  }
  return (adapter as unknown as { basePath?: string })?.basePath || "";
}

export function registerRunInTerminal(
  plugin: Plugin & { settings: { enableRunInTerminal: boolean } },
  menuRegistry?: FileMenuRegistry,
): void {
  // 1. Context menu entry, offered only for files we know how to run.
  menuRegistry?.add((file) => {
    if (!plugin.settings.enableRunInTerminal) return [];
    if (!(file instanceof TFile)) return [];

    const runner = getCommandForFile(file);
    if (!runner) return [];

    return [
      {
        title: "Run in terminal",
        icon: "terminal",
        onClick: () => {
          const vaultPath = getVaultPath(plugin);
          if (!vaultPath) {
            new Notice("Cannot determine vault directory path.");
            return;
          }
          new Notice(`🚀 Running ${file.name} (${runner.runtime}) in terminal...`);
          runInMacTerminal(vaultPath, runner.command);
        },
      },
    ];
  });

  // 2. Register Command Palette action for active file
  plugin.addCommand({
    id: "run-active-file-in-terminal",
    name: "Run in terminal (active file)",
    checkCallback: (checking: boolean) => {
      if (!plugin.settings.enableRunInTerminal) return false;
      const activeFile = plugin.app.workspace.getActiveFile();
      if (!activeFile) return false;

      const runner = getCommandForFile(activeFile);
      if (!runner) return false;

      if (!checking) {
        const vaultPath = getVaultPath(plugin);
        if (!vaultPath) {
          new Notice("Cannot determine vault directory path.");
          return;
        }
        new Notice(`🚀 Running ${activeFile.name} (${runner.runtime}) in terminal...`);
        runInMacTerminal(vaultPath, runner.command);
      }
      return true;
    },
  });
}
