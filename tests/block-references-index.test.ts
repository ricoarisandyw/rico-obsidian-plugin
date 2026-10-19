import { describe, it, expect } from "vitest";
import {
  BlockInfo,
  BlockRef,
  blockKey,
  filterRows,
  parseBlockLink,
  snippetFor,
  summarize,
  tidySnippet,
  totalCitations,
} from "../src/modules/block-reference/references";

const block = (path: string, id: string, line = 0, snippet = "text"): BlockInfo => ({ path, id, line, snippet });
const existing = (...blocks: BlockInfo[]) => new Set(blocks.map((b) => blockKey(b.path, b.id)));

describe("parseBlockLink", () => {
  it("splits a note and a block id", () => {
    expect(parseBlockLink("Smith 2024#^abc123")).toEqual({ path: "Smith 2024", id: "abc123" });
    expect(parseBlockLink("folder/Note#^a-b-1")).toEqual({ path: "folder/Note", id: "a-b-1" });
  });

  it("reads a link inside the same note as an empty path", () => {
    expect(parseBlockLink("#^abc")).toEqual({ path: "", id: "abc" });
  });

  it("ignores heading links, plain links and bad ids", () => {
    expect(parseBlockLink("Note#Heading")).toBeNull();
    expect(parseBlockLink("Note")).toBeNull();
    expect(parseBlockLink("Note#^bad id")).toBeNull();
  });
});

describe("snippets", () => {
  it("drops the id from the end of the block", () => {
    const content = "Intro\n\nCited text here. ^abc\n\nNext";
    const start = content.indexOf("Cited");
    expect(snippetFor(content, start, content.indexOf("\n\nNext"), "abc")).toBe("Cited text here.");
  });

  it("uses the block above when the id is alone on its line", () => {
    const content = "Intro\n\n> a quote\n> over two lines\n\n^q1\n\nNext";
    const start = content.indexOf("^q1");
    expect(snippetFor(content, start, start + 3, "q1")).toBe("a quote over two lines");
  });

  it("is not thrown off by regex characters in the id", () => {
    expect(snippetFor("Text ^a-b", 0, 9, "a-b")).toBe("Text");
  });

  it("removes list bullets and quote marks, collapses whitespace, and shortens", () => {
    expect(tidySnippet("- [ ] do   the\n  thing")).toBe("do the thing");
    expect(tidySnippet("> one\n> two")).toBe("one two");
    const long = tidySnippet("word ".repeat(100));
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("summarize", () => {
  const a = block("A.md", "one", 2);
  const b = block("A.md", "two", 9);
  const c = block("B.md", "three", 0);
  const all = existing(a, b, c);

  it("counts who cites each block, most first", () => {
    const refs: BlockRef[] = [
      { source: "X.md", target: "A.md", id: "one" },
      { source: "Y.md", target: "A.md", id: "one" },
      { source: "Y.md", target: "A.md", id: "one" },
    ];
    const { rows } = summarize([a, b], refs, all);
    expect(rows[0].cited).toEqual([
      { source: "Y.md", count: 2 },
      { source: "X.md", count: 1 },
    ]);
    expect(totalCitations(rows[0])).toBe(3);
    expect(rows[1].cited).toEqual([]);
  });

  it("matches ids regardless of case", () => {
    const refs: BlockRef[] = [{ source: "X.md", target: "A.md", id: "ONE" }];
    const { rows, broken } = summarize([a], refs, all);
    expect(rows[0].cited).toEqual([{ source: "X.md", count: 1 }]);
    expect(broken).toEqual([]);
  });

  it("orders blocks by note, then line", () => {
    const { rows } = summarize([c, b, a], [], all);
    expect(rows.map((r) => r.id)).toEqual(["one", "two", "three"]);
  });

  it("reports links whose block does not exist, once per source", () => {
    const refs: BlockRef[] = [
      { source: "X.md", target: "A.md", id: "gone" },
      { source: "X.md", target: "A.md", id: "gone" },
      { source: "Y.md", target: "A.md", id: "gone" },
    ];
    const { broken } = summarize([a], refs, all);
    expect(broken).toEqual([
      { source: "X.md", target: "A.md", id: "gone", count: 2 },
      { source: "Y.md", target: "A.md", id: "gone", count: 1 },
    ]);
  });

  it("does not call a link broken just because its block is not being listed", () => {
    const refs: BlockRef[] = [{ source: "A.md", target: "B.md", id: "three" }];
    const { broken } = summarize([a], refs, all);
    expect(broken).toEqual([]);
  });
});

describe("filterRows", () => {
  const rows = summarize(
    [block("Notes/Smith.md", "rag1", 0, "Retrieval cuts hallucination"), block("Notes/Lee.md", "x9", 0, "Other topic")],
    [{ source: "Z.md", target: "Notes/Smith.md", id: "rag1" }],
    new Set([blockKey("Notes/Smith.md", "rag1"), blockKey("Notes/Lee.md", "x9")])
  ).rows;

  it("matches every typed word against id, text and path", () => {
    expect(filterRows(rows, "retrieval smith", false).map((r) => r.id)).toEqual(["rag1"]);
    expect(filterRows(rows, "x9", false).map((r) => r.id)).toEqual(["x9"]);
    expect(filterRows(rows, "retrieval lee", false)).toEqual([]);
  });

  it("can keep only blocks nobody cites", () => {
    expect(filterRows(rows, "", true).map((r) => r.id)).toEqual(["x9"]);
  });

  it("returns everything for an empty query", () => {
    expect(filterRows(rows, "  ", false)).toHaveLength(2);
  });
});
