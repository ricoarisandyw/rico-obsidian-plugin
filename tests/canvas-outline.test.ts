import { describe, it, expect, vi } from "vitest";
import { buildOutline, countItems, filterOutline, itemMarkdown, MAX_NODE_LINES, OutlineItem, outlineToMarkdown } from "../src/modules/canvas/outline/logic";
import { dataSignature, focusCanvasNode, readCanvasData } from "../src/modules/canvas/outline/data";

const text = (id: string, t: string, x: number, y: number) => ({
  id, type: "text", text: t, x, y, width: 100, height: 50,
});
const group = (id: string, label: string, x: number, y: number, w: number, h: number) => ({
  id, type: "group", label, x, y, width: w, height: h,
});
const edge = (id: string, fromNode: string, toNode: string, extra = {}) => ({ id, fromNode, toNode, ...extra });

const labels = (items: OutlineItem[]): string[] => items.map((i) => i.label);

describe("buildOutline", () => {
  it("returns an empty outline for an empty canvas", () => {
    expect(buildOutline({ nodes: [], edges: [] })).toEqual([]);
  });

  it("labels and types each kind of node", () => {
    const out = buildOutline({
      nodes: [
        text("t", "# Title\nbody", 0, 0),
        { id: "f", type: "file", file: "notes/Plan.md", x: 0, y: 100, width: 100, height: 50 },
        { id: "l", type: "link", url: "https://example.com", x: 0, y: 200, width: 100, height: 50 },
        group("g", "Docs", 500, 500, 100, 100),
      ],
      edges: [],
    });
    expect(labels(out)).toEqual(["Title", "Plan.md", "https://example.com", "Docs"]);
    expect(out.map((i) => i.type)).toEqual(["text", "file", "link", "group"]);
  });

  it("orders siblings top to bottom, then left to right", () => {
    const out = buildOutline({
      nodes: [text("c", "C", 200, 0), text("b", "B", 0, 100), text("a", "A", 0, 0)],
      edges: [],
    });
    expect(labels(out)).toEqual(["A", "C", "B"]);
  });

  it("nests nodes under the group that holds them, and keeps outsiders at the top", () => {
    const out = buildOutline({
      nodes: [
        group("g", "Group", 0, 0, 400, 400),
        text("in1", "Inside 1", 20, 20),
        text("in2", "Inside 2", 200, 20),
        text("out", "Outside", 900, 900),
      ],
      edges: [],
    });
    expect(labels(out)).toEqual(["Group", "Outside"]);
    expect(labels(out[0].children)).toEqual(["Inside 1", "Inside 2"]);
  });

  it("nests a group inside a larger group and uses the smallest holder", () => {
    const out = buildOutline({
      nodes: [
        group("big", "Big", 0, 0, 1000, 1000),
        group("small", "Small", 100, 100, 300, 300),
        text("n", "Note", 150, 150),
      ],
      edges: [],
    });
    expect(labels(out)).toEqual(["Big"]);
    expect(labels(out[0].children)).toEqual(["Small"]);
    expect(labels(out[0].children[0].children)).toEqual(["Note"]);
  });

  const relationsOf = (out: OutlineItem[], id: string) =>
    out.flatMap(function walk(i: OutlineItem): OutlineItem[] {
      return [i, ...i.children.flatMap(walk)];
    }).find((i) => i.id === id)!.relations.map((r) => `${r.arrow} ${r.label}`);

  it("lists an arrow A -> B as '→ B' on A and '← A' on B, without nesting", () => {
    const out = buildOutline({
      nodes: [text("a", "A", 0, 0), text("b", "B", 200, 0), text("c", "C", 400, 0)],
      edges: [edge("e1", "a", "b"), edge("e2", "b", "c")],
    });
    expect(labels(out)).toEqual(["A", "B", "C"]);
    expect(relationsOf(out, "a")).toEqual(["→ B"]);
    expect(relationsOf(out, "b")).toEqual(["→ C", "← A"]);
    expect(relationsOf(out, "c")).toEqual(["← B"]);
  });

  it("follows the arrow when only the source end has an arrowhead", () => {
    const out = buildOutline({
      nodes: [text("a", "A", 0, 0), text("b", "B", 200, 0)],
      edges: [edge("e", "a", "b", { fromEnd: "arrow", toEnd: "none" })],
    });
    expect(relationsOf(out, "a")).toEqual(["← B"]);
    expect(relationsOf(out, "b")).toEqual(["→ A"]);
  });

  it("marks two-way and arrowless edges", () => {
    const out = buildOutline({
      nodes: [text("a", "A", 0, 0), text("b", "B", 200, 0), text("c", "C", 400, 0)],
      edges: [edge("e1", "a", "b", { fromEnd: "arrow", toEnd: "arrow" }), edge("e2", "b", "c", { toEnd: "none" })],
    });
    expect(relationsOf(out, "a")).toEqual(["↔ B"]);
    expect(relationsOf(out, "b")).toEqual(["↔ A", "— C"]);
  });

  it("keeps every relation of a loop (A -> B -> C -> A)", () => {
    const out = buildOutline({
      nodes: [text("a", "A", 0, 0), text("b", "B", 200, 0), text("c", "C", 400, 0)],
      edges: [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "a")],
    });
    expect(countItems(out)).toBe(3);
    expect(relationsOf(out, "a")).toEqual(["→ B", "← C"]);
    expect(relationsOf(out, "b")).toEqual(["→ C", "← A"]);
    expect(relationsOf(out, "c")).toEqual(["→ A", "← B"]);
  });

  it("keeps edges that cross a group boundary or touch a group, and drops edges to nothing", () => {
    const out = buildOutline({
      nodes: [
        group("g", "Group", 0, 0, 300, 300),
        text("in", "Inside", 20, 20),
        text("out", "Outside", 900, 0),
      ],
      edges: [edge("e1", "in", "out"), edge("e2", "out", "g"), edge("e3", "out", "missing")],
    });
    expect(labels(out)).toEqual(["Group", "Outside"]);
    expect(labels(out[0].children)).toEqual(["Inside"]);
    expect(relationsOf(out, "in")).toEqual(["→ Outside"]);
    expect(relationsOf(out, "out")).toEqual(["→ Group", "← Inside"]);
    expect(relationsOf(out, "g")).toEqual(["← Outside"]);
  });

  it("keeps the label written on an arrow, and handles an arrow to itself", () => {
    const out = buildOutline({
      nodes: [text("a", "A", 0, 0), text("b", "B", 200, 0)],
      edges: [edge("e1", "a", "b", { label: "depends on" }), edge("e2", "a", "a")],
    });
    expect(out[0].relations).toEqual([
      { id: "b", label: "B", arrow: "→", edgeLabel: "depends on" },
      { id: "a", label: "A", arrow: "↔", edgeLabel: undefined },
    ]);
  });

  it("tolerates a canvas without edges", () => {
    const out = buildOutline({ nodes: [text("a", "A", 0, 0)], edges: undefined as any });
    expect(labels(out)).toEqual(["A"]);
  });
});

