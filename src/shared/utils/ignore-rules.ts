/**
 * Small gitignore-style matcher used to pick which hidden folders/files are shown.
 *
 * Supported: comments (#), blank lines, `name`, `dir/`, `/anchored`, `a/b`,
 * `*`, `?`, `**`, and `!` to hide a path again. A hidden directory also hides
 * everything under it (like gitignore, it cannot be re-shown from inside).
 */

export interface Rule {
  negated: boolean;
  dirOnly: boolean;
  regex: RegExp;
}

export type MatchResult = "shown" | "excluded" | "none";

function escapeRegex(ch: string): string {
  return ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function globToRegex(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        const atStart = i === 0 || glob[i - 1] === "/";
        const followedBySlash = glob[i + 2] === "/";
        if (atStart && followedBySlash) {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += escapeRegex(ch);
    }
  }
  return out;
}

export function parseRules(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const rawLine of (text ?? "").split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    let negated = false;
    if (line.startsWith("!")) {
      negated = true;
      line = line.slice(1).trim();
    }

    let dirOnly = false;
    if (line.endsWith("/")) {
      dirOnly = true;
      line = line.replace(/\/+$/, "");
    }
    if (!line) continue;

    // Contains a slash (start or middle) => anchored to the vault root.
    const anchored = line.includes("/");
    line = line.replace(/^\/+/, "");

    const body = globToRegex(line);
    const regex = new RegExp(anchored ? `^${body}$` : `^(?:.*/)?${body}$`);
    rules.push({ negated, dirOnly, regex });
  }
  return rules;
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Evaluate a vault path against the rules.
 * @param isDir true/false when known; undefined when unknown (directory-only rules then still apply).
 */
export function matchPath(rules: Rule[], path: string, isDir?: boolean): MatchResult {
  const norm = normalize(path);
  if (!norm) return "none";
  const parts = norm.split("/");

  let state: MatchResult = "none";
  for (let i = 0; i < parts.length; i++) {
    const prefix = parts.slice(0, i + 1).join("/");
    const isLast = i === parts.length - 1;
    const prefixIsDir = isLast ? isDir !== false : true;

    let matched: Rule | null = null;
    for (const rule of rules) {
      if (rule.dirOnly && !prefixIsDir) continue;
      if (rule.regex.test(prefix)) matched = rule;
    }
    if (!matched) continue;

    if (matched.negated) {
      // Hiding an ancestor directory hides everything below it.
      if (!isLast) return "excluded";
      state = "excluded";
    } else {
      state = "shown";
    }
  }
  return state;
}

export function isShownByRules(rules: Rule[], path: string, isDir?: boolean): boolean {
  return matchPath(rules, path, isDir) === "shown";
}
