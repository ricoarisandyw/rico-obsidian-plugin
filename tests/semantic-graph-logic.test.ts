import { describe, expect, it } from "vitest";
import {
  atHopLimit,
  buildGraph,
  closenessOf,
  emptyGraph,
  expandGraph,
  hasNode,
  labelFor,
  linkDistance,
  nodeRadius,
  radiusOf,
  spreadScores,
} from "../src/modules/semantic-graph/logic";
import type { SearchResult } from "../src/modules/semantic-search/search";

/** Ranked results, highest first, the way search() returns them. */
function results(...pairs: [string, number][]): SearchResult[] {
  return pairs.map(([path, score]) => ({ path, score }));
}

describe("linkDistance", () => {
  it("puts a perfect match closest", () => {
    expect(linkDistance(1)).toBeLessThan(linkDistance(0.9));
  });

  it("puts an unrelated note furthest", () => {
    expect(linkDistance(0)).toBeGreaterThan(linkDistance(0.1));
  });

  it("falls as the score rises, all the way along", () => {
    const steps = [0, 0.2, 0.4, 0.6, 0.8, 1].map(linkDistance);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeLessThan(steps[i - 1]);
    }
  });

  it("stays positive and finite for rubbish input", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -5, 42]) {
      const distance = linkDistance(bad);
      expect(Number.isFinite(distance)).toBe(true);
      expect(distance).toBeGreaterThan(0);
    }
  });
});

describe("nodeRadius", () => {
  it("grows with the score", () => {
    expect(nodeRadius(0.9)).toBeGreaterThan(nodeRadius(0.2));
  });

  it("stays within bounds at the extremes", () => {
    const low = nodeRadius(0);
    const high = nodeRadius(1);
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThan(40);
  });

  it("clamps a score outside 0-1 instead of running away", () => {
    expect(nodeRadius(5)).toBe(nodeRadius(1));
    expect(nodeRadius(-5)).toBe(nodeRadius(0));
    expect(Number.isFinite(nodeRadius(Number.NaN))).toBe(true);
  });
});

describe("labelFor", () => {
  it("drops the folder and the extension", () => {
    expect(labelFor("notes/work/kontrak HVAC.md")).toBe("kontrak HVAC");
  });

  it("handles a bare filename", () => {
    expect(labelFor("README.md")).toBe("README");
  });

  it("leaves a dotfile alone", () => {
    expect(labelFor(".gitignore")).toBe(".gitignore");
  });
});

describe("buildGraph", () => {
  it("puts the centre note first, at hop 0", () => {
    const graph = buildGraph("a.md", results(["b.md", 0.8]));
    expect(graph.centre).toBe("a.md");
    expect(graph.nodes[0]).toMatchObject({ path: "a.md", hop: 0, score: 1 });
  });

  it("links every neighbour back to the centre", () => {
    const graph = buildGraph("a.md", results(["b.md", 0.8], ["c.md", 0.6]));
    expect(graph.links).toHaveLength(2);
    expect(graph.links.every((link) => link.source === "a.md")).toBe(true);
  });

  it("keeps neighbours at hop 1", () => {
    const graph = buildGraph("a.md", results(["b.md", 0.8]));
    expect(graph.nodes.find((n) => n.path === "b.md")?.hop).toBe(1);
  });

  it("caps the neighbours at the limit, keeping the strongest", () => {
    const many = results(...Array.from({ length: 50 }, (_, i): [string, number] => [
      `n${i}.md`,
      1 - i / 100,
    ]));
    const graph = buildGraph("a.md", many, { limit: 10 });
    // 10 neighbours plus the centre.
    expect(graph.nodes).toHaveLength(11);
    expect(graph.nodes[1].path).toBe("n0.md");
  });

  it("drops anything at or below the minimum score", () => {
    const graph = buildGraph("a.md", results(["b.md", 0.8], ["c.md", 0.1]), {
      minScore: 0.5,
    });
    expect(hasNode(graph, "c.md")).toBe(false);
  });

  it("never lists the centre as its own neighbour", () => {
    const graph = buildGraph("a.md", results(["a.md", 1], ["b.md", 0.8]));
    expect(graph.nodes.filter((n) => n.path === "a.md")).toHaveLength(1);
    expect(graph.links).toHaveLength(1);
  });

  it("returns just the centre when nothing is indexed", () => {
    const graph = buildGraph("a.md", []);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.links).toHaveLength(0);
  });

  it("carries the kind and breakdown through to the node", () => {
    const breakdown = { total: 0.8, parts: [] };
    const graph = buildGraph("a.md", [
      { path: "b.md", score: 0.8, kind: "canvas", breakdown },
    ]);
    expect(graph.nodes[1]).toMatchObject({ kind: "canvas", breakdown });
  });
});

