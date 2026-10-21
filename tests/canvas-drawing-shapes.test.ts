import { describe, expect, it } from "vitest";
import {
  DrawingShape,
  ShapeType,
  distToSegment,
  hitTestShape,
  isShapeMeaningful,
  snapAngle,
} from "../src/modules/canvas/drawing/shapes";

function shape(type: ShapeType, points: Array<[number, number]>): DrawingShape {
  return {
    id: "s1",
    type,
    color: "#000",
    lineWidth: 3,
    points: points.map(([x, y]) => ({ x, y })),
  };
}

describe("snapAngle", () => {
  const origin = { x: 0, y: 0 };

  it("locks a near-horizontal drag to 0 degrees", () => {
    const p = snapAngle(origin, { x: 100, y: 12 });
    expect(p.y).toBeCloseTo(0, 6);
    expect(p.x).toBeGreaterThan(90);
  });

  it("locks a near-diagonal drag to 45 degrees", () => {
    const p = snapAngle(origin, { x: 100, y: 88 });
    expect(p.x).toBeCloseTo(p.y, 6);
  });

  it("locks a near-vertical drag to 90 degrees", () => {
    const p = snapAngle(origin, { x: 7, y: -100 });
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeLessThan(-90);
  });

  it("preserves the drag length", () => {
    const target = { x: 60, y: 25 };
    const len = Math.hypot(target.x, target.y);
    const p = snapAngle(origin, target);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(len, 6);
  });

  it("handles a zero-length drag without dividing by zero", () => {
    const p = snapAngle(origin, { x: 0, y: 0 });
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });

  it("snaps into every quadrant", () => {
    const quadrants: Array<[number, number]> = [
      [100, 5],
      [5, 100],
      [-100, 5],
      [5, -100],
    ];
    for (const [x, y] of quadrants) {
      const p = snapAngle(origin, { x, y });
      const angle = Math.atan2(p.y, p.x);
      const remainder = Math.abs(((angle / (Math.PI / 4)) % 1 + 1) % 1);
      expect(Math.min(remainder, 1 - remainder)).toBeLessThan(1e-6);
    }
  });
});

describe("distToSegment", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };

  it("measures perpendicular distance in the middle", () => {
    expect(distToSegment({ x: 5, y: 3 }, a, b)).toBeCloseTo(3, 6);
  });

  it("clamps past the end instead of extending the line", () => {
    expect(distToSegment({ x: 20, y: 0 }, a, b)).toBeCloseTo(10, 6);
  });

  it("treats a degenerate segment as a point", () => {
    expect(distToSegment({ x: 3, y: 4 }, a, a)).toBeCloseTo(5, 6);
  });
});

describe("hitTestShape", () => {
  it("hits a pencil trail near one of its segments", () => {
    const s = shape("pencil", [
      [0, 0],
      [10, 0],
      [20, 0],
    ]);
    expect(hitTestShape(s, { x: 15, y: 2 }, 5)).toBe(true);
  });

  it("misses a pencil trail outside the tolerance", () => {
    const s = shape("pencil", [
      [0, 0],
      [10, 0],
    ]);
    expect(hitTestShape(s, { x: 5, y: 30 }, 5)).toBe(false);
  });

  it("hits a rectangle edge", () => {
    const s = shape("rect", [
      [0, 0],
      [100, 50],
    ]);
    expect(hitTestShape(s, { x: 50, y: 1 }, 4)).toBe(true);
  });

  it("does not hit the inside of a rectangle", () => {
    const s = shape("rect", [
      [0, 0],
      [100, 50],
    ]);
    expect(hitTestShape(s, { x: 50, y: 25 }, 4)).toBe(false);
  });

  it("hits an ellipse outline", () => {
    const s = shape("ellipse", [
      [0, 0],
      [100, 100],
    ]);
    expect(hitTestShape(s, { x: 100, y: 50 }, 4)).toBe(true);
    expect(hitTestShape(s, { x: 50, y: 50 }, 4)).toBe(false);
  });

  it("hits an arrow along its shaft", () => {
    const s = shape("arrow", [
      [0, 0],
      [100, 0],
    ]);
    expect(hitTestShape(s, { x: 40, y: 2 }, 5)).toBe(true);
  });

  it("treats a single-point shape as a dot", () => {
    const s = shape("pencil", [[10, 10]]);
    expect(hitTestShape(s, { x: 12, y: 10 }, 5)).toBe(true);
    expect(hitTestShape(s, { x: 40, y: 10 }, 5)).toBe(false);
  });
});

describe("isShapeMeaningful", () => {
  it("rejects a pencil tap", () => {
    expect(isShapeMeaningful(shape("pencil", [[0, 0]]))).toBe(false);
    expect(
      isShapeMeaningful(
        shape("pencil", [
          [0, 0],
          [1, 1],
        ])
      )
    ).toBe(false);
  });

  it("accepts a pencil trail with enough points", () => {
    expect(
      isShapeMeaningful(
        shape("pencil", [
          [0, 0],
          [1, 1],
          [2, 2],
          [3, 3],
        ])
      )
    ).toBe(true);
  });

  it("rejects a two-point shape that barely moved", () => {
    expect(
      isShapeMeaningful(
        shape("line", [
          [0, 0],
          [1, 1],
        ])
      )
    ).toBe(false);
  });

  it("accepts a two-point shape that covered ground", () => {
    expect(
      isShapeMeaningful(
        shape("line", [
          [0, 0],
          [50, 50],
        ])
      )
    ).toBe(true);
  });
});
