import { describe, expect, it } from "vitest";
import { blobPath, centroid, convexHull } from "../src/modules/semantic-cluster/hull";

describe("convexHull", () => {
  it("keeps only the corners of a square with a point inside", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 },
    ]);
    expect(hull).toHaveLength(4);
    expect(hull.some((p) => p.x === 5 && p.y === 5)).toBe(false);
  });

  it("gives the two ends of points that lie in a line", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 10 },
    ]);
    expect(hull).toHaveLength(2);
  });

  it("returns a single point for one point, and for duplicates of it", () => {
    expect(convexHull([{ x: 3, y: 4 }])).toHaveLength(1);
    expect(convexHull([{ x: 3, y: 4 }, { x: 3, y: 4 }])).toHaveLength(1);
  });

  it("returns nothing for nothing", () => {
    expect(convexHull([])).toEqual([]);
  });

  it("drops points that are not finite numbers", () => {
    const hull = convexHull([
      { x: Number.NaN, y: 0 },
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 4 },
    ]);
    expect(hull).toHaveLength(3);
    for (const p of hull) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("does not edit the points it was given", () => {
    const points = [
      { x: 2, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 3 },
    ];
    const copy = points.map((p) => ({ ...p }));
    convexHull(points);
    expect(points).toEqual(copy);
  });
});

describe("centroid", () => {
  it("is the mean of the points", () => {
    expect(centroid([{ x: 0, y: 0 }, { x: 4, y: 2 }])).toEqual({ x: 2, y: 1 });
  });

  it("is the origin for no points", () => {
    expect(centroid([])).toEqual({ x: 0, y: 0 });
  });
});

describe("blobPath", () => {
  it("closes a polygon of three or more corners", () => {
    const path = blobPath([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 8 },
    ]);
    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
  });

  it("draws one point as a zero-length line, so a round stroke makes a dot", () => {
    expect(blobPath([{ x: 1, y: 2 }])).toContain("l0 0");
  });

  it("draws two points as a line", () => {
    expect(blobPath([{ x: 0, y: 0 }, { x: 5, y: 5 }])).toContain("L");
  });

  it("is empty for no points, and never contains NaN", () => {
    expect(blobPath([])).toBe("");
    expect(blobPath([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 3 }])).not.toContain("NaN");
  });
});
