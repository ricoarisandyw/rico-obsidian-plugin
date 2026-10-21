import { describe, expect, it } from "vitest";
import {
  dot,
  isExcluded,
  normalize,
  parseExcludeFilter,
  search,
  type IndexEntry,
} from "../src/modules/semantic-search/search";
import { isAlwaysExcluded } from "../src/modules/semantic-search/sync";
import { MODELS, getModel } from "../src/modules/semantic-search/model-registry";

function entry(path: string, vec: number[], mtime = 1): IndexEntry {
  return { path, mtime, vec: normalize(vec) };
}

describe("normalize", () => {
  it("scales a vector to length 1", () => {
    const result = normalize([3, 4]);
    expect(dot(result, result)).toBeCloseTo(1, 10);
  });

  it("returns a zero vector untouched instead of dividing by zero", () => {
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("does not mutate its input", () => {
    const input = [3, 4];
    normalize(input);
    expect(input).toEqual([3, 4]);
  });
});

describe("dot", () => {
  it("scores identical unit vectors as 1", () => {
    const a = normalize([1, 2, 3]);
    expect(dot(a, a)).toBeCloseTo(1, 10);
  });

  it("scores opposite unit vectors as -1", () => {
    const a = normalize([1, 2, 3]);
    const b = normalize([-1, -2, -3]);
    expect(dot(a, b)).toBeCloseTo(-1, 10);
  });

  it("scores perpendicular vectors as 0", () => {
    expect(dot(normalize([1, 0]), normalize([0, 1]))).toBeCloseTo(0, 10);
  });
});

describe("parseExcludeFilter", () => {
  it("splits on commas and trims", () => {
    expect(parseExcludeFilter(" Archive/ , Daily/ ")).toEqual(["Archive/", "Daily/"]);
  });

  it("drops empty fragments", () => {
    expect(parseExcludeFilter("a,,  ,b")).toEqual(["a", "b"]);
  });

  it("handles undefined", () => {
    expect(parseExcludeFilter(undefined)).toEqual([]);
  });
});

describe("isExcluded", () => {
  it("matches on a substring", () => {
    expect(isExcluded("Archive/2024/note.md", ["Archive/"])).toBe(true);
  });

  it("is case sensitive", () => {
    expect(isExcluded("archive/note.md", ["Archive/"])).toBe(false);
  });
});

describe("search", () => {
  const target = normalize([1, 0, 0]);
  const entries = [
    entry("same.md", [1, 0, 0]),
    entry("close.md", [0.9, 0.1, 0]),
    entry("far.md", [0, 1, 0]),
    entry("opposite.md", [-1, 0, 0]),
  ];

  it("never returns the target itself", () => {
    const results = search("same.md", target, entries, { minScore: -1 });
    expect(results.map((r) => r.path)).not.toContain("same.md");
  });

  it("sorts best first", () => {
    const results = search("target.md", target, entries, { minScore: -1 });
    const scores = results.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(results[0].path).toBe("same.md");
  });

  it("respects the limit", () => {
    expect(search("target.md", target, entries, { limit: 2, minScore: -1 })).toHaveLength(2);
  });

  it("skips vectors of a different length", () => {
    const mixed = [...entries, { path: "other-model.md", mtime: 1, vec: [1, 0] }];
    const results = search("target.md", target, mixed, { minScore: -1 });
    expect(results.map((r) => r.path)).not.toContain("other-model.md");
  });

  it("drops excluded paths", () => {
    const withArchive = [...entries, entry("Archive/old.md", [1, 0, 0])];
    const results = search("target.md", target, withArchive, {
      excludeFilter: "Archive/",
      minScore: -1,
    });
    expect(results.map((r) => r.path)).not.toContain("Archive/old.md");
  });

  it("applies the minimum score", () => {
    const results = search("target.md", target, entries, { minScore: 0.5 });
    expect(results.every((r) => r.score >= 0.5)).toBe(true);
    expect(results.map((r) => r.path)).not.toContain("opposite.md");
  });

  it("returns an empty list for an empty index", () => {
    expect(search("target.md", target, [])).toEqual([]);
  });

  it("returns an empty list when the target has no vector", () => {
    expect(search("target.md", [], entries)).toEqual([]);
  });

  it("defaults to a limit of 20", () => {
    const many = Array.from({ length: 50 }, (_, i) => entry(`n${i}.md`, [1, i / 100, 0]));
    expect(search("target.md", target, many, { minScore: -1 })).toHaveLength(20);
  });
});

describe("model registry", () => {
  it("falls back to the first model for an unknown key", () => {
    expect(getModel("does-not-exist").key).toBe(MODELS[0].key);
  });

  it("defaults to a multilingual model that handles Indonesian", () => {
    expect(MODELS[0].languages).toMatch(/Indonesian/);
  });

  it("flags E5 models as needing prefixes", () => {
    expect(getModel("multilingual-e5-small").usesE5Prefixes).toBe(true);
    expect(getModel("all-MiniLM-L6-v2").usesE5Prefixes).toBe(false);
  });

  it("gives every model a unique key", () => {
    expect(new Set(MODELS.map((m) => m.key)).size).toBe(MODELS.length);
  });
});

describe("isAlwaysExcluded", () => {
  it("excludes Obsidian's trash", () => {
    expect(isAlwaysExcluded(".trash/PLAN.md")).toBe(true);
  });

  it("excludes the config and model folders", () => {
    expect(isAlwaysExcluded(".obsidian/notes.md")).toBe(true);
    expect(isAlwaysExcluded(".models/readme.md")).toBe(true);
  });

  it("excludes a nested trash folder", () => {
    expect(isAlwaysExcluded("vault/.trash/old.md")).toBe(true);
  });

  it("leaves ordinary notes alone", () => {
    expect(isAlwaysExcluded("Projects/plan.md")).toBe(false);
  });

  it("does not match a similarly named real folder", () => {
    expect(isAlwaysExcluded("trash/note.md")).toBe(false);
  });
});
