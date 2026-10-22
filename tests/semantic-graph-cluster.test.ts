import { describe, expect, it } from "vitest";
import {
  assignClusters,
  clusterCount,
  clusterHue,
  kmeansCosine,
} from "../src/modules/semantic-graph/cluster";
import { SemanticGraphLayout } from "../src/modules/semantic-graph/layout";
import { buildGraph } from "../src/modules/semantic-graph/logic";
import type { SearchResult } from "../src/modules/semantic-search/search";

/** Two clearly separate topics in three dimensions. */
const TOPIC_A = [1, 0.05, 0];
const TOPIC_B = [0, 0.05, 1];

function jitter(base: number[], i: number): number[] {
  return base.map((v) => v + i * 0.001);
}

describe("kmeansCosine", () => {
  it("separates two obvious topics", () => {
    const vectors = [
      jitter(TOPIC_A, 1),
      jitter(TOPIC_B, 1),
      jitter(TOPIC_A, 2),
      jitter(TOPIC_B, 2),
    ];
    const ids = kmeansCosine(vectors, 2);
    expect(ids[0]).toBe(ids[2]);
    expect(ids[1]).toBe(ids[3]);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("numbers clusters by first appearance", () => {
    const ids = kmeansCosine([TOPIC_B, TOPIC_A, TOPIC_B, TOPIC_A], 2);
    expect(ids[0]).toBe(0);
  });

  it("gives the same answer for the same input", () => {
    const vectors = Array.from({ length: 12 }, (_, i) => [Math.sin(i), Math.cos(i * 2), i / 12]);
    expect(kmeansCosine(vectors, 3, 7)).toEqual(kmeansCosine(vectors, 3, 7));
  });

  it("marks missing and empty vectors as -1", () => {
    const ids = kmeansCosine([TOPIC_A, null, TOPIC_B, [0, 0, 0], undefined], 2);
    expect(ids[1]).toBe(-1);
    expect(ids[3]).toBe(-1);
    expect(ids[4]).toBe(-1);
    expect(ids[0]).toBeGreaterThanOrEqual(0);
  });

  it("never makes more clusters than there are vectors", () => {
    const ids = kmeansCosine([TOPIC_A, TOPIC_B], 6);
    expect(new Set(ids).size).toBeLessThanOrEqual(2);
  });

  it("declines to cluster fewer than two usable vectors", () => {
    expect(kmeansCosine([TOPIC_A], 3)).toEqual([-1]);
    expect(kmeansCosine([], 3)).toEqual([]);
  });

  it("declines when asked for fewer than two clusters", () => {
    expect(kmeansCosine([TOPIC_A, TOPIC_B], 1)).toEqual([-1, -1]);
  });

  it("copes with identical vectors", () => {
    const ids = kmeansCosine([TOPIC_A, TOPIC_A, TOPIC_A], 3);
    expect(ids).toHaveLength(3);
    for (const id of ids) expect(Number.isFinite(id)).toBe(true);
  });
});

describe("assignClusters", () => {
  const found: SearchResult[] = ["b", "c", "d", "e"].map((name, i) => ({
    path: `${name}.md`,
    score: 0.9 - i * 0.1,
  }));
  const vectors: Record<string, number[]> = {
    "b.md": jitter(TOPIC_A, 1),
    "c.md": jitter(TOPIC_B, 1),
    "d.md": jitter(TOPIC_A, 2),
    "e.md": jitter(TOPIC_B, 2),
  };

  it("leaves the centre out of every group", () => {
    const graph = assignClusters(buildGraph("a.md", found), (p) => vectors[p], 2);
    expect(graph.nodes[0].cluster).toBeUndefined();
  });

  it("puts notes of the same topic in the same group", () => {
    const graph = assignClusters(buildGraph("a.md", found), (p) => vectors[p], 2);
    const group = (path: string) => graph.nodes.find((n) => n.path === path)?.cluster;
    expect(group("b.md")).toBe(group("d.md"));
    expect(group("c.md")).toBe(group("e.md"));
    expect(group("b.md")).not.toBe(group("c.md"));
    expect(clusterCount(graph)).toBe(2);
  });

  it("leaves a note with no vector ungrouped", () => {
    const graph = assignClusters(
      buildGraph("a.md", found),
      (p) => (p === "b.md" ? undefined : vectors[p]),
      2,
    );
    expect(graph.nodes.find((n) => n.path === "b.md")?.cluster).toBeUndefined();
  });

  it("does not edit the graph it was given", () => {
    const original = buildGraph("a.md", found);
    assignClusters(original, (p) => vectors[p], 2);
    expect(original.nodes.every((n) => n.cluster === undefined)).toBe(true);
  });

  it("assigns nothing when clustering is off", () => {
    const graph = assignClusters(buildGraph("a.md", found), (p) => vectors[p], 0);
    expect(clusterCount(graph)).toBe(0);
  });
});

describe("clusterHue", () => {
  it("gives each cluster its own hue", () => {
    const hues = [0, 1, 2, 3].map((c) => clusterHue(c, 4));
    expect(new Set(hues).size).toBe(4);
  });

  it("stays on the colour wheel", () => {
    for (let c = 0; c < 8; c++) {
      const hue = clusterHue(c, 8);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it("does not blow up on rubbish", () => {
    expect(clusterHue(-1, 4)).toBe(0);
    expect(clusterHue(2, 0)).toBe(0);
  });
});

describe("SemanticGraphLayout", () => {
  const names = ["b", "c", "d", "e", "f", "g", "h", "i"];
  const found: SearchResult[] = names.map((name, i) => ({
    path: `${name}.md`,
    score: 0.8 - i * 0.01,
  }));
  // Alternate topics, so a layout with no grouping interleaves them.
  const vectors: Record<string, number[]> = Object.fromEntries(
    names.map((name, i) => [`${name}.md`, jitter(i % 2 === 0 ? TOPIC_A : TOPIC_B, i)]),
  );

  function laidOut(strength?: number) {
    const graph = assignClusters(buildGraph("a.md", found), (p) => vectors[p], 2);
    const layout = new SemanticGraphLayout(graph, undefined, { clusterStrength: strength });
    layout.settle();
    return { graph, layout };
  }

  it("keeps the centre note at the origin", () => {
    const { layout } = laidOut();
    expect(layout.get("a.md")).toMatchObject({ x: 0, y: 0 });
  });

  it("never produces a NaN position", () => {
    const { layout } = laidOut();
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });

  it("lays out a graph with no groups at all", () => {
    const layout = new SemanticGraphLayout(buildGraph("a.md", found));
    layout.settle();
    expect(layout.nodes).toHaveLength(names.length + 1);
  });

  it("keeps each group closer together than it is to the other group", () => {
    const { graph, layout } = laidOut(0.25);
    const mean = (pairs: [string, string][]) => {
      const total = pairs.reduce((sum, [p, q]) => {
        const a = layout.get(p)!;
        const b = layout.get(q)!;
        return sum + Math.hypot(a.x - b.x, a.y - b.y);
      }, 0);
      return total / pairs.length;
    };
    const paths = graph.nodes.filter((n) => n.hop > 0);
    const within: [string, string][] = [];
    const across: [string, string][] = [];
    for (const p of paths) {
      for (const q of paths) {
        if (p.path >= q.path) continue;
        (p.cluster === q.cluster ? within : across).push([p.path, q.path]);
      }
    }
    expect(mean(within)).toBeLessThan(mean(across));
  });
});
