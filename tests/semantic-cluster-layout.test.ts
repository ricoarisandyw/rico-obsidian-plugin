import { describe, expect, it } from "vitest";
import { clusterVault, type ClusterNote } from "../src/modules/semantic-cluster/cluster-all";
import { clusterRadius, layoutClusters, spiral } from "../src/modules/semantic-cluster/layout";

const TOPICS = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
];

function notes(sizes: number[]): ClusterNote[] {
  return sizes.flatMap((size, t) =>
    Array.from({ length: size }, (_, i) => {
      const vec = [...TOPICS[t]];
      vec[(t + 1) % 4] = (i + 1) * 0.01;
      return { path: `t${t}/n${i}.md`, vec };
    }),
  );
}

describe("clusterRadius", () => {
  it("grows with the number of notes", () => {
    expect(clusterRadius(40)).toBeGreaterThan(clusterRadius(10));
  });

  it("is positive even for an empty group", () => {
    expect(clusterRadius(0)).toBeGreaterThan(0);
  });
});

describe("spiral", () => {
  it("makes the number of points asked for", () => {
    expect(spiral(0)).toEqual([]);
    expect(spiral(25)).toHaveLength(25);
  });

  it("puts no two points in the same place", () => {
    const keys = spiral(60).map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`);
    expect(new Set(keys).size).toBe(60);
  });

  it("stays inside the disc reserved for that many notes", () => {
    for (const count of [1, 7, 40, 200]) {
      for (const p of spiral(count)) {
        expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(clusterRadius(count));
      }
    }
  });
});

describe("layoutClusters", () => {
  const map = clusterVault(notes([12, 8, 5, 3]), { k: 4, minSize: 1 });
  const layout = layoutClusters(map);

  it("places every note", () => {
    expect(layout.dots.size).toBe(28);
  });

  it("never produces a NaN position", () => {
    for (const p of layout.dots.values()) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    for (const c of layout.clusters) {
      expect(Number.isFinite(c.x)).toBe(true);
      expect(Number.isFinite(c.y)).toBe(true);
    }
  });

  it("gives a bigger group a bigger disc", () => {
    const radii = layout.clusters.map((c) => c.r);
    expect(radii[0]).toBeGreaterThan(radii[radii.length - 1]);
  });

  it("keeps each group's notes inside its own disc", () => {
    for (const cluster of map.clusters) {
      const centre = layout.clusters.find((c) => c.id === cluster.id)!;
      for (const path of cluster.members) {
        const p = layout.dots.get(path)!;
        expect(Math.hypot(p.x - centre.x, p.y - centre.y)).toBeLessThanOrEqual(centre.r + 1e-6);
      }
    }
  });

  it("keeps groups from sitting on top of each other", () => {
    for (let i = 0; i < layout.clusters.length; i++) {
      for (let j = i + 1; j < layout.clusters.length; j++) {
        const a = layout.clusters[i];
        const b = layout.clusters[j];
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan((a.r + b.r) * 0.9);
      }
    }
  });

  it("reports bounds that contain every group", () => {
    for (const c of layout.clusters) {
      expect(c.x - c.r).toBeGreaterThanOrEqual(layout.bounds.minX - 1e-6);
      expect(c.x + c.r).toBeLessThanOrEqual(layout.bounds.maxX + 1e-6);
      expect(c.y - c.r).toBeGreaterThanOrEqual(layout.bounds.minY - 1e-6);
      expect(c.y + c.r).toBeLessThanOrEqual(layout.bounds.maxY + 1e-6);
    }
  });

  it("gives the same picture twice", () => {
    const again = layoutClusters(map);
    expect(again.clusters).toEqual(layout.clusters);
  });

  it("copes with an empty map", () => {
    const empty = layoutClusters(clusterVault([]));
    expect(empty.clusters).toEqual([]);
    expect(empty.dots.size).toBe(0);
    expect(empty.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it("copes with a single group", () => {
    const one = layoutClusters(clusterVault(notes([6]), { k: 1 }));
    expect(one.clusters).toHaveLength(1);
    expect(one.dots.size).toBe(6);
  });
});
