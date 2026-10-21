export interface DrawingPoint {
  x: number;
  y: number;
}

/** Tools that place a shape on the canvas, plus the eraser. */
export type DrawingTool = "pencil" | "line" | "arrow" | "rect" | "ellipse" | "eraser";

/** Everything the eraser is not: the tools that actually produce a shape. */
export type ShapeType = Exclude<DrawingTool, "eraser">;

export interface DrawingShape {
  id: string;
  type: ShapeType;
  color: string;
  lineWidth: number;
  /** Freehand trail for `pencil`; the two drag endpoints for every other type. */
  points: DrawingPoint[];
}

/** Angles a shift-locked drag is allowed to settle on. */
const SNAP_STEP = Math.PI / 4;

/** Lock `to` onto the nearest 45 degree ray out of `from`. */
export function snapAngle(from: DrawingPoint, to: DrawingPoint): DrawingPoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { ...to };
  const angle = Math.round(Math.atan2(dy, dx) / SNAP_STEP) * SNAP_STEP;
  return { x: from.x + Math.cos(angle) * len, y: from.y + Math.sin(angle) * len };
}

/** Shortest distance from `p` to the segment `a`–`b`. */
export function distToSegment(p: DrawingPoint, a: DrawingPoint, b: DrawingPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The axis-aligned box the two drag endpoints span. */
function boundsOf(points: DrawingPoint[]): { x: number; y: number; w: number; h: number } {
  const [a, b] = points;
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

/** Walk a rectangle's four edges as segments. */
function rectSegments(points: DrawingPoint[]): Array<[DrawingPoint, DrawingPoint]> {
  const { x, y, w, h } = boundsOf(points);
  const tl = { x, y };
  const tr = { x: x + w, y };
  const br = { x: x + w, y: y + h };
  const bl = { x, y: y + h };
  return [
    [tl, tr],
    [tr, br],
    [br, bl],
    [bl, tl],
  ];
}

/** Approximate an ellipse outline with segments, enough for hit-testing. */
function ellipseSegments(points: DrawingPoint[]): Array<[DrawingPoint, DrawingPoint]> {
  const { x, y, w, h } = boundsOf(points);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const STEPS = 32;
  const segs: Array<[DrawingPoint, DrawingPoint]> = [];
  let prev = { x: cx + rx, y: cy };
  for (let i = 1; i <= STEPS; i++) {
    const a = (i / STEPS) * Math.PI * 2;
    const next = { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
    segs.push([prev, next]);
    prev = next;
  }
  return segs;
}

/**
 * True when `p` lands on the shape's stroke, within `tolerance` world units.
 * Shapes are outlines only, so the inside of a rectangle is not a hit.
 */
export function hitTestShape(shape: DrawingShape, p: DrawingPoint, tolerance: number): boolean {
  const pts = shape.points;
  if (pts.length === 0) return false;
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= tolerance;

  let segs: Array<[DrawingPoint, DrawingPoint]>;
  if (shape.type === "rect") {
    segs = rectSegments(pts);
  } else if (shape.type === "ellipse") {
    segs = ellipseSegments(pts);
  } else {
    segs = [];
    for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
  }

  for (const [a, b] of segs) {
    if (distToSegment(p, a, b) <= tolerance) return true;
  }
  return false;
}

/** Arrow head length in world units, scaled off the stroke width. */
function arrowHeadLength(lineWidth: number): number {
  return Math.max(8, lineWidth * 3.5);
}

function strokeArrow(ctx: CanvasRenderingContext2D, shape: DrawingShape): void {
  const [a, b] = shape.points;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;

  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  const angle = Math.atan2(dy, dx);
  // Keep the head from swallowing a very short shaft.
  const head = Math.min(arrowHeadLength(shape.lineWidth), len * 0.9);
  const spread = Math.PI / 7;
  ctx.beginPath();
  ctx.moveTo(b.x - Math.cos(angle - spread) * head, b.y - Math.sin(angle - spread) * head);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(b.x - Math.cos(angle + spread) * head, b.y - Math.sin(angle + spread) * head);
  ctx.stroke();
}

function strokePencil(ctx: CanvasRenderingContext2D, shape: DrawingShape): void {
  const pts = shape.points;
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  // Quadratic midpoints smooth the raw pointer trail.
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.stroke();
}

/**
 * Draw `shape` in world coordinates. The caller has already applied the camera
 * transform, so the stroke width is a world unit too and zooms with the shape,
 * the way the ink would behave if it were drawn on the canvas itself.
 */
export function drawShape(ctx: CanvasRenderingContext2D, shape: DrawingShape): void {
  ctx.strokeStyle = shape.color;
  ctx.lineWidth = shape.lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (shape.type === "pencil") {
    strokePencil(ctx, shape);
    return;
  }
  if (shape.points.length < 2) return;

  if (shape.type === "line") {
    const [a, b] = shape.points;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  } else if (shape.type === "arrow") {
    strokeArrow(ctx, shape);
  } else if (shape.type === "rect") {
    const { x, y, w, h } = boundsOf(shape.points);
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.stroke();
  } else if (shape.type === "ellipse") {
    const { x, y, w, h } = boundsOf(shape.points);
    if (w < 0.5 || h < 0.5) return;
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** A shape is worth keeping only once the drag covered some ground. */
export function isShapeMeaningful(shape: DrawingShape): boolean {
  if (shape.type === "pencil") return shape.points.length > 2;
  if (shape.points.length < 2) return false;
  const [a, b] = shape.points;
  return Math.hypot(b.x - a.x, b.y - a.y) >= 3;
}
