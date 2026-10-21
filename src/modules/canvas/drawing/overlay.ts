import { App, Plugin, WorkspaceLeaf } from "obsidian";
import { CameraReader } from "./camera";
import {
  DrawingPoint,
  DrawingShape,
  DrawingTool,
  ShapeType,
  drawShape,
  hitTestShape,
  isShapeMeaningful,
  snapAngle,
} from "./shapes";
import { DrawingToolbar, TOOL_DEFS, ToolbarHost } from "./toolbar";
import { registerRailButton, syncRail } from "../tool-rail";

/**
 * Rail buttons are shared across every canvas, so a click has to resolve back
 * to the overlay owning the wrapper it was fired in.
 */
const overlaysByWrapper = new WeakMap<HTMLElement, CanvasDrawingOverlay>();

function overlayForWrapper(wrapper: HTMLElement): CanvasDrawingOverlay | undefined {
  return overlaysByWrapper.get(wrapper);
}

export type { DrawingPoint, DrawingShape, DrawingTool } from "./shapes";

/** The slice of Obsidian's Keymap scope we use; it is not in the public types. */
interface KeymapScope {
  register?: (mods: string[], key: string, fn: () => boolean | void) => unknown;
  unregister?: (handle: unknown) => void;
}

export interface CanvasPluginData {
  drawings?: Record<
    string,
    {
      shapes?: DrawingShape[];
      belowNodes?: boolean;
      /** Legacy field from the frame era; read for migration, never written. */
      frames?: unknown[];
    }
  >;
  settings?: {
    color?: string;
    lineWidth?: number;
  };
}

/** One reversible change to the shape list. */
type Operation =
  | { kind: "add"; shapes: DrawingShape[] }
  | { kind: "delete"; shapes: DrawingShape[] };

/** How close the eraser must come to a stroke, in screen pixels. */
const ERASER_RADIUS_PX = 10;
const MAX_HISTORY = 100;

export class CanvasDrawingOverlay implements ToolbarHost {
  leaf: WorkspaceLeaf;
  app: App;
  plugin: Plugin;

  tool: DrawingTool = "pencil";
  color = "#000000";
  lineWidth = 3;
  shapes: DrawingShape[] = [];
  drawingMode = false;
  belowNodes = false;

  private currentShape: DrawingShape | null = null;
  private isDrawing = false;
  private shiftKey = false;
  private erasedInStroke: DrawingShape[] = [];
  private undoStack: Operation[] = [];
  private redoStack: Operation[] = [];

  private rafId: number | null = null;
  private lastCamera: { x: number; y: number; scale: number } | null = null;
  private belowActive = false;
  private camera: CameraReader;

  wrapperEl!: HTMLElement;
  toggleBtn!: HTMLButtonElement;
  overlayCanvas!: HTMLCanvasElement;
  ctx!: CanvasRenderingContext2D | null;
  resizeObserver!: ResizeObserver;
  toolbar!: DrawingToolbar;

  private boundOnMouseDown = (e: MouseEvent) => this.onMouseDown(e);
  private boundOnMouseMove = () => this.onMouseMove();
  private boundOnDocMove = (e: MouseEvent) => this.onDocMouseMove(e);
  private boundOnDocUp = () => this.onDocMouseUp();
  private boundOnWheel = (e: WheelEvent) => this.onWheel(e);
  /** Handles registered on Obsidian's keymap scope, released on exit. */
  private scopeHandles: unknown[] = [];
  private boundOnKeyDown = (e: KeyboardEvent) => this.onKeyDown(e);
  private boundOnKeyUp = (e: KeyboardEvent) => this.onKeyUp(e);

  constructor(leaf: WorkspaceLeaf, app: App, plugin: Plugin) {
    this.leaf = leaf;
    this.app = app;
    this.plugin = plugin;
    this.camera = new CameraReader(
      () => this.leaf.view,
      () => this.overlayCanvas,
      () => this.wrapperEl
    );
  }

  /**
   * Ensure this canvas has a rail carrying the drawing toggle. The rail owns
   * ordering, so this is idempotent and safe to re-run on layout changes.
   */
  placeToggleBtn(): void {
    if (!this.wrapperEl) return;
    syncRail(this.wrapperEl);
    const btn = this.wrapperEl.querySelector<HTMLButtonElement>(
      ".rico-canvas-rail-btn-drawing"
    );
    if (btn) {
      this.toggleBtn = btn;
      // Only write when it changes: this runs from a MutationObserver handler.
      if (btn.classList.contains("active") !== this.drawingMode) {
        btn.classList.toggle("active", this.drawingMode);
      }
    }
  }

