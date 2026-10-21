import type { DrawingPoint } from "./shapes";

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

type CanvasWithPos = {
  canvas?: { posFromClient?: (pt: { x: number; y: number }) => { x: number; y: number } };
};

/**
 * Reads the Obsidian canvas camera and caches it, because deriving it costs a
 * `getBoundingClientRect` plus two `posFromClient` calls. Everything in one
 * render pass shares a single reading via `begin()` / `end()`.
 */
export class CameraReader {
  private cached: Camera | null = null;
  private holding = false;

  constructor(
    private readonly getView: () => unknown,
    private readonly getOverlay: () => HTMLCanvasElement | undefined,
    private readonly getWrapper: () => HTMLElement | undefined
  ) {}

  /** Start a pass in which every `get()` returns the same reading. */
  begin(): Camera {
    this.cached = this.read();
    this.holding = true;
    return this.cached;
  }

  /** End the pass; the next `get()` reads fresh again. */
  end(): void {
    this.holding = false;
    this.cached = null;
  }

  get(): Camera {
    if (this.holding && this.cached) return this.cached;
    return this.read();
  }

  screenToWorld(sx: number, sy: number): DrawingPoint {
    const { x, y, scale } = this.get();
    return { x: (sx - x) / scale, y: (sy - y) / scale };
  }

  worldToScreen(wx: number, wy: number): { sx: number; sy: number } {
    const { x, y, scale } = this.get();
    return { sx: wx * scale + x, sy: wy * scale + y };
  }

  private read(): Camera {
    const overlay = this.getOverlay();
    const wrapper = this.getWrapper();
    if (!overlay || !wrapper) return { x: 0, y: 0, scale: 1 };

    const rect = overlay.getBoundingClientRect();
    const canvas = (this.getView() as CanvasWithPos | undefined)?.canvas;

    if (canvas && typeof canvas.posFromClient === "function") {
      try {
        // Probe two screen points and solve for the affine transform.
        const p0 = canvas.posFromClient({ x: rect.left, y: rect.top });
        const p1 = canvas.posFromClient({ x: rect.left + 200, y: rect.top + 200 });
        const dwx = p1.x - p0.x;
        const dwy = p1.y - p0.y;
        if (dwx > 1e-9 && dwy > 1e-9) {
          const scale = 200 / dwx;
          return { x: -p0.x * scale, y: -p0.y * scale, scale };
        }
      } catch {
        /* fall through to reading the DOM transform */
      }
    }

    const contentEl = wrapper.querySelector<HTMLElement>(
      '.canvas-nodes, .canvas-edges, [class*="canvas-layer"]'
    );
    if (contentEl) {
      const transform = window.getComputedStyle(contentEl).transform;
      if (transform && transform !== "none") {
        const m = new DOMMatrix(transform);
        if (m.a > 0) {
          const cr = contentEl.getBoundingClientRect();
          return { x: cr.left - rect.left, y: cr.top - rect.top, scale: m.a };
        }
      }
    }
    return { x: 0, y: 0, scale: 1 };
  }
}
