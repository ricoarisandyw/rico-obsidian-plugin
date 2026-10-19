import { describe, it, expect } from "vitest";
import { isShownByRules, matchPath, parseRules } from "../src/shared/utils/ignore-rules";
import { parseExtensions } from "../src/shared/utils/extensions";
import {
  DEFAULT_SETTINGS,
  DEFAULT_VISIBILITY_RULES,
  normalizeSettings,
} from "../src/types";

describe("parseRules / isShownByRules", () => {
  const defaults = parseRules(DEFAULT_VISIBILITY_RULES);

  it("default rules show .obsidian and .trash, hide node_modules and .git", () => {
    expect(isShownByRules(defaults, ".obsidian", true)).toBe(true);
    expect(isShownByRules(defaults, ".obsidian/app.json")).toBe(true);
    expect(isShownByRules(defaults, ".trash/a/b.md")).toBe(true);
    expect(isShownByRules(defaults, ".obsidian/plugins/x/node_modules", true)).toBe(false);
    expect(isShownByRules(defaults, ".obsidian/plugins/x/node_modules/pkg/index.js")).toBe(false);
    expect(isShownByRules(defaults, ".git/HEAD")).toBe(false);
    expect(isShownByRules(defaults, "notes/readme.md")).toBe(false);
  });

  it("ignores comments and blank lines", () => {
    const rules = parseRules("# hello\n\n   \n.cache/\n");
    expect(rules).toHaveLength(1);
    expect(isShownByRules(rules, ".cache/a.txt")).toBe(true);
  });

  it("supports wildcards and a negation that wins when it comes last", () => {
    const rules = parseRules("*.log\n!keep.log");
    expect(isShownByRules(rules, "a/b/debug.log", false)).toBe(true);
    expect(isShownByRules(rules, "a/keep.log", false)).toBe(false);
    expect(isShownByRules(rules, "a/note.md", false)).toBe(false);
  });

  it("directory-only rules do not match files but still match unknown paths", () => {
    const rules = parseRules("build/");
    expect(isShownByRules(rules, "build", false)).toBe(false);
    expect(isShownByRules(rules, "build", true)).toBe(true);
    expect(isShownByRules(rules, "build")).toBe(true);
    expect(isShownByRules(rules, "build/out.js", false)).toBe(true);
  });

  it("supports ** at any depth and anchored paths", () => {
    const deep = parseRules("**/dist/");
    expect(isShownByRules(deep, "dist", true)).toBe(true);
    expect(isShownByRules(deep, "a/b/dist/x.js", false)).toBe(true);

    const anchored = parseRules("/.config");
    expect(isShownByRules(anchored, ".config/a", false)).toBe(true);
    expect(isShownByRules(anchored, "sub/.config/a", false)).toBe(false);

    const nested = parseRules(".obsidian/plugins");
    expect(isShownByRules(nested, ".obsidian/plugins/x/main.js", false)).toBe(true);
    expect(isShownByRules(nested, "other/.obsidian/plugins", true)).toBe(false);
  });

  it("an excluded parent cannot be re-shown from inside", () => {
    const rules = parseRules("!vendor/\nvendor/keep.txt");
    expect(matchPath(rules, "vendor", true)).toBe("excluded");
    expect(matchPath(rules, "vendor/keep.txt", false)).toBe("excluded");
  });

  it("empty rules show nothing", () => {
    expect(parseRules("")).toEqual([]);
    expect(isShownByRules([], ".obsidian", true)).toBe(false);
  });
});

describe("parseExtensions", () => {
  it("cleans dots, wildcards, case, separators and duplicates", () => {
    expect(parseExtensions("html, .JS ; *.ts  ts\npy")).toEqual(["html", "js", "ts", "py"]);
  });

  it("drops invalid tokens and handles empty input", () => {
    expect(parseExtensions("")).toEqual([]);
    expect(parseExtensions("a/b, ok, !!")).toEqual(["ok"]);
  });
});

describe("normalizeSettings", () => {
  it("fills defaults and drops removed keys such as enableFlexView", () => {
    const result = normalizeSettings({ enableFlexView: true, enableTypingGame: false, bogus: 1 }) as any;
    expect(result.enableTypingGame).toBe(false);
    expect(result.enableFlexView).toBeUndefined();
    expect(result.bogus).toBeUndefined();
    expect(result.visibilityRules).toBe(DEFAULT_SETTINGS.visibilityRules);
    expect(result.visibleExtensions).toBe(DEFAULT_SETTINGS.visibleExtensions);
  });

  it("ignores values with the wrong type and non-object input", () => {
    expect(normalizeSettings({ visibleExtensions: 5 }).visibleExtensions).toBe(
      DEFAULT_SETTINGS.visibleExtensions
    );
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
});