  genId(): string {
    return Math.random().toString(36).slice(2, 10);
  }

  // ---- Lifecycle ----------------------------------------------------

  attach(): void {
    const containerEl = (this.leaf.view as unknown as { containerEl: HTMLElement }).containerEl;
    this.wrapperEl =
      containerEl.querySelector<HTMLElement>(".canvas-wrapper") ??
      containerEl.querySelector<HTMLElement>(".canvas") ??
      containerEl;
    overlaysByWrapper.set(this.wrapperEl, this);

    // The toggle lives on the shared left-edge rail. Registering is global and
    // idempotent; syncRail() then materialises the button on this canvas.
    registerRailButton({
      id: "drawing",
      icon: "palette",
      label: "Drawing Mode",
      order: 20,
      className: "rich-canvas-toggle-btn",
      onClick: (_e, btn) => {
        const wrapper = btn.closest<HTMLElement>(".canvas-wrapper");
        const target = wrapper ? overlayForWrapper(wrapper) : this;
        (target ?? this).toggleDrawingMode();
      },
    });
    this.placeToggleBtn();

    this.toolbar = new DrawingToolbar(this.wrapperEl, this);

    this.overlayCanvas = this.wrapperEl.createEl("canvas", { cls: "rich-canvas-overlay" });
    this.ctx = this.overlayCanvas.getContext("2d");

    this.resizeObserver = new ResizeObserver(() => this.resizeOverlay());
    this.resizeObserver.observe(this.wrapperEl);
    this.resizeOverlay();

    this.load();
    this.startRenderLoop();
  }

  detach(): void {
    this.stopRenderLoop();
    this.stopDrag();
    this.overlayCanvas?.remove();
    // The rail is shared with the other canvas modules and is torn down with
    // the view, so only this overlay's link to it is dropped here.
    if (this.wrapperEl) overlaysByWrapper.delete(this.wrapperEl);
    this.toolbar?.destroy();
    this.resizeObserver?.disconnect();
    this.overlayCanvas?.removeEventListener("mousedown", this.boundOnMouseDown);
    this.overlayCanvas?.removeEventListener("mousemove", this.boundOnMouseMove);
    this.overlayCanvas?.removeEventListener("wheel", this.boundOnWheel);
    document.removeEventListener("keydown", this.boundOnKeyDown, true);
    document.removeEventListener("keyup", this.boundOnKeyUp);
    // A tab can close while drawing mode is still on; leaving the scope keys
    // registered would route Cmd+Z into a detached overlay.
    this.unregisterScopeKeys();
  }

  // ---- ToolbarHost --------------------------------------------------

  setTool(tool: DrawingTool): void {
    this.tool = tool;
    this.toolbar?.syncTool();
    this.updateCursor();
  }

  setColor(color: string): void {
    this.color = color;
    void this.saveSettings();
  }

  setLineWidth(width: number): void {
    this.lineWidth = width;
    void this.saveSettings();
  }

  clearAll(): void {
    if (this.shapes.length === 0) return;
    if (!confirm("Clear all drawings on this canvas?")) return;
    this.pushOp({ kind: "delete", shapes: this.shapes.slice() });
    this.shapes = [];
    this.render();
    void this.save();
  }

  close(): void {
    if (this.drawingMode) this.toggleDrawingMode();
  }

  // ---- Drawing mode -------------------------------------------------

