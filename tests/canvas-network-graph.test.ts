import { describe, it, expect } from "vitest";
import {
  Graph,
  buildGraph,
  matchingIds,
  neighboursOf,
  nodeRadius,
  usedTypes,
} from "../src/modules/canvas/network-graph/logic";
import { GraphLayout, SETTLE_TICKS } from "../src/modules/canvas/network-graph/layout";

const text = (id: string, t: string) => ({ id, type: "text", text: t, x: 0, y: 0, width: 100, height: 50 });
const file = (id: string, path: string) => ({ id, type: "file", file: path, x: 0, y: 0, width: 100, height: 50 });
const edge = (id: string, fromNode: string, toNode: string, extra = {}) => ({ id, fromNode, toNode, ...extra });

const ids = (graph: Graph): string[] => graph.nodes.map((n) => n.id);
const degreeOf = (graph: Graph, id: string): number => graph.nodes.find((n) => n.id === id)!.degree;

describe("buildGraph", () => {
  it("returns an empty graph for an empty canvas", () => {
    expect(buildGraph({ nodes: [], edges: [] })).toEqual({ nodes: [], links: [] });
  });

  it("renders every node when there are no edges", () => {
    const graph = buildGraph({ nodes: [text("a", "A"), text("b", "B")], edges: [] });
    expect(ids(graph)).toEqual(["a", "b"]);
    expect(graph.links).toEqual([]);
    expect(graph.nodes.every((n) => n.degree === 0)).toBe(true);
  });

  it("labels and types each kind of node", () => {
    const graph = buildGraph({
      nodes: [
        text("t", "# Title\nbody"),
        file("f", "notes/Plan.md"),
        { id: "l", type: "link", url: "https://example.com", x: 0, y: 0, width: 1, height: 1 },
        { id: "g", type: "group", label: "Docs", x: 0, y: 0, width: 1, height: 1 },
        { id: "u", type: "mystery", x: 0, y: 0, width: 1, height: 1 },
      ],
      edges: [],
    });
    expect(graph.nodes.map((n) => n.label)).toEqual([
      "Title",
      "Plan.md",
      "https://example.com",
      "Docs",
      "mystery",
    ]);
    expect(graph.nodes.map((n) => n.type)).toEqual(["text", "file", "link", "group", "other"]);
  });

  it("drops an edge pointing at a node that no longer exists", () => {
    const graph = buildGraph({
      nodes: [text("a", "A")],
      edges: [edge("e1", "a", "ghost"), edge("e2", "ghost", "a")],
    });
    expect(graph.links).toEqual([]);
    expect(degreeOf(graph, "a")).toBe(0);
  });

  it("drops a self-loop from the links but counts it once towards degree", () => {
    const graph = buildGraph({ nodes: [text("a", "A")], edges: [edge("e", "a", "a")] });
    expect(graph.links).toEqual([]);
    expect(degreeOf(graph, "a")).toBe(1);
  });

  it("collapses duplicate edges between the same pair into one link", () => {
    const graph = buildGraph({
      nodes: [text("a", "A"), text("b", "B")],
      edges: [edge("e1", "a", "b"), edge("e2", "a", "b"), edge("e3", "b", "a")],
    });
    expect(graph.links).toHaveLength(1);
    expect(degreeOf(graph, "a")).toBe(1);
    expect(degreeOf(graph, "b")).toBe(1);
  });

  it("counts distinct neighbours as the degree", () => {
    const graph = buildGraph({
      nodes: [text("a", "A"), text("b", "B"), text("c", "C")],
      edges: [edge("e1", "a", "b"), edge("e2", "a", "c")],
    });
    expect(degreeOf(graph, "a")).toBe(2);
    expect(degreeOf(graph, "b")).toBe(1);
    expect(degreeOf(graph, "c")).toBe(1);
  });

  it("reads the arrow direction of an edge", () => {
    const pair = [text("a", "A"), text("b", "B")];
    const arrow = (extra: object): string =>
      buildGraph({ nodes: pair, edges: [edge("e", "a", "b", extra)] }).links[0].arrow;

    expect(arrow({})).toBe("→"); // Obsidian draws the end arrowhead by default
    expect(arrow({ toEnd: "none" })).toBe("—");
    expect(arrow({ fromEnd: "arrow", toEnd: "none" })).toBe("←");
    expect(arrow({ fromEnd: "arrow" })).toBe("↔");
  });

  it("merges two opposite arrows on the same pair into a double arrow", () => {
    const graph = buildGraph({
      nodes: [text("a", "A"), text("b", "B")],
      edges: [edge("e1", "a", "b"), edge("e2", "b", "a")],
    });
    expect(graph.links).toHaveLength(1);
    expect(graph.links[0].arrow).toBe("↔");
  });

  it("keeps the label written on an arrow", () => {
    const graph = buildGraph({
      nodes: [text("a", "A"), text("b", "B")],
      edges: [edge("e", "a", "b", { label: "  causes  " })],
    });
    expect(graph.links[0].label).toBe("causes");
  });
});

