import { describe, expect, it } from "vitest";

import { diagramLinktexts, mermaidBlocks } from "../src/modules/mermaid-links";

describe("mermaidBlocks", () => {
  it("finds a fenced mermaid block", () => {
    const md = "text\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nmore";
    expect(mermaidBlocks(md)).toEqual(["flowchart LR\n  A --> B\n"]);
  });

  it("finds several blocks in one note", () => {
    const md = "```mermaid\nA\n```\ntext\n```mermaid\nB\n```";
    expect(mermaidBlocks(md)).toHaveLength(2);
  });

  it("ignores other code blocks", () => {
    expect(mermaidBlocks("```js\nconst a = 1\n```")).toEqual([]);
  });

  it("handles a tilde fence", () => {
    expect(mermaidBlocks("~~~mermaid\nA\n~~~")).toEqual(["A\n"]);
  });

  it("does not get stuck across repeated calls", () => {
    const md = "```mermaid\nA\n```";
    expect(mermaidBlocks(md)).toHaveLength(1);
    expect(mermaidBlocks(md)).toHaveLength(1);
  });
});

describe("diagramLinktexts", () => {
  it("collects the notes a sequence diagram points at", () => {
    const md = [
      "```mermaid",
      "sequenceDiagram",
      "  participant A as [[Admin Role]]",
      "  participant U as [[User Role]]",
      "  A->>U: assign",
      "```",
    ].join("\n");
    expect(diagramLinktexts(md).sort()).toEqual(["Admin Role", "User Role"]);
  });

  it("collects links from a flowchart", () => {
    const md = "```mermaid\nflowchart LR\n  A[[[Admin]]] --> B[[[User]]]\n```";
    expect(diagramLinktexts(md).sort()).toEqual(["Admin", "User"]);
  });

  it("returns nothing for a diagram with no wikilinks", () => {
    expect(diagramLinktexts("```mermaid\nflowchart LR\n  A --> B\n```")).toEqual([]);
  });

  it("still collects links from a diagram type we do not parse", () => {
    // classDiagram has no parser, but its wikilinks should still reach the graph.
    const md = "```mermaid\nclassDiagram\n  class [[Admin Role]]\n```";
    expect(diagramLinktexts(md)).toContain("Admin Role");
  });

  it("ignores wikilinks outside a mermaid block", () => {
    expect(diagramLinktexts("A normal [[Link]] in prose.")).toEqual([]);
  });
});