  toggleDrawingMode(): void {
    this.drawingMode = !this.drawingMode;
    this.toggleBtn.classList.toggle("active", this.drawingMode);
    this.toolbar.setVisible(this.drawingMode);

    const containerEl = (this.leaf.view as unknown as { containerEl: HTMLElement }).containerEl;
    const menuEl = containerEl.querySelector<HTMLElement>(".canvas-menu");

    if (this.drawingMode) {
      this.overlayCanvas.classList.add("active");
      if (menuEl) menuEl.style.zIndex = "1001";
      this.overlayCanvas.addEventListener("mousedown", this.boundOnMouseDown);
      this.overlayCanvas.addEventListener("mousemove", this.boundOnMouseMove);
      this.overlayCanvas.addEventListener("wheel", this.boundOnWheel);
      document.addEventListener("keydown", this.boundOnKeyDown, true);
      document.addEventListener("keyup", this.boundOnKeyUp);
      this.registerScopeKeys();
      this.updateCursor();
    } else {
      this.overlayCanvas.classList.remove("active");
      // Drawing mode drives cursor and pointer-events inline, which outrank the
      // stylesheet; clear them or the overlay keeps eating clicks on nodes.
      this.overlayCanvas.style.cursor = "";
      this.overlayCanvas.style.pointerEvents = "";
      if (menuEl) menuEl.style.zIndex = "";
      this.overlayCanvas.removeEventListener("mousedown", this.boundOnMouseDown);
      this.overlayCanvas.removeEventListener("mousemove", this.boundOnMouseMove);
      this.overlayCanvas.removeEventListener("wheel", this.boundOnWheel);
      this.stopDrag();
      document.removeEventListener("keydown", this.boundOnKeyDown, true);
      document.removeEventListener("keyup", this.boundOnKeyUp);
      this.unregisterScopeKeys();
    }
    this.applyOverlayStacking();
  }

  /**
   * Obsidian dispatches undo/redo through its keymap scope, which runs before
   * document-level listeners -- so the canvas would undo a node before our
   * capture handler ever saw Cmd+Z. Registering on the same scope while
   * drawing mode is on puts us ahead of it, and returning false stops the
   * canvas handler from also firing.
   */
  private registerScopeKeys(): void {
    const scope = (this.app as unknown as { scope?: KeymapScope }).scope;
    if (!scope?.register) return;

    const take = (fn: () => void) => (): boolean => {
      fn();
      return false; // Consume the key so the canvas does not also undo.
    };

    for (const mod of [["Mod"], ["Ctrl"]]) {
      this.scopeHandles.push(scope.register(mod, "z", take(() => this.undo())));
      this.scopeHandles.push(scope.register([...mod, "Shift"], "z", take(() => this.redo())));
      this.scopeHandles.push(scope.register(mod, "y", take(() => this.redo())));
    }
  }

  private unregisterScopeKeys(): void {
    const scope = (this.app as unknown as { scope?: KeymapScope }).scope;
    for (const handle of this.scopeHandles) {
      try {
        scope?.unregister?.(handle);
      } catch {
        /* a stale handle is not worth failing the mode switch over */
      }
    }
    this.scopeHandles = [];
  }

  // ---- Render loop --------------------------------------------------

  /**
   * A detached or zero-sized wrapper means the canvas tab is in the background,
   * so there is nothing to draw and no reason to probe the camera.
   */
  private isVisible(): boolean {
    const el = this.wrapperEl;
    if (!el || !el.isConnected) return false;
    return el.clientWidth > 0 && el.clientHeight > 0;
  }