describe("filterOutline", () => {
  const tree = buildOutline({
    nodes: [
      group("g", "Plans", 0, 0, 400, 400),
      text("a", "Alpha", 20, 20),
      text("b", "Beta", 200, 20),
      text("c", "Gamma", 900, 900),
    ],
    edges: [],
  });

  it("returns everything for an empty query", () => {
    expect(filterOutline(tree, "  ")).toBe(tree);
  });

  it("keeps a matching node with its ancestors only", () => {
    const out = filterOutline(tree, "alp");
    expect(labels(out)).toEqual(["Plans"]);
    expect(labels(out[0].children)).toEqual(["Alpha"]);
  });

  it("keeps all children of a matching group", () => {
    const out = filterOutline(tree, "plans");
    expect(labels(out[0].children)).toEqual(["Alpha", "Beta"]);
  });

  it("returns nothing when no label matches", () => {
    expect(filterOutline(tree, "zzz")).toEqual([]);
  });
});

describe("filterOutline on node content", () => {
  it("matches words in the node text, not just the first line", () => {
    const tree = buildOutline({ nodes: [text("a", "Title\nsecret body", 0, 0), text("b", "Other", 0, 100)], edges: [] });
    expect(labels(filterOutline(tree, "secret"))).toEqual(["Title"]);
  });
});

