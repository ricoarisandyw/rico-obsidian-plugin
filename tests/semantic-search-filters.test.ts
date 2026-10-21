import { describe, expect, it } from "vitest";
import {
  countActiveFilters,
  emptyFilters,
  matchesFrontmatter,
  parseExactQuery,
  parseList,
  passesFilters,
  scoreParsedQuery,
} from "../src/modules/semantic-search/filters";
import { formatDate, parseDate } from "../src/modules/semantic-search/filter-panel";

describe("parseList", () => {
  it("splits and trims", () => {
    expect(parseList(" a , b ")).toEqual(["a", "b"]);
  });

  it("drops empties and handles null", () => {
    expect(parseList("a,,  ,b")).toEqual(["a", "b"]);
    expect(parseList(null)).toEqual([]);
  });
});

describe("matchesFrontmatter", () => {
  const fm = { status: "open", Tags: ["work", "urgent"], count: 3 };

  it("matches on key presence", () => {
    expect(matchesFrontmatter("status", fm)).toBe(true);
    expect(matchesFrontmatter("missing", fm)).toBe(false);
  });

  it("matches key and value", () => {
    expect(matchesFrontmatter("status:open", fm)).toBe(true);
    expect(matchesFrontmatter("status:done", fm)).toBe(false);
  });

  it("ignores case in both key and value", () => {
    expect(matchesFrontmatter("STATUS:OPEN", fm)).toBe(true);
    expect(matchesFrontmatter("tags:WORK", fm)).toBe(true);
  });

  it("matches any element of an array value", () => {
    expect(matchesFrontmatter("tags:urgent", fm)).toBe(true);
    expect(matchesFrontmatter("tags:personal", fm)).toBe(false);
  });

  it("compares non-string values as text", () => {
    expect(matchesFrontmatter("count:3", fm)).toBe(true);
  });

  it("handles missing frontmatter", () => {
    expect(matchesFrontmatter("status", null)).toBe(false);
    expect(matchesFrontmatter("", fm)).toBe(false);
  });
});

describe("passesFilters", () => {
  const base = { path: "Projects/plan.md", kind: "md" as const, ctime: 1000, mtime: 2000 };

  it("passes everything when no filter is set", () => {
    expect(passesFilters(base, emptyFilters())).toBe(true);
  });

  it("filters by file kind", () => {
    expect(passesFilters(base, { ...emptyFilters(), kinds: ["canvas"] })).toBe(false);
    expect(passesFilters(base, { ...emptyFilters(), kinds: ["md"] })).toBe(true);
  });

  it("treats an entry without a kind as markdown", () => {
    const legacy = { path: "a.md" };
    expect(passesFilters(legacy, { ...emptyFilters(), kinds: ["md"] })).toBe(true);
  });

  it("filters by include path", () => {
    expect(passesFilters(base, { ...emptyFilters(), includePaths: ["Projects/"] })).toBe(true);
    expect(passesFilters(base, { ...emptyFilters(), includePaths: ["Archive/"] })).toBe(false);
  });

  it("lets exclude beat include", () => {
    const filters = {
      ...emptyFilters(),
      includePaths: ["Projects/"],
      excludePaths: ["plan"],
    };
    expect(passesFilters(base, filters)).toBe(false);
  });

  it("filters by created range", () => {
    expect(passesFilters(base, { ...emptyFilters(), createdAfter: 500 })).toBe(true);
    expect(passesFilters(base, { ...emptyFilters(), createdAfter: 5000 })).toBe(false);
    expect(passesFilters(base, { ...emptyFilters(), createdBefore: 500 })).toBe(false);
  });

  it("filters by updated range", () => {
    expect(passesFilters(base, { ...emptyFilters(), updatedAfter: 1500 })).toBe(true);
    expect(passesFilters(base, { ...emptyFilters(), updatedBefore: 1500 })).toBe(false);
  });

  it("fails a bounded range when the timestamp is missing", () => {
    const noTime = { path: "a.md" };
    expect(passesFilters(noTime, { ...emptyFilters(), createdAfter: 1 })).toBe(false);
  });

  it("filters by frontmatter", () => {
    const candidate = { ...base, frontmatter: { status: "open" } };
    expect(
      passesFilters(candidate, { ...emptyFilters(), frontmatterInclude: ["status:open"] }),
    ).toBe(true);
    expect(
      passesFilters(candidate, { ...emptyFilters(), frontmatterExclude: ["status:open"] }),
    ).toBe(false);
  });
});

describe("countActiveFilters", () => {
  it("counts nothing when empty", () => {
    expect(countActiveFilters(emptyFilters())).toBe(0);
  });

  it("counts a date pair as one filter", () => {
    expect(
      countActiveFilters({ ...emptyFilters(), createdAfter: 1, createdBefore: 2 }),
    ).toBe(1);
  });

  it("counts each active group", () => {
    expect(
      countActiveFilters({ ...emptyFilters(), kinds: ["md"], includePaths: ["a"] }),
    ).toBe(2);
  });
});

describe("parseExactQuery", () => {
  it("splits plain words", () => {
    expect(parseExactQuery("invoice kontrak").include).toEqual(["invoice", "kontrak"]);
  });

  it("keeps a quoted phrase whole", () => {
    expect(parseExactQuery('"kontrak HVAC" invoice').include).toEqual([
      "kontrak HVAC",
      "invoice",
    ]);
  });

  it("reads a leading dash as an exclusion", () => {
    const parsed = parseExactQuery("invoice -draft");
    expect(parsed.include).toEqual(["invoice"]);
    expect(parsed.exclude).toEqual(["draft"]);
  });

  it("excludes a quoted phrase", () => {
    expect(parseExactQuery('-"work in progress"').exclude).toEqual(["work in progress"]);
  });

  it("handles empty input", () => {
    expect(parseExactQuery("")).toEqual({ include: [], exclude: [] });
    expect(parseExactQuery(null)).toEqual({ include: [], exclude: [] });
  });
});

describe("scoreParsedQuery", () => {
  const text = "ini kontrak HVAC untuk invoice bulan ini";

  it("scores all terms present as 1", () => {
    expect(scoreParsedQuery(parseExactQuery("kontrak invoice"), text)).toBe(1);
  });

  it("scores partial hits as a fraction", () => {
    expect(scoreParsedQuery(parseExactQuery("kontrak zebra"), text)).toBeCloseTo(0.5, 10);
  });

  it("returns 0 when an excluded term is present", () => {
    expect(scoreParsedQuery(parseExactQuery("kontrak -invoice"), text)).toBe(0);
  });

  it("passes when only exclusions are given and none match", () => {
    expect(scoreParsedQuery(parseExactQuery("-zebra"), text)).toBe(1);
  });

  it("matches a quoted phrase in order", () => {
    expect(scoreParsedQuery(parseExactQuery('"kontrak HVAC"'), text)).toBe(1);
    expect(scoreParsedQuery(parseExactQuery('"HVAC kontrak"'), text)).toBe(0);
  });
});

describe("date helpers", () => {
  it("round-trips a date", () => {
    const ms = parseDate("2026-01-31");
    expect(formatDate(ms)).toBe("2026-01-31");
  });

  it("returns null for blank or invalid input", () => {
    expect(parseDate("")).toBeNull();
    expect(parseDate("not-a-date")).toBeNull();
  });

  it("formats null as empty", () => {
    expect(formatDate(null)).toBe("");
  });

  it("treats the end bound as end of day", () => {
    const start = parseDate("2026-01-31") ?? 0;
    const end = parseDate("2026-01-31", true) ?? 0;
    expect(end).toBeGreaterThan(start);
  });
});