  startRenderLoop(): void {
    if (this.rafId) return;
    const loop = () => {
      // A hidden canvas costs nothing: skip the camera probe entirely.
      if (this.isVisible()) {
        const cam = this.camera.get();
        const prev = this.lastCamera;
        if (!prev || cam.x !== prev.x || cam.y !== prev.y || cam.scale !== prev.scale) {
          this.lastCamera = cam;
          if (this.belowActive) this.updateCounterTransform();
          this.render();
        }
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stopRenderLoop(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  resizeOverlay(): void {
    const w = this.wrapperEl.clientWidth;
    const h = this.wrapperEl.clientHeight;
    this.overlayCanvas.width = w;
    this.overlayCanvas.height = h;
    if (this.belowActive) {
      this.overlayCanvas.style.width = w + "px";
      this.overlayCanvas.style.height = h + "px";
    }
    this.render();
  }

  getCamera(): { x: number; y: number; scale: number } {
    return this.camera.get();
  }

  screenToWorld(sx: number, sy: number): DrawingPoint {
    const { x, y, scale } = this.getCamera();
    return { x: (sx - x) / scale, y: (sy - y) / scale };
  }

  worldToScreen(wx: number, wy: number): { sx: number; sy: number } {
    const { x, y, scale } = this.getCamera();
    return { sx: wx * scale + x, sy: wy * scale + y };
  }

  getPos(e: MouseEvent): { sx: number; sy: number } {
    const r = this.overlayCanvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  // ---- Stacking (drawings above / below nodes) -----------------------

  getContentLayer(): HTMLElement | null {
    const nodeEl = this.wrapperEl.querySelector<HTMLElement>(".canvas-node");
    let el = nodeEl ? nodeEl.parentElement : null;
    while (el && el !== this.wrapperEl && el !== document.body) {
      const t = getComputedStyle(el).transform;
      if (t && t !== "none") return el;
      el = el.parentElement;
    }
    return this.wrapperEl.querySelector<HTMLElement>(".canvas-nodes") || null;
  }

  applyOverlayStacking(): void {
    const oc = this.overlayCanvas;
    if (!oc) return;
    const wantBelow = this.belowNodes && !this.drawingMode;

    if (wantBelow) {
      const layer = this.getContentLayer();
      if (layer) {
        oc.classList.add("below-nodes");
        oc.style.transformOrigin = "0 0";
        if (oc.parentElement !== layer) layer.insertBefore(oc, layer.firstChild);
        this.belowActive = true;
        this.resizeOverlay();
        this.updateCounterTransform();
        this.render();
        return;
      }
    }

    oc.classList.remove("below-nodes");
    oc.style.transform = "";
    oc.style.transformOrigin = "";
    oc.style.width = "";
    oc.style.height = "";
    if (oc.parentElement !== this.wrapperEl) this.wrapperEl.appendChild(oc);
    this.belowActive = false;
    this.resizeOverlay();
    this.render();
  }

  updateCounterTransform(): void {
    if (!this.belowActive || !this.overlayCanvas) return;
    const layer = this.overlayCanvas.parentElement;
    if (!layer) return;
    const t = getComputedStyle(layer).transform;
    if (t && t !== "none") {
      const m = new DOMMatrix(t);
      const s = m.a || 1;
      this.overlayCanvas.style.transform = `scale(${1 / s}) translate(${-m.e}px, ${-m.f}px)`;
    } else {
      this.overlayCanvas.style.transform = "";
    }
  }

  // ---- Public API (used by the Canvas Layers plugin) ------------------

  apiSetBelowNodes(v: boolean): void {
    this.belowNodes = !!v;
    this.applyOverlayStacking();
    void this.save();
  }

  apiGetBelowNodes(): boolean {
    return !!this.belowNodes;
  }

  apiShapeCount(): number {
    return this.shapes.length;
  }

  apiClearShapes(): void {
    if (this.shapes.length === 0) return;
    this.pushOp({ kind: "delete", shapes: this.shapes.slice() });
    this.shapes = [];
    this.render();
    void this.save();
  }

  // ---- Pointer handling ----------------------------------------------

  private startDrag(): void {
    document.addEventListener("mousemove", this.boundOnDocMove);
    document.addEventListener("mouseup", this.boundOnDocUp);
  }

  private stopDrag(): void {
    document.removeEventListener("mousemove", this.boundOnDocMove);
    document.removeEventListener("mouseup", this.boundOnDocUp);
  }

  /** Eraser tolerance in world units, so it feels the same at any zoom. */
  private eraserTolerance(): number {
    return ERASER_RADIUS_PX / Math.max(this.getCamera().scale, 1e-6);
  }

  private eraseAt(world: DrawingPoint): void {
    const tolerance = this.eraserTolerance();
    const survivors: DrawingShape[] = [];
    let removed = false;
    for (const shape of this.shapes) {
      if (hitTestShape(shape, world, tolerance)) {
        this.erasedInStroke.push(shape);
        removed = true;
      } else {
        survivors.push(shape);
      }
    }
    if (removed) {
      this.shapes = survivors;
      this.render();
    }
  }

  onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    const { sx, sy } = this.getPos(e);
    const world = this.screenToWorld(sx, sy);
    this.shiftKey = e.shiftKey;

    if (this.tool === "eraser") {
      this.isDrawing = true;
      this.erasedInStroke = [];
      this.eraseAt(world);
      this.startDrag();
      return;
    }

    this.isDrawing = true;
    this.startDrag();
    this.currentShape = {
      id: this.genId(),
      type: this.tool as ShapeType,
      color: this.color,
      // Stored in world units so the stroke zooms with the canvas. Converting
      // at capture keeps it the chosen on-screen width at the current zoom.
      lineWidth: this.lineWidth / Math.max(this.getCamera().scale, 1e-6),
      points: this.tool === "pencil" ? [world] : [world, world],
    };
    this.render();
  }

  onMouseMove(): void {
    if (this.isDrawing) return;
    this.updateCursor();
  }

  private updateCursor(): void {
    if (!this.overlayCanvas) return;
    if (!this.drawingMode) {
      this.overlayCanvas.style.cursor = "";
      return;
    }
    this.overlayCanvas.style.cursor = this.tool === "eraser" ? "cell" : "crosshair";
  }

  onDocMouseMove(e: MouseEvent): void {
    if (!this.isDrawing) return;
    const { sx, sy } = this.getPos(e);
    const world = this.screenToWorld(sx, sy);
    this.shiftKey = e.shiftKey;

    if (this.tool === "eraser") {
      this.eraseAt(world);
      return;
    }

    const shape = this.currentShape;
    if (!shape) return;

    if (shape.type === "pencil") {
      const pts = shape.points;
      const last = pts[pts.length - 1];
      const dx = world.x - last.x;
      const dy = world.y - last.y;
      // Drop sub-pixel jitter so the trail stays cheap to store and smooth.
      if (dx * dx + dy * dy > 0.25) pts.push(world);
    } else {
      const start = shape.points[0];
      const lockable = shape.type === "line" || shape.type === "arrow";
      shape.points[1] = this.shiftKey && lockable ? snapAngle(start, world) : world;
    }
    this.render();
  }

  onDocMouseUp(): void {
    this.stopDrag();
    if (!this.isDrawing) return;
    this.isDrawing = false;

    if (this.tool === "eraser") {
      if (this.erasedInStroke.length) {
        this.pushOp({ kind: "delete", shapes: this.erasedInStroke });
        void this.save();
      }
      this.erasedInStroke = [];
      return;
    }

    const shape = this.currentShape;
    this.currentShape = null;
    if (shape && isShapeMeaningful(shape)) {
      this.shapes.push(shape);
      this.pushOp({ kind: "add", shapes: [shape] });
      void this.save();
    }
    this.render();
  }

  onWheel(e: WheelEvent): void {
    // Let the canvas underneath handle zoom/pan while the overlay is on top.
    const restore = this.overlayCanvas.style.pointerEvents;
    this.overlayCanvas.style.pointerEvents = "none";
    const target = document.elementFromPoint(e.clientX, e.clientY);
    this.overlayCanvas.style.pointerEvents = restore;
    if (target) {
      target.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaZ: e.deltaZ,
          deltaMode: e.deltaMode,
          clientX: e.clientX,
          clientY: e.clientY,
          ctrlKey: e.ctrlKey,
        })
      );
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.code === "Space" && !e.repeat) {
      this.overlayCanvas.style.pointerEvents = "none";
    }
    if (e.key === "Shift") this.shiftKey = true;

    if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
      if (e.shiftKey) this.redo();
      else this.undo();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyY") {
      this.redo();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.code === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.toggleDrawingMode();
      return;
    }

    // Digits 1-6 pick a tool, as long as no modifier is in play.
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const idx = TOOL_DEFS.findIndex((_, i) => e.code === `Digit${i + 1}`);
      if (idx >= 0) {
        this.setTool(TOOL_DEFS[idx].id);
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }

  onKeyUp(e: KeyboardEvent): void {
    // Escape can turn drawing mode off while Space is still held; restoring
    // pointer-events then would leave the overlay blocking the canvas.
    if (e.code === "Space" && this.drawingMode) {
      this.overlayCanvas.style.pointerEvents = "all";
    }
    if (e.key === "Shift") this.shiftKey = false;
  }

  // ---- Rendering -------------------------------------------------------

  render(): void {
    const { overlayCanvas: canvas, ctx } = this;
    if (!canvas || !ctx || !canvas.width || !canvas.height) return;

    // One camera reading for the whole pass.
    const camera = this.camera.begin();
    try {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(camera.x, camera.y);
      ctx.scale(camera.scale, camera.scale);

      for (const shape of this.shapes) drawShape(ctx, shape);
      if (this.currentShape) drawShape(ctx, this.currentShape);

      ctx.restore();
    } finally {
      this.camera.end();
    }
  }

  // ---- History ---------------------------------------------------------

  private pushOp(op: Operation): void {
    this.undoStack.push(op);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    // A fresh edit invalidates anything that was undone.
    this.redoStack = [];
  }

  private applyInverse(op: Operation): void {
    if (op.kind === "add") {
      const ids = new Set(op.shapes.map((s) => s.id));
      this.shapes = this.shapes.filter((s) => !ids.has(s.id));
    } else {
      this.shapes.push(...op.shapes);
    }
  }

  private applyForward(op: Operation): void {
    if (op.kind === "add") {
      this.shapes.push(...op.shapes);
    } else {
      const ids = new Set(op.shapes.map((s) => s.id));
      this.shapes = this.shapes.filter((s) => !ids.has(s.id));
    }
  }

  undo(): void {
    const op = this.undoStack.pop();
    if (!op) return;
    this.applyInverse(op);
    this.redoStack.push(op);
    this.render();
    void this.save();
  }

  redo(): void {
    const op = this.redoStack.pop();
    if (!op) return;
    this.applyForward(op);
    this.undoStack.push(op);
    this.render();
    void this.save();
  }

  // ---- Persistence ------------------------------------------------------

  private fileKey(): string {
    const view = this.leaf.view as unknown as { file?: { path: string } };
    return view.file?.path ?? "unknown";
  }

  async save(): Promise<void> {
    try {
      const key = this.fileKey();
      const all: CanvasPluginData = (await this.plugin.loadData()) ?? {};
      all.drawings = all.drawings ?? {};
      if (this.shapes.length === 0 && !this.belowNodes) {
        delete all.drawings[key];
      } else {
        all.drawings[key] = { shapes: this.shapes, belowNodes: this.belowNodes };
      }
      await this.plugin.saveData(all);
    } catch (e) {
      console.error("[Rich Canvas] save error", e);
    }
  }

  async saveSettings(): Promise<void> {
    try {
      const all: CanvasPluginData = (await this.plugin.loadData()) ?? {};
      all.settings = { color: this.color, lineWidth: this.lineWidth };
      await this.plugin.saveData(all);
    } catch (e) {
      console.error("[Rich Canvas] settings save error", e);
    }
  }

  /**
   * Bring old shapes forward: drop the `frameId` that used to clip them and
   * give anything without an `id` one, so undo can address it.
   */
  private migrateShapes(raw: unknown): DrawingShape[] {
    if (!Array.isArray(raw)) return [];
    const out: DrawingShape[] = [];
    for (const entry of raw as Array<Record<string, unknown>>) {
      if (!entry || typeof entry !== "object") continue;
      const points = Array.isArray(entry.points) ? (entry.points as DrawingPoint[]) : [];
      const type = entry.type as string;
      const known: ShapeType[] = ["pencil", "line", "arrow", "rect", "ellipse"];
      if (!known.includes(type as ShapeType)) continue;

      // Legacy rect/ellipse stored x/y/width/height instead of two points.
      let pts = points;
      const { x, y, width, height } = entry;
      if (
        pts.length < 2 &&
        typeof x === "number" &&
        typeof y === "number" &&
        typeof width === "number" &&
        typeof height === "number"
      ) {
        pts = [
          { x, y },
          { x: x + width, y: y + height },
        ];
      }
      if (pts.length === 0) continue;

      out.push({
        id: typeof entry.id === "string" ? entry.id : this.genId(),
        type: type as ShapeType,
        color: typeof entry.color === "string" ? entry.color : this.color,
        lineWidth: typeof entry.lineWidth === "number" ? entry.lineWidth : this.lineWidth,
        points: pts,
      });
    }
    return out;
  }

  async load(): Promise<void> {
    let all: CanvasPluginData = {};
    try {
      all = (await this.plugin.loadData()) ?? {};
    } catch (e) {
      console.error("[Rich Canvas] load error", e);
    }
    const key = this.fileKey();

    if (all.settings) {
      if (all.settings.color) this.color = all.settings.color;
      if (all.settings.lineWidth) this.lineWidth = all.settings.lineWidth;
      this.toolbar?.syncSettings();
    }

    let data = all.drawings?.[key];
    if (!data) {
      const legacyPath = key + ".drawings.json";
      try {
        if (await this.app.vault.adapter.exists(legacyPath)) {
          data = JSON.parse(await this.app.vault.adapter.read(legacyPath));
          await this.app.vault.adapter.remove(legacyPath);
        }
      } catch {
        /* a missing or malformed legacy file is not worth surfacing */
      }
    }

    if (data) {
      const hadFrames = Array.isArray(data.frames) && data.frames.length > 0;
      this.shapes = this.migrateShapes(data.shapes);
      this.belowNodes = !!data.belowNodes;
      // Rewrite once so the frame field and missing ids do not linger on disk.
      if (hadFrames || this.shapes.length) void this.save();
    }

    this.applyOverlayStacking();
    this.render();
  }
}