describe("itemMarkdown", () => {
  const SEP = "\n\n---";
  const one = (node: any, depth = 0) => itemMarkdown(buildOutline({ nodes: [node], edges: [] })[0], depth);

  it("turns a group into a heading, one level deeper per surrounding group, without a divider", () => {
    const g = group("g", "Docs", 0, 0, 100, 100);
    expect(one(g, 0)).toBe("# Docs");
    expect(one(g, 2)).toBe("### Docs");
    expect(one(g, 9)).toBe("###### Docs");
  });

  it("shows the whole text of a text node and ends it with a divider", () => {
    expect(one(text("t", "line 1\nline 2", 0, 0))).toBe(`line 1\nline 2${SEP}`);
  });

  it("pushes headings inside a node below the group heading, but not inside code", () => {
    const md = one(text("t", "# Title\n```\n# not a heading\n```\n## Sub", 0, 0), 1);
    expect(md).toBe(`## Title\n\`\`\`\n# not a heading\n\`\`\`\n### Sub${SEP}`);
  });

  it("cuts very long text", () => {
    const long = Array.from({ length: MAX_NODE_LINES + 5 }, (_, i) => `l${i}`).join("\n");
    const lines = one(text("t", long, 0, 0)).replace(SEP, "").split("\n");
    expect(lines).toHaveLength(MAX_NODE_LINES + 1);
    expect(lines[lines.length - 1]).toBe("…");
  });

  it("links files with [[ ]] and web links with markdown links", () => {
    expect(one({ id: "f", type: "file", file: "notes/Plan.md", x: 0, y: 0, width: 1, height: 1 })).toBe(`[[notes/Plan|Plan]]${SEP}`);
    expect(one({ id: "f", type: "file", file: "img/pic.png", x: 0, y: 0, width: 1, height: 1 })).toBe(`[[img/pic.png|pic.png]]${SEP}`);
    expect(one({ id: "l", type: "link", url: "https://example.com", x: 0, y: 0, width: 1, height: 1 })).toBe(
      `[https://example.com](https://example.com)${SEP}`,
    );
  });

  it("skips empty nodes that have no relations", () => {
    expect(one(text("t", "   ", 0, 0))).toBe("");
    expect(one({ id: "f", type: "file", x: 0, y: 0, width: 1, height: 1 })).toBe("");
  });

  it("writes every relation as a bullet list before the divider", () => {
    const out = buildOutline({
      nodes: [text("a", "A\nmore", 0, 0), text("b", "B", 200, 0), text("c", "Solo", 0, 500)],
      edges: [edge("e", "a", "b", { label: "next" })],
    });
    expect(itemMarkdown(out.find((i) => i.id === "a")!, 0)).toBe(`A\nmore\n\n- → B _(next)_${SEP}`);
    expect(itemMarkdown(out.find((i) => i.id === "b")!, 0)).toBe(`B\n\n- ← A _(next)_${SEP}`);
    expect(itemMarkdown(out.find((i) => i.id === "c")!, 0)).toBe(`Solo${SEP}`);
  });

  it("can leave out relations and divider so the panel draws them as links", () => {
    const out = buildOutline({ nodes: [text("a", "A", 0, 0), text("b", "B", 200, 0)], edges: [edge("e", "a", "b")] });
    expect(itemMarkdown(out[0], 0, false)).toBe("A");
    expect(itemMarkdown(buildOutline({ nodes: [group("g", "G", 0, 0, 10, 10)], edges: [] })[0], 0, false)).toBe("# G");
  });

  it("still shows an empty node when arrows connect to it", () => {
    const out = buildOutline({ nodes: [text("a", "", 0, 0), text("b", "B", 200, 0)], edges: [edge("e", "a", "b")] });
    expect(itemMarkdown(out[0], 0)).toBe(`_Empty node_\n\n- → B${SEP}`);
  });
});