describe("helpers", () => {
  const graph = buildGraph({
    nodes: [text("a", "Alpha"), text("b", "Beta"), file("c", "notes/Gamma.md")],
    edges: [edge("e", "a", "b")],
  });

  it("grows the radius with the degree but levels off", () => {
    expect(nodeRadius(0)).toBeLessThan(nodeRadius(1));
    expect(nodeRadius(1)).toBeLessThan(nodeRadius(9));
    // Doubling the degree must not double the radius.
    expect(nodeRadius(16) - nodeRadius(0)).toBeLessThan(2 * (nodeRadius(4) - nodeRadius(0)));
  });

  it("finds the direct neighbours of a node", () => {
    expect([...neighboursOf(graph, "a")]).toEqual(["b"]);
    expect([...neighboursOf(graph, "c")]).toEqual([]);
  });

  it("matches labels case-insensitively, and nothing on an empty query", () => {
    expect([...matchingIds(graph, "alp")]).toEqual(["a"]);
    expect([...matchingIds(graph, "GAMMA")]).toEqual(["c"]);
    expect(matchingIds(graph, "  ").size).toBe(0);
    expect(matchingIds(graph, "nope").size).toBe(0);
  });

  it("lists only the node types actually present, in legend order", () => {
    expect(usedTypes(graph)).toEqual(["file", "text"]);
    expect(usedTypes({ nodes: [], links: [] })).toEqual([]);
  });
});

describe("GraphLayout", () => {
  const ring = (count: number): Graph =>
    buildGraph({
      nodes: Array.from({ length: count }, (_, i) => text(`n${i}`, `Node ${i}`)),
      edges: Array.from({ length: count }, (_, i) =>
        edge(`e${i}`, `n${i}`, `n${(i + 1) % count}`),
      ),
    });

  it("gives every node a finite position after settling", () => {
    const layout = new GraphLayout(ring(12));
    layout.settle(SETTLE_TICKS);
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
    layout.destroy();
  });

  it("spreads connected nodes apart instead of stacking them", () => {
    const layout = new GraphLayout(ring(8));
    layout.settle(SETTLE_TICKS);
    const box = layout.bounds();
    expect(box.maxX - box.minX).toBeGreaterThan(50);
    expect(box.maxY - box.minY).toBeGreaterThan(50);
    layout.destroy();
  });

  it("keeps a disconnected node nearby rather than flinging it away", () => {
    const graph = buildGraph({
      nodes: [text("a", "A"), text("b", "B"), text("lonely", "Lonely")],
      edges: [edge("e", "a", "b")],
    });
    const layout = new GraphLayout(graph);
    layout.settle(SETTLE_TICKS);
    const lonely = layout.get("lonely")!;
    expect(Math.hypot(lonely.x, lonely.y)).toBeLessThan(600);
    layout.destroy();
  });

  it("reuses positions carried over from a previous layout", () => {
    const graph = ring(5);
    const previous = new Map([["n0", { x: 123, y: -456 }]]);
    const layout = new GraphLayout(graph, previous);
    // Read before ticking: the seed is what we are checking.
    expect(layout.get("n0")!.x).toBe(123);
    expect(layout.get("n0")!.y).toBe(-456);
    layout.destroy();
  });

  it("holds a pinned node in place while the rest settle", () => {
    const layout = new GraphLayout(ring(6));
    layout.settle(50);
    layout.pin("n0", 200, 200);
    layout.settle(50);
    expect(layout.get("n0")!.x).toBe(200);
    expect(layout.get("n0")!.y).toBe(200);
    layout.destroy();
  });

  it("lets go of a single node again after it is unpinned", () => {
    const layout = new GraphLayout(ring(6));
    layout.settle(50);
    layout.pin("n0", 200, 200);
    layout.settle(20);
    layout.unpin("n0");
    layout.reheat();
    layout.settle(100);
    expect(layout.get("n0")!.x).not.toBe(200);
    layout.destroy();
  });

  it("releases every node with unpinAll", () => {
    const layout = new GraphLayout(ring(6));
    layout.pin("n0", 200, 200);
    layout.pin("n1", -200, -200);
    layout.unpinAll();
    layout.reheat();
    layout.settle(100);
    expect(layout.get("n0")!.x).not.toBe(200);
    expect(layout.get("n1")!.x).not.toBe(-200);
    layout.destroy();
  });

  it("reports a usable box for an empty graph", () => {
    const layout = new GraphLayout({ nodes: [], links: [] });
    expect(layout.bounds()).toEqual({ minX: -1, minY: -1, maxX: 1, maxY: 1 });
    layout.destroy();
  });

  it("handles a large graph without producing bad coordinates", () => {
    const layout = new GraphLayout(ring(220));
    layout.settle(SETTLE_TICKS);
    expect(layout.nodes).toHaveLength(220);
    expect(layout.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
    layout.destroy();
  });
});