describe("expandGraph", () => {
  it("adds a second hop under the node it expanded", () => {
    const first = buildGraph("a.md", results(["b.md", 0.8]));
    const second = expandGraph(first, "b.md", results(["c.md", 0.7]));
    expect(second.nodes.find((n) => n.path === "c.md")?.hop).toBe(2);
    expect(second.links).toHaveLength(2);
  });

  it("merges a note reached twice instead of duplicating it", () => {
    const first = buildGraph("a.md", results(["b.md", 0.8], ["c.md", 0.4]));
    const second = expandGraph(first, "b.md", results(["c.md", 0.9]));
    expect(second.nodes.filter((n) => n.path === "c.md")).toHaveLength(1);
  });

  it("keeps the better score when a note is reached twice", () => {
    const first = buildGraph("a.md", results(["b.md", 0.8], ["c.md", 0.4]));
    const second = expandGraph(first, "b.md", results(["c.md", 0.9]));
    expect(second.nodes.find((n) => n.path === "c.md")?.score).toBeCloseTo(0.9, 10);
  });

  it("keeps the shorter hop when a note is reached twice", () => {
    const first = buildGraph("a.md", results(["b.md", 0.8], ["c.md", 0.4]));
    const second = expandGraph(first, "b.md", results(["c.md", 0.9]));
    expect(second.nodes.find((n) => n.path === "c.md")?.hop).toBe(1);
  });

  it("does not link the same pair twice", () => {
    const first = buildGraph("a.md", results(["b.md", 0.8]));
    const second = expandGraph(first, "b.md", results(["a.md", 0.8]));
    expect(second.links).toHaveLength(1);
  });

  it("refuses to expand a node that is not in the graph", () => {
    const first = buildGraph("a.md", results(["b.md", 0.8]));
    const second = expandGraph(first, "ghost.md", results(["c.md", 0.7]));
    expect(second).toBe(first);
  });

  it("caps each hop independently", () => {
    const many = results(...Array.from({ length: 30 }, (_, i): [string, number] => [
      `x${i}.md`,
      0.9 - i / 100,
    ]));
    const first = buildGraph("a.md", results(["b.md", 0.95]), { limit: 5 });
    const second = expandGraph(first, "b.md", many, { limit: 5 });
    // centre + b + 5 from the expansion.
    expect(second.nodes).toHaveLength(7);
  });

  it("leaves the original graph untouched", () => {
    const first = buildGraph("a.md", results(["b.md", 0.8]));
    const before = first.nodes.length;
    expandGraph(first, "b.md", results(["c.md", 0.7]));
    expect(first.nodes).toHaveLength(before);
  });
});

describe("atHopLimit", () => {
  it("lets a hop-1 node expand when two hops are allowed", () => {
    const graph = buildGraph("a.md", results(["b.md", 0.8]));
    expect(atHopLimit(graph, "b.md", 2)).toBe(false);
  });

  it("stops a hop-1 node when only one hop is allowed", () => {
    const graph = buildGraph("a.md", results(["b.md", 0.8]));
    expect(atHopLimit(graph, "b.md", 1)).toBe(true);
  });

  it("treats a missing node as at the limit", () => {
    expect(atHopLimit(emptyGraph(), "ghost.md", 5)).toBe(true);
  });
});

describe("spreadScores", () => {
  it("stretches a narrow band across 0-1", () => {
    const spread = spreadScores([0.7, 0.65, 0.6]);
    expect(spread[0]).toBeCloseTo(1, 10);
    expect(spread[1]).toBeCloseTo(0.5, 10);
    expect(spread[2]).toBeCloseTo(0, 10);
  });

  it("leaves a lone score alone", () => {
    expect(spreadScores([0.4])).toEqual([0.4]);
  });

  it("does not divide by zero when every score is equal", () => {
    expect(spreadScores([0.5, 0.5, 0.5])).toEqual([0.5, 0.5, 0.5]);
  });

  it("returns an empty list for no scores", () => {
    expect(spreadScores([])).toEqual([]);
  });

  it("treats rubbish as 0 rather than spreading NaN", () => {
    for (const value of spreadScores([Number.NaN, 0.8, 0.4])) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe("buildGraph with spread", () => {
  const close = results(["b.md", 0.7], ["c.md", 0.65], ["d.md", 0.6]);

  it("keeps the real score and stretches the closeness", () => {
    const graph = buildGraph("a.md", close, { spread: true });
    const b = graph.nodes.find((n) => n.path === "b.md")!;
    const d = graph.nodes.find((n) => n.path === "d.md")!;
    expect(b.score).toBeCloseTo(0.7, 10);
    expect(b.closeness).toBeCloseTo(1, 10);
    expect(d.closeness).toBeCloseTo(0, 10);
  });

  it("puts the weakest neighbour further out than the strongest once spread", () => {
    const graph = buildGraph("a.md", close, { spread: true });
    const [b, , d] = graph.links;
    expect(linkDistance(closenessOf(d))).toBeGreaterThan(linkDistance(closenessOf(b)));
  });

  it("uses the raw score when spread is off", () => {
    const graph = buildGraph("a.md", close);
    const link = graph.links[0];
    expect(closenessOf(link)).toBeCloseTo(0.7, 10);
  });

  it("spreads only the neighbours that survived the limit", () => {
    const graph = buildGraph("a.md", close, { spread: true, limit: 2 });
    const closenesses = graph.nodes.filter((n) => n.hop > 0).map((n) => n.closeness);
    expect(closenesses).toEqual([1, 0]);
  });
});

describe("radiusOf", () => {
  it("draws the centre larger than any neighbour", () => {
    const graph = buildGraph("a.md", results(["b.md", 1]));
    expect(radiusOf(graph.nodes[0])).toBeGreaterThan(radiusOf(graph.nodes[1]));
  });

  it("sizes a neighbour from its closeness, not its raw score", () => {
    const graph = buildGraph("a.md", results(["b.md", 0.7], ["c.md", 0.6]), { spread: true });
    expect(radiusOf(graph.nodes[1])).toBeGreaterThan(radiusOf(graph.nodes[2]));
    expect(radiusOf(graph.nodes[2])).toBe(nodeRadius(0));
  });
});