describe("outlineToMarkdown", () => {
  const out = buildOutline({
    nodes: [group("g", "Plans", 0, 0, 600, 300), text("a", "# Alpha", 20, 20), text("b", "Beta", 300, 20)],
    edges: [edge("e", "a", "b")],
  });

  it("writes groups as headings and every node with its relations and divider", () => {
    expect(outlineToMarkdown(out)).toBe(
      ["# Plans", "## Alpha\n\n- → Beta\n\n---", "Beta\n\n- ← Alpha\n\n---"].join("\n\n"),
    );
  });

  it("puts the title first as an H1 with a divider, and moves everything one level down", () => {
    expect(outlineToMarkdown(out, "My Canvas")).toBe(
      ["# My Canvas", "---", "## Plans", "### Alpha\n\n- → Beta\n\n---", "Beta\n\n- ← Alpha\n\n---"].join("\n\n"),
    );
  });
});

describe("reading a canvas is read-only", () => {
  const nodes = [text("a", "A", 0, 0)];

  it("reads live data and never calls a write method", async () => {
    const canvas = {
      getData: vi.fn(() => ({ nodes, edges: [] })),
      importData: vi.fn(),
      requestSave: vi.fn(),
      setData: vi.fn(),
    };
    const leaf: any = { view: { canvas, file: { path: "x.canvas" } } };
    const app: any = { vault: { cachedRead: vi.fn() } };

    const data = await readCanvasData(app, leaf);
    expect(data?.nodes).toEqual(nodes);
    expect(app.vault.cachedRead).not.toHaveBeenCalled();
    expect(canvas.importData).not.toHaveBeenCalled();
    expect(canvas.requestSave).not.toHaveBeenCalled();
    expect(canvas.setData).not.toHaveBeenCalled();
  });

  it("falls back to the .canvas file and survives broken JSON", async () => {
    const leaf: any = { view: { file: { path: "x.canvas" } } };
    const good: any = { vault: { cachedRead: async () => JSON.stringify({ nodes }) } };
    expect((await readCanvasData(good, leaf))?.nodes).toEqual(nodes);
    expect((await readCanvasData(good, leaf))?.edges).toEqual([]);

    const bad: any = { vault: { cachedRead: async () => "{ nope" } };
    expect(await readCanvasData(bad, leaf)).toBeNull();
  });

  it("changes the signature only when nodes or edges change", () => {
    const a = dataSignature({ nodes, edges: [] });
    expect(dataSignature({ nodes: [...nodes], edges: [] })).toBe(a);
    expect(dataSignature({ nodes: [{ ...nodes[0], x: 5 }], edges: [] })).not.toBe(a);
  });

  it("focusing a node selects and zooms without writing", () => {
    const node = { id: "a" };
    const canvas = {
      nodes: new Map([["a", node]]),
      selectOnly: vi.fn(),
      zoomToSelection: vi.fn(),
      importData: vi.fn(),
      requestSave: vi.fn(),
    };
    const leaf: any = { view: { canvas } };
    const app: any = { workspace: { setActiveLeaf: vi.fn() } };

    expect(focusCanvasNode(app, leaf, "a")).toBe(true);
    expect(canvas.selectOnly).toHaveBeenCalledWith(node);
    expect(canvas.zoomToSelection).toHaveBeenCalled();
    expect(canvas.importData).not.toHaveBeenCalled();
    expect(canvas.requestSave).not.toHaveBeenCalled();
    expect(focusCanvasNode(app, leaf, "missing")).toBe(false);
  });
});
