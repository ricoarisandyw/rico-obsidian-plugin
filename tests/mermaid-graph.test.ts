import { beforeEach, describe, expect, it } from "vitest";

import { TFile } from "./mocks/obsidian";
import { MermaidGraphIndex } from "../src/modules/mermaid-links/graph";

/** An app whose vault contains exactly `files`, resolved by basename. */
function makeApp(files: string[]) {
  const byName = new Map(files.map((p) => [p.replace(/\.md$/, ""), new TFile(p)]));
  return {
    metadataCache: {
      resolvedLinks: {} as Record<string, Record<string, number>>,
      unresolvedLinks: {} as Record<string, Record<string, number>>,
      getFirstLinkpathDest: (name: string) => byName.get(name) ?? null,
    },
  } as any;
}

describe("MermaidGraphIndex", () => {
  let app: ReturnType<typeof makeApp>;
  let index: MermaidGraphIndex;

  beforeEach(() => {
    app = makeApp(["Admin Role.md", "User Role.md", "Note.md"]);
    index = new MermaidGraphIndex(app);
  });

  const resolved = () => app.metadataCache.resolvedLinks;
  const unresolved = () => app.metadataCache.unresolvedLinks;

  it("registers a link to a note that exists", () => {
    index.update("Note.md", ["Admin Role"]);
    expect(resolved()["Note.md"]).toEqual({ "Admin Role.md": 1 });
  });

  it("registers a missing note as unresolved, so graph view shows it hollow", () => {
    index.update("Note.md", ["Nope"]);
    expect(unresolved()["Note.md"]).toEqual({ Nope: 1 });
    expect(resolved()["Note.md"]).toEqual({});
  });

  it("counts a note linked twice only once", () => {
    index.update("Note.md", ["Admin Role", "Admin Role"]);
    expect(resolved()["Note.md"]).toEqual({ "Admin Role.md": 1 });
  });

  it("drops the subpath, since the graph links notes rather than headings", () => {
    index.update("Note.md", ["Admin Role#Duties"]);
    expect(resolved()["Note.md"]).toEqual({ "Admin Role.md": 1 });
  });

  it("never links a note to itself", () => {
    index.update("Note.md", ["Note"]);
    expect(resolved()["Note.md"]).toEqual({});
  });

  it("replaces previous contributions when a note is re-indexed", () => {
    index.update("Note.md", ["Admin Role"]);
    index.update("Note.md", ["User Role"]);
    expect(resolved()["Note.md"]).toEqual({ "User Role.md": 1 });
  });

  it("removes its entries on clearFor", () => {
    index.update("Note.md", ["Admin Role", "Missing"]);
    index.clearFor("Note.md");
    expect(resolved()["Note.md"]).toEqual({});
    expect(unresolved()["Note.md"]).toEqual({});
  });

  it("leaves links it did not add alone", () => {
    // A real wikilink in the note body, already indexed by Obsidian.
    resolved()["Note.md"] = { "User Role.md": 1 };
    index.update("Note.md", ["Admin Role"]);
    expect(resolved()["Note.md"]).toEqual({ "User Role.md": 1, "Admin Role.md": 1 });
    index.clearFor("Note.md");
    expect(resolved()["Note.md"]).toEqual({ "User Role.md": 1 });
  });

  it("decrements rather than deleting when a link is shared with the body", () => {
    resolved()["Note.md"] = { "Admin Role.md": 1 };
    index.update("Note.md", ["Admin Role"]);
    expect(resolved()["Note.md"]["Admin Role.md"]).toBe(2);
    index.clearFor("Note.md");
    expect(resolved()["Note.md"]["Admin Role.md"]).toBe(1);
  });

  it("clearAll removes every note's contribution", () => {
    index.update("A.md", ["Admin Role"]);
    index.update("B.md", ["User Role"]);
    index.clearAll();
    expect(resolved()["A.md"]).toEqual({});
    expect(resolved()["B.md"]).toEqual({});
    expect(index.trackedPaths()).toEqual([]);
  });

  it("stops tracking a note once its diagram has no links", () => {
    index.update("Note.md", ["Admin Role"]);
    index.update("Note.md", []);
    expect(resolved()["Note.md"]).toEqual({});
    expect(index.trackedPaths()).toEqual([]);
  });

  it("does nothing when the link index is missing", () => {
    const bare = new MermaidGraphIndex({ metadataCache: undefined } as any);
    expect(() => bare.update("Note.md", ["Admin Role"])).not.toThrow();
  });
});
