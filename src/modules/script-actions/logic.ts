import { parseExtensions } from "../../shared/utils/extensions";

/** Where the right-click actions are defined, relative to the vault root. */
export const ACTIONS_PATH = "60-System/scripts/actions.json";

export type ActionTarget = "file" | "folder" | "any";
export type ActionMode = "terminal" | "silent";

export interface ScriptAction {
  title: string;
  icon: string;
  target: ActionTarget;
  /** Only for files: limit to these extensions (lowercase, no dot). Empty = any. */
  extensions: string[];
  /** Vault-relative folders/files this action is limited to. Empty = everywhere. */
  paths: string[];
  command: string;
  mode: ActionMode;
}

export interface ParseResult {
  actions: ScriptAction[];
  /** Problems found. Broken actions are skipped, the rest still load. */
  errors: string[];
}

export interface MenuTarget {
  path: string;
  isFolder: boolean;
  extension: string;
}

const TARGETS: ActionTarget[] = ["file", "folder", "any"];
const MODES: ActionMode[] = ["terminal", "silent"];

function normalizePath(p: string): string {
  return p.trim().replace(/^\.?\//, "").replace(/\/+$/, "");
}

/** Read the text of actions.json. Never throws, bad input just becomes errors. */
export function parseActions(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { actions: [], errors: [`Not valid JSON: ${(err as Error).message}`] };
  }

  const list = Array.isArray(raw) ? raw : (raw as { actions?: unknown } | null)?.actions;
  if (!Array.isArray(list)) {
    return { actions: [], errors: ['Expected {"actions": [ ... ]}'] };
  }

  const actions: ScriptAction[] = [];
  const errors: string[] = [];

  list.forEach((item, i) => {
    const label = `Action #${i + 1}`;
    if (!item || typeof item !== "object") {
      errors.push(`${label}: must be an object`);
      return;
    }
    const a = item as Record<string, unknown>;

    if (typeof a.title !== "string" || !a.title.trim()) {
      errors.push(`${label}: "title" is required`);
      return;
    }
    if (typeof a.command !== "string" || !a.command.trim()) {
      errors.push(`${label} (${a.title}): "command" is required`);
      return;
    }

    const target = (a.target ?? "any") as ActionTarget;
    if (!TARGETS.includes(target)) {
      errors.push(`${label} (${a.title}): "target" must be file, folder or any`);
      return;
    }
    const mode = (a.mode ?? "terminal") as ActionMode;
    if (!MODES.includes(mode)) {
      errors.push(`${label} (${a.title}): "mode" must be terminal or silent`);
      return;
    }

    actions.push({
      title: a.title.trim(),
      icon: typeof a.icon === "string" && a.icon ? a.icon : "play",
      target,
      extensions: Array.isArray(a.extensions) ? parseExtensions(a.extensions.join(",")) : [],
      paths: Array.isArray(a.paths)
        ? a.paths.filter((p): p is string => typeof p === "string").map(normalizePath).filter(Boolean)
        : [],
      command: a.command.trim(),
      mode,
    });
  });

  return { actions, errors };
}

export function matchesAction(action: ScriptAction, t: MenuTarget): boolean {
  if (action.target === "file" && t.isFolder) return false;
  if (action.target === "folder" && !t.isFolder) return false;

  if (action.extensions.length > 0) {
    if (t.isFolder || !action.extensions.includes(t.extension.toLowerCase())) return false;
  }

  if (action.paths.length > 0) {
    const p = normalizePath(t.path);
    const inside = action.paths.some((prefix) => p === prefix || p.startsWith(prefix + "/"));
    if (!inside) return false;
  }

  return true;
}

/** Wrap a value so a shell reads it as one plain word (spaces, quotes, & are safe). */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface CommandVars {
  path: string;
  name: string;
  folder: string;
  vault: string;
  ext: string;
}

/** Fill {{path}}, {{name}}, {{folder}}, {{vault}}, {{ext}}. Values are quoted for you. */
export function buildCommand(template: string, vars: CommandVars): string {
  return template.replace(/\{\{\s*(path|name|folder|vault|ext)\s*\}\}/g, (_m, key: keyof CommandVars) =>
    shellQuote(vars[key])
  );
}

export function varsFor(t: MenuTarget, name: string, vault: string): CommandVars {
  const parent = t.path.includes("/") ? t.path.slice(0, t.path.lastIndexOf("/")) : ".";
  return {
    path: t.path,
    name,
    folder: t.isFolder ? t.path : parent,
    vault,
    ext: t.extension,
  };
}
