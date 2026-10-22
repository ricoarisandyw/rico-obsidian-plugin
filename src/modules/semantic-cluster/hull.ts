/**
 * Outlines for the cluster blobs.
 *
 * `d3-polygon` is not installed and a convex hull is twenty lines, so it is
 * written here. No Obsidian imports, so it can be tested without a vault.
 */

export interface Pt {
  x: number;
  y: number;
}

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Convex hull by Andrew's monotone chain, counter-clockwise.
 *
 * Duplicate points are dropped first. Fewer than three distinct points, or
 * points all in a line, give back the one or two extreme points, which the
 * caller draws as a dot or a bar rather than a polygon.
 */
export function convexHull(points: Pt[]): Pt[] {
  const sorted = points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: p.x, y: p.y }))
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .filter((p, i, all) => i === 0 || p.x !== all[i - 1].x || p.y !== all[i - 1].y);

  if (sorted.length < 3) return sorted;

  const lower: Pt[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Pt[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  // The last point of each chain is the first of the other.
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/** Mean of the points, or the origin for none. */
export function centroid(points: Pt[]): Pt {
  if (!points.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/**
 * An SVG path for a blob around the points.
 *
 * With three or more hull corners it is a closed polygon; the caller strokes it
 * thickly with round joins, which is what rounds the corners off. One or two
 * points become a zero-length line, which a round-capped stroke draws as a dot
 * or a pill, so small groups still get a blob rather than nothing.
 */
export function blobPath(points: Pt[]): string {
  const hull = convexHull(points);
  if (!hull.length) return "";
  const num = (n: number) => Math.round(n * 100) / 100;
  if (hull.length === 1) return `M${num(hull[0].x)} ${num(hull[0].y)}l0 0`;
  if (hull.length === 2) {
    return `M${num(hull[0].x)} ${num(hull[0].y)}L${num(hull[1].x)} ${num(hull[1].y)}`;
  }
  return `M${hull.map((p) => `${num(p.x)} ${num(p.y)}`).join("L")}Z`;
}
