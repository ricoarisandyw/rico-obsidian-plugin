import { describe, expect, it } from "vitest";

import { detectType, parseDiagram } from "../src/modules/mermaid-links/parse";

const linktexts = (src: string) => parseDiagram(src).links.map((l) => l.linktext).sort();
const edges = (src: string) =>
  parseDiagram(src)
    .edges.map((e) => `${e.from}->${e.to}`)
    .sort();

describe("detectType", () => {
  it("finds sequenceDiagram", () => {
    expect(detectType("sequenceDiagram\n  A->>B: x")).toBe("sequence");
  });

  it("finds flowchart and the older graph keyword", () => {
    expect(detectType("flowchart LR\n  A-->B")).toBe("flowchart");
    expect(detectType("graph TD\n  A-->B")).toBe("flowchart");
  });

  it("skips blank lines and comments before the header", () => {
    expect(detectType("\n%% a note\nsequenceDiagram\n  A->>B: x")).toBe("sequence");
  });

  it("returns null for a type we do not handle", () => {
    expect(detectType("classDiagram\n  class A")).toBeNull();
  });
});

describe("parseDiagram — sequenceDiagram", () => {
  const SRC = [
    "sequenceDiagram",
    "  participant A as [[Admin Role]]",
    "  actor U as [[User Role]]",
    "  A->>U: assign role",
    "  U-->>A: confirm",
  ].join("\n");

  it("collects the notes the participants were declared with", () => {
    expect(linktexts(SRC)).toEqual(["Admin Role", "User Role"]);
  });

  it("recovers the relation in both directions", () => {
    expect(edges(SRC)).toEqual(["Admin Role->User Role", "User Role->Admin Role"]);
  });

  it("handles a participant declared without an alias", () => {
    const src = "sequenceDiagram\n  participant [[Admin]]\n  participant [[User]]\n  Admin->>User: x";
    expect(linktexts(src)).toEqual(["Admin", "User"]);
  });

  it("ignores the message text after the colon", () => {
    const src = [
      "sequenceDiagram",
      "  participant A as [[Admin]]",
      "  participant U as [[User]]",
      "  A->>U: this mentions B->>C but is prose",
    ].join("\n");
    expect(edges(src)).toEqual(["Admin->User"]);
  });

  it("skips arrows whose endpoints are not linked notes", () => {
    const src = "sequenceDiagram\n  participant A as [[Admin]]\n  A->>Unknown: x";
    expect(edges(src)).toEqual([]);
  });

  it("does not create a self-edge", () => {
    const src = "sequenceDiagram\n  participant A as [[Admin]]\n  A->>A: thinking";
    expect(edges(src)).toEqual([]);
  });

  it("understands the other arrow kinds", () => {
    const src = [
      "sequenceDiagram",
      "  participant A as [[Admin]]",
      "  participant U as [[User]]",
      "  A-xU: fail",
      "  A-)U: async",
    ].join("\n");
    expect(edges(src)).toEqual(["Admin->User"]);
  });

  it("ignores a commented-out arrow", () => {
    const src = [
      "sequenceDiagram",
      "  participant A as [[Admin]]",
      "  participant U as [[User]]",
      "  %% A->>U: disabled",
    ].join("\n");
    expect(edges(src)).toEqual([]);
  });
});

describe("parseDiagram — flowchart", () => {
  it("reads a wikilink out of each node shape", () => {
    const src = [
      "flowchart LR",
      "  A[[[Admin]]] --> B([[[User]]])",
      "  C{[[Decision]]} --> D(([[Round]]))",
    ].join("\n");
    expect(linktexts(src)).toEqual(["Admin", "Decision", "Round", "User"]);
  });

  it("recovers an edge between two linked nodes", () => {
    const src = "flowchart LR\n  A[[[Admin]]] --> B[[[User]]]";
    expect(edges(src)).toEqual(["Admin->User"]);
  });

  it("follows a chain of arrows", () => {
    const src = "flowchart LR\n  A[[[One]]] --> B[[[Two]]] --> C[[[Three]]]";
    expect(edges(src)).toEqual(["One->Two", "Two->Three"]);
  });

  it("ignores an edge label", () => {
    const src = "flowchart LR\n  A[[[Admin]]] -->|assigns| B[[[User]]]";
    expect(edges(src)).toEqual(["Admin->User"]);
  });

  it("handles a node declared on its own line and used later", () => {
    const src = [
      "flowchart LR",
      "  A[[[Admin]]]",
      "  B[[[User]]]",
      "  A --> B",
    ].join("\n");
    expect(edges(src)).toEqual(["Admin->User"]);
  });

  it("understands dotted and thick arrows", () => {
    const src = [
      "flowchart LR",
      "  A[[[One]]] -.-> B[[[Two]]]",
      "  B ==> C[[[Three]]]",
    ].join("\n");
    expect(edges(src)).toEqual(["One->Two", "Two->Three"]);
  });

  it("finds nodes inside a subgraph", () => {
    const src = [
      "flowchart LR",
      "  subgraph Roles",
      "    A[[[Admin]]] --> B[[[User]]]",
      "  end",
    ].join("\n");
    expect(edges(src)).toEqual(["Admin->User"]);
  });

  it("does not treat a plain subroutine shape as a link", () => {
    const src = "flowchart LR\n  A[[Sub]] --> B[[[User]]]";
    expect(linktexts(src)).toEqual(["User"]);
    expect(edges(src)).toEqual([]);
  });

  it("dedupes a relation drawn twice", () => {
    const src = [
      "flowchart LR",
      "  A[[[Admin]]] --> B[[[User]]]",
      "  A --> B",
    ].join("\n");
    expect(edges(src)).toEqual(["Admin->User"]);
  });
});

describe("parseDiagram — unsupported types", () => {
  it("returns nothing rather than guessing", () => {
    const src = "classDiagram\n  class Admin\n  Admin --|> [[User]]";
    expect(parseDiagram(src)).toEqual({ links: [], edges: [] });
  });
});
