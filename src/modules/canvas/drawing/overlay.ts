import { App, Plugin, WorkspaceLeaf, setIcon } from "obsidian";

export interface DrawingPoint {
  x: number;
  y: number;
}

export interface DrawingShape {
  type: "pencil" | "rect" | "ellipse";
  color: string;
  lineWidth: number;
  points: DrawingPoint[];
  frameId?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface DrawingFrame {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasPluginData {
  drawings?: Record<
    string,
    {
      shapes?: DrawingShape[];
      frames?: DrawingFrame[];
      belowNodes?: boolean;
    }
  >;
  settings?: {
    color?: string;
    lineWidth?: number;
  };
}

export class CanvasDrawingOverlay {
  leaf: WorkspaceLeaf;
  app: App;
  plugin: Plugin;
  tool: "frame" | "pencil";
  color: string;
  lineWidth: number;
  shapes: DrawingShape[];
  history: string[];
  currentShape: DrawingShape | null;
  isDrawing: boolean;
  frames: DrawingFrame[];
  newFrame: DrawingFrame | null;
  isResizing: boolean;
  resizeHandle: string | null;
  resizeFrame: DrawingFrame | null;
  resizeStart: { frame: DrawingFrame; worldX: number; worldY: number } | null;
  isDrawingFrame: boolean;
  frameStart: DrawingPoint | null;
  drawFrameId: string | null;
  drawingMode: boolean;
  rafId: number | null;
  lastCamera: { x: number; y: number; scale: number } | null;
  belowNodes: boolean;
  _belowActive: boolean;
  selectedFrameId: string | null;

  wrapperEl!: HTMLElement;
  toggleBtn!: HTMLButtonElement;
  overlayCanvas!: HTMLCanvasElement;
  ctx!: CanvasRenderingContext2D | null;
  resizeObserver!: ResizeObserver;
  toolbar!: HTMLElement;
  toolBtns: Record<string, HTMLButtonElement> = {};
  colorPicker!: HTMLInputElement;
  sizeSlider!: HTMLInputElement;

  boundOnMouseDown: (e: MouseEvent) => void;
  boundOnMouseMove: (e: MouseEvent) => void;
  boundOnMouseUp: (e: MouseEvent) => void;
  boundOnDocMove: (e: MouseEvent) => void;
  boundOnDocUp: (e: MouseEvent) => void;
  boundOnWheel: (e: WheelEvent) => void;
  boundOnKeyDown: (e: KeyboardEvent) => void;
  boundOnKeyUp: (e: KeyboardEvent) => void;

  constructor(leaf: WorkspaceLeaf, app: App, plugin: Plugin) {
    this.leaf = leaf;
    this.app = app;
    this.plugin = plugin;
    this.tool = "pencil";
    this.color = "#e63946";
    this.lineWidth = 3;
    this.shapes = [];
    this.history = [];
    this.currentShape = null;
    this.isDrawing = false;
    this.frames = [];
    this.newFrame = null;
    this.isResizing = false;
    this.resizeHandle = null;
    this.resizeFrame = null;
    this.resizeStart = null;
    this.isDrawingFrame = false;
    this.frameStart = null;
    this.drawFrameId = null;
    this.drawingMode = false;
    this.rafId = null;
    this.lastCamera = null;
    this.belowNodes = false;
    this._belowActive = false;
    this.selectedFrameId = null;

    this.boundOnMouseDown = this.onMouseDown.bind(this);
    this.boundOnMouseMove = this.onMouseMove.bind(this);
    this.boundOnMouseUp = this.onMouseUp.bind(this);
    this.boundOnDocMove = this.onDocMouseMove.bind(this);
    this.boundOnDocUp = this.onDocMouseUp.bind(this);
    this.boundOnWheel = this.onWheel.bind(this);
    this.boundOnKeyDown = this.onKeyDown.bind(this);
    this.boundOnKeyUp = this.onKeyUp.bind(this);
  }

  genId(): string {
    return Math.random().toString(36).slice(2, 10);
  }

  attach(): void {
    const canvasView = this.leaf.view as unknown as { containerEl: HTMLElement };
    const wrapperEl =
      canvasView.containerEl.querySelector<HTMLElement>(".canvas-wrapper") ??
      canvasView.containerEl.querySelector<HTMLElement>(".canvas") ??
      canvasView.containerEl;
    this.wrapperEl = wrapperEl;

    // Inject toggle button into the bottom canvas menu
    const menuEl = canvasView.containerEl.querySelector<HTMLElement>(".canvas-menu");
    if (menuEl) {
      const sep = menuEl.createEl("div", {
        cls: "canvas-control-item rich-canvas-menu-sep",
      });
      sep.style.cssText =
        "width:1px;height:20px;background:var(--background-modifier-border);margin:0 4px;align-self:center;";
      this.toggleBtn = menuEl.createEl("button", {
        cls: "canvas-control-item clickable-icon rich-canvas-toggle-btn",
      });
    } else {
      this.toggleBtn = wrapperEl.createEl("button", {
        cls: "rich-canvas-toggle-btn-floating",
      });
    }
    setIcon(this.toggleBtn, "pencil");
    this.toggleBtn.setAttribute("aria-label", "Drawing Mode");
    this.toggleBtn.addEventListener("click", () => this.toggleDrawingMode());

    this.buildToolbar();

    this.overlayCanvas = wrapperEl.createEl("canvas", {
      cls: "rich-canvas-overlay",
    });
    this.ctx = this.overlayCanvas.getContext("2d");

    this.resizeObserver = new ResizeObserver(() => this.resizeOverlay());
    this.resizeObserver.observe(wrapperEl);
    this.resizeOverlay();

    this.load();
    this.startRenderLoop();
  }

  detach(): void {
    this.stopRenderLoop();
    this.stopDrag();
    this.overlayCanvas?.remove();
    this.toggleBtn?.remove();
    this.toggleBtn?.previousElementSibling?.remove();
    this.toolbar?.remove();
    this.resizeObserver?.disconnect();
    this.overlayCanvas?.removeEventListener("mousedown", this.boundOnMouseDown);
    this.overlayCanvas?.removeEventListener("mousemove", this.boundOnMouseMove);
    this.overlayCanvas?.removeEventListener("wheel", this.boundOnWheel);
    document.removeEventListener("keydown", this.boundOnKeyDown, true);
    document.removeEventListener("keyup", this.boundOnKeyUp);
  }

  buildToolbar(): void {
    this.toolbar = this.wrapperEl.createEl("div", { cls: "rich-canvas-toolbar" });

    const tools: Array<{ id: "frame" | "pencil"; emoji: string; title: string }> = [
      { id: "frame", emoji: "🖼", title: "Frame — wajib sebelum menggambar" },
      { id: "pencil", emoji: "✏️", title: "Pen" },
    ];

    this.toolBtns = {};
    for (const t of tools) {
      const btn = this.toolbar.createEl("button", {
        text: t.emoji,
        cls: "rich-canvas-tool-btn",
        title: t.title,
      });
      if (t.id === this.tool) btn.addClass("active");
      btn.addEventListener("click", () => {
        this.tool = t.id;
        for (const b of Object.values(this.toolBtns)) b.removeClass("active");
        btn.addClass("active");
      });
      this.toolBtns[t.id] = btn;
    }

    this.toolbar.createEl("div", { cls: "rich-canvas-sep" });

    const colorPicker = this.toolbar.createEl("input", { cls: "rich-canvas-color" });
    colorPicker.type = "color";
    colorPicker.value = this.color;
    colorPicker.addEventListener("input", () => {
      this.color = colorPicker.value;
    });
    colorPicker.addEventListener("change", () => this.saveSettings());
    this.colorPicker = colorPicker;

    const sizeInput = this.toolbar.createEl("input", {
      cls: "rich-canvas-size",
      title: "Pen size (1–30)",
    });
    sizeInput.type = "number";
    sizeInput.min = "1";
    sizeInput.max = "30";
    sizeInput.step = "1";
    sizeInput.value = String(this.lineWidth);
    const applySize = () => {
      const v = parseInt(sizeInput.value, 10);
      if (isNaN(v)) return;
      this.lineWidth = Math.max(1, Math.min(30, v));
    };
    sizeInput.addEventListener("input", applySize);
    sizeInput.addEventListener("change", () => {
      applySize();
      sizeInput.value = String(this.lineWidth);
      this.saveSettings();
    });
    this.sizeSlider = sizeInput;

    this.toolbar.createEl("div", { cls: "rich-canvas-sep" });

    const undoBtn = this.toolbar.createEl("button", {
      text: "↩",
      cls: "rich-canvas-tool-btn",
      title: "Undo (Ctrl+Z)",
    });
    undoBtn.addEventListener("click", () => this.undo());

    const clearBtn = this.toolbar.createEl("button", {
      text: "🗑",
      cls: "rich-canvas-tool-btn",
      title: "Clear drawings",
    });
    clearBtn.addEventListener("click", () => {
      if (confirm("Hapus semua gambar?")) {
        this.saveHistory();
        this.shapes = [];
        this.frames = [];
        this.render();
        this.save();
      }
    });

    const closeBtn = this.toolbar.createEl("button", {
      text: "✕",
      cls: "rich-canvas-tool-btn",
      title: "Close drawing mode (Esc)",
    });
    closeBtn.addEventListener("click", () => this.toggleDrawingMode());
  }

  toggleDrawingMode(): void {
    this.drawingMode = !this.drawingMode;
    this.toggleBtn.classList.toggle("active", this.drawingMode);
    this.toolbar.classList.toggle("visible", this.drawingMode);

    if (this.drawingMode) {
      this.overlayCanvas.classList.add("active");
      const menuEl = (this.leaf.view as unknown as { containerEl: HTMLElement }).containerEl.querySelector<HTMLElement>(".canvas-menu");
      if (menuEl) menuEl.style.zIndex = "1001";
      this.overlayCanvas.addEventListener("mousedown", this.boundOnMouseDown);
      this.overlayCanvas.addEventListener("mousemove", this.boundOnMouseMove);
      this.overlayCanvas.addEventListener("wheel", this.boundOnWheel);
      document.addEventListener("keydown", this.boundOnKeyDown, true);
      document.addEventListener("keyup", this.boundOnKeyUp);
    } else {
      this.overlayCanvas.classList.remove("active");
      const menuEl = (this.leaf.view as unknown as { containerEl: HTMLElement }).containerEl.querySelector<HTMLElement>(".canvas-menu");
      if (menuEl) menuEl.style.zIndex = "";
      this.overlayCanvas.removeEventListener("mousedown", this.boundOnMouseDown);
      this.overlayCanvas.removeEventListener("mousemove", this.boundOnMouseMove);
      this.overlayCanvas.removeEventListener("wheel", this.boundOnWheel);
      document.removeEventListener("mousemove", this.boundOnDocMove);
      document.removeEventListener("mouseup", this.boundOnDocUp);
      document.removeEventListener("keydown", this.boundOnKeyDown, true);
      document.removeEventListener("keyup", this.boundOnKeyUp);
    }
    this.applyOverlayStacking();
  }

  startRenderLoop(): void {
    if (this.rafId) return;
    const loop = () => {
      const cam = this.getCamera();
      const prev = this.lastCamera;
      if (!prev || cam.x !== prev.x || cam.y !== prev.y || cam.scale !== prev.scale) {
        this.lastCamera = cam;
        if (this._belowActive) this.updateCounterTransform();
        this.render();
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
    if (this._belowActive) {
      this.overlayCanvas.style.width = w + "px";
      this.overlayCanvas.style.height = h + "px";
    }
    this.render();
  }

  getCamera(): { x: number; y: number; scale: number } {
    const canvasView = this.leaf.view as unknown as { canvas?: { posFromClient?: (pt: { x: number; y: number }) => { x: number; y: number } } };
    const canvas = canvasView?.canvas;
    const orr = this.overlayCanvas.getBoundingClientRect();

    if (canvas && typeof canvas.posFromClient === "function") {
      try {
        const p0 = canvas.posFromClient({ x: orr.left, y: orr.top });
        const p1 = canvas.posFromClient({ x: orr.left + 200, y: orr.top + 200 });
        const dwx = p1.x - p0.x;
        const dwy = p1.y - p0.y;
        if (dwx > 1e-9 && dwy > 1e-9) {
          const scale = 200 / dwx;
          return { x: -p0.x * scale, y: -p0.y * scale, scale };
        }
      } catch {
        /* fallback to DOM */
      }
    }

    const contentEl = this.wrapperEl.querySelector<HTMLElement>(
      '.canvas-nodes, .canvas-edges, [class*="canvas-layer"]'
    );
    if (contentEl) {
      const style = window.getComputedStyle(contentEl);
      if (style.transform && style.transform !== "none") {
        const m = new DOMMatrix(style.transform);
        if (m.a > 0) {
          const cr = contentEl.getBoundingClientRect();
          return { x: cr.left - orr.left, y: cr.top - orr.top, scale: m.a };
        }
      }
    }
    return { x: 0, y: 0, scale: 1 };
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

  getFrameAt(wx: number, wy: number): DrawingFrame | null {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frames[i];
      if (wx >= f.x && wx <= f.x + f.width && wy >= f.y && wy <= f.y + f.height) return f;
    }
    return null;
  }

  getHandles(frame: DrawingFrame): Record<string, DrawingPoint> {
    const { x, y, width: w, height: h } = frame;
    return {
      tl: { x, y },
      tm: { x: x + w / 2, y },
      tr: { x: x + w, y },
      ml: { x, y: y + h / 2 },
      mr: { x: x + w, y: y + h / 2 },
      bl: { x, y: y + h },
      bm: { x: x + w / 2, y: y + h },
      br: { x: x + w, y: y + h },
    };
  }

  hitTestHandle(sx: number, sy: number): { frame: DrawingFrame; name: string } | null {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const frame = this.frames[i];
      for (const [name, pt] of Object.entries(this.getHandles(frame))) {
        const { sx: hsx, sy: hsy } = this.worldToScreen(pt.x, pt.y);
        if (Math.hypot(sx - hsx, sy - hsy) <= 7) return { frame, name };
      }
    }
    return null;
  }

  deleteBtnCenter(frame: DrawingFrame): { x: number; y: number } {
    const { sx, sy } = this.worldToScreen(frame.x + frame.width, frame.y);
    return { x: sx + 14, y: sy - 14 };
  }

  hitTestDelete(sx: number, sy: number): DrawingFrame | null {
    if (!this.drawingMode) return null;
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const c = this.deleteBtnCenter(this.frames[i]);
      if (Math.hypot(sx - c.x, sy - c.y) <= 11) return this.frames[i];
    }
    return null;
  }

  deleteFrame(frame: DrawingFrame): void {
    this.saveHistory();
    this.frames = this.frames.filter((f) => f !== frame);
    this.shapes = this.shapes.filter((s) => s.frameId !== frame.id);
    if (this.selectedFrameId === frame.id) this.selectedFrameId = null;
    this.render();
    this.save();
  }

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
        this._belowActive = true;
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
    this._belowActive = false;
    this.resizeOverlay();
    this.render();
  }

  updateCounterTransform(): void {
    if (!this._belowActive || !this.overlayCanvas) return;
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

  // ---- Public API (used by the Canvas Layers plugin) ----------------

  apiListFrames(): Array<{ id: string; label: string; strokeCount: number; selected: boolean }> {
    const total = this.frames.length;
    return this.frames
      .slice()
      .reverse()
      .map((f, i) => ({
        id: f.id,
        label: "Frame " + (total - i),
        strokeCount: this.shapes.filter((s) => s.frameId === f.id).length,
        selected: f.id === this.selectedFrameId,
      }));
  }

  apiFocusFrame(id: string): void {
    const f = this.frames.find((fr) => fr.id === id);
    if (!f) return;
    this.selectedFrameId = id;
    this.render();
    const canvasView = this.leaf?.view as unknown as { canvas?: { zoomToBbox?: (box: { minX: number; minY: number; maxX: number; maxY: number }) => void } };
    const canvas = canvasView?.canvas;
    try {
      if (canvas && typeof canvas.zoomToBbox === "function") {
        const pad = 40;
        canvas.zoomToBbox({
          minX: f.x - pad,
          minY: f.y - pad,
          maxX: f.x + f.width + pad,
          maxY: f.y + f.height + pad,
        });
      }
    } catch {
      /* zoom is best-effort */
    }
  }

  apiClearFrameSelection(): void {
    if (this.selectedFrameId !== null) {
      this.selectedFrameId = null;
      this.render();
    }
  }

  apiDeleteFrame(id: string): void {
    const f = this.frames.find((fr) => fr.id === id);
    if (f) this.deleteFrame(f);
  }

  apiMoveFrame(id: string, dir: number): void {
    const arr = this.frames;
    const idx = arr.findIndex((f) => f.id === id);
    if (idx < 0) return;
    const target = dir < 0 ? idx + 1 : idx - 1;
    if (target < 0 || target >= arr.length) return;
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    this.render();
    this.save();
  }

  apiSetBelowNodes(v: boolean): void {
    this.belowNodes = !!v;
    this.applyOverlayStacking();
    this.save();
  }

  apiGetBelowNodes(): boolean {
    return !!this.belowNodes;
  }

  apiGetFrameOrder(): string[] {
    return this.frames.map((f) => f.id);
  }

  apiSetFrameOrder(ids: string[]): void {
    const map = new Map(this.frames.map((f) => [f.id, f]));
    const out: DrawingFrame[] = [];
    for (const id of ids) {
      if (map.has(id)) {
        out.push(map.get(id)!);
        map.delete(id);
      }
    }
    for (const f of map.values()) out.push(f);
    this.frames = out;
    this.render();
    this.save();
  }

  getResizeCursor(handle: string): string {
    const map: Record<string, string> = {
      tl: "nwse-resize",
      br: "nwse-resize",
      tr: "nesw-resize",
      bl: "nesw-resize",
      tm: "ns-resize",
      bm: "ns-resize",
      ml: "ew-resize",
      mr: "ew-resize",
    };
    return map[handle] || "default";
  }

  applyResize(sx: number, sy: number): void {
    if (!this.resizeStart || !this.resizeFrame || !this.resizeHandle) return;
    const { x: wx, y: wy } = this.screenToWorld(sx, sy);
    const { frame: start, worldX: startWx, worldY: startWy } = this.resizeStart;
    const dx = wx - startWx;
    const dy = wy - startWy;
    const MIN = 50;
    const f = { ...start };
    switch (this.resizeHandle) {
      case "tl":
        f.x = start.x + dx;
        f.y = start.y + dy;
        f.width = start.width - dx;
        f.height = start.height - dy;
        break;
      case "tm":
        f.y = start.y + dy;
        f.height = start.height - dy;
        break;
      case "tr":
        f.y = start.y + dy;
        f.width = start.width + dx;
        f.height = start.height - dy;
        break;
      case "ml":
        f.x = start.x + dx;
        f.width = start.width - dx;
        break;
      case "mr":
        f.width = start.width + dx;
        break;
      case "bl":
        f.x = start.x + dx;
        f.width = start.width - dx;
        f.height = start.height + dy;
        break;
      case "bm":
        f.height = start.height + dy;
        break;
      case "br":
        f.width = start.width + dx;
        f.height = start.height + dy;
        break;
    }
    if (f.width < MIN) {
      f.width = MIN;
      if (["tl", "ml", "bl"].includes(this.resizeHandle)) f.x = start.x + start.width - MIN;
    }
    if (f.height < MIN) {
      f.height = MIN;
      if (["tl", "tm", "tr"].includes(this.resizeHandle)) f.y = start.y + start.height - MIN;
    }
    Object.assign(this.resizeFrame, f);
  }

  startDrag(): void {
    document.addEventListener("mousemove", this.boundOnDocMove);
    document.addEventListener("mouseup", this.boundOnDocUp);
  }

  stopDrag(): void {
    document.removeEventListener("mousemove", this.boundOnDocMove);
    document.removeEventListener("mouseup", this.boundOnDocUp);
  }

  onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    const { sx, sy } = this.getPos(e);
    const { x: wx, y: wy } = this.screenToWorld(sx, sy);

    const delFrame = this.hitTestDelete(sx, sy);
    if (delFrame) {
      this.deleteFrame(delFrame);
      return;
    }

    if (this.tool === "frame") {
      this.isDrawingFrame = true;
      this.frameStart = { x: wx, y: wy };
      this.newFrame = { id: this.genId(), x: wx, y: wy, width: 0, height: 0 };
      this.startDrag();
      return;
    }

    const hit = this.hitTestHandle(sx, sy);
    if (hit) {
      this.saveHistory();
      this.isResizing = true;
      this.resizeHandle = hit.name;
      this.resizeFrame = hit.frame;
      this.resizeStart = { frame: { ...hit.frame }, worldX: wx, worldY: wy };
      this.startDrag();
      return;
    }

    const frame = this.getFrameAt(wx, wy);
    if (!frame) return;

    this.isDrawing = true;
    this.drawFrameId = frame.id;
    this.saveHistory();
    this.startDrag();
    this.currentShape = {
      type: "pencil",
      color: this.color,
      lineWidth: this.lineWidth,
      points: [{ x: wx, y: wy }],
      frameId: frame.id,
    };
  }

  onMouseMove(e: MouseEvent): void {
    if (this.isDrawingFrame || this.isResizing || this.isDrawing) return;
    const { sx, sy } = this.getPos(e);
    if (this.hitTestDelete(sx, sy)) {
      this.overlayCanvas.style.cursor = "pointer";
      return;
    }
    if (this.tool === "frame") {
      this.overlayCanvas.style.cursor = "crosshair";
      return;
    }
    const hit = this.hitTestHandle(sx, sy);
    if (hit) {
      this.overlayCanvas.style.cursor = this.getResizeCursor(hit.name);
    } else {
      const { x: wx, y: wy } = this.screenToWorld(sx, sy);
      this.overlayCanvas.style.cursor = this.getFrameAt(wx, wy) ? "crosshair" : "default";
    }
  }

  onDocMouseMove(e: MouseEvent): void {
    const { sx, sy } = this.getPos(e);

    if (this.isDrawingFrame && this.frameStart) {
      const { x: wx, y: wy } = this.screenToWorld(sx, sy);
      this.newFrame = {
        id: this.newFrame!.id,
        x: Math.min(this.frameStart.x, wx),
        y: Math.min(this.frameStart.y, wy),
        width: Math.abs(wx - this.frameStart.x),
        height: Math.abs(wy - this.frameStart.y),
      };
      this.render();
      return;
    }

    if (this.isResizing) {
      this.applyResize(sx, sy);
      this.render();
      return;
    }

    if (this.isDrawing && this.currentShape) {
      const { x: wx, y: wy } = this.screenToWorld(sx, sy);
      const pts = this.currentShape.points;
      const last = pts[pts.length - 1];
      const dx = wx - last.x;
      const dy = wy - last.y;
      if (dx * dx + dy * dy > 0.25) pts.push({ x: wx, y: wy });
      this.render();
    }
  }

  onDocMouseUp(): void {
    this.stopDrag();

    if (this.isDrawingFrame) {
      this.isDrawingFrame = false;
      this.frameStart = null;
      const nf = this.newFrame;
      this.newFrame = null;
      if (nf && nf.width >= 20 && nf.height >= 20) {
        this.saveHistory();
        this.frames.push(nf);
        this.save();
        this.tool = "pencil";
        for (const b of Object.values(this.toolBtns)) b.removeClass("active");
        this.toolBtns["pencil"]?.addClass("active");
      }
      this.render();
      return;
    }

    if (this.isResizing) {
      this.isResizing = false;
      this.resizeHandle = null;
      this.resizeFrame = null;
      this.resizeStart = null;
      this.save();
      return;
    }

    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.drawFrameId = null;
    if (this.currentShape) {
      const s = this.currentShape;
      const keep = s.points.length > 2;
      if (keep) {
        this.shapes.push(s);
        this.save();
      } else {
        this.history.pop();
      }
      this.currentShape = null;
      this.render();
    }
  }

  onMouseUp(): void {}

  onWheel(e: WheelEvent): void {
    this.overlayCanvas.style.pointerEvents = "none";
    const target = document.elementFromPoint(e.clientX, e.clientY);
    this.overlayCanvas.style.pointerEvents = "all";
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
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
      this.undo();
      e.preventDefault();
      e.stopPropagation();
    }
    if (e.code === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.toggleDrawingMode();
    }
  }

  onKeyUp(e: KeyboardEvent): void {
    if (e.code === "Space") {
      this.overlayCanvas.style.pointerEvents = "all";
    }
  }

  drawShape(ctx: CanvasRenderingContext2D, shape: DrawingShape, scale: number): void {
    ctx.strokeStyle = shape.color;
    ctx.lineWidth = shape.lineWidth / scale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (shape.type === "pencil") {
      const pts = shape.points;
      if (pts.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.stroke();
    } else if (shape.type === "rect" && shape.x != null && shape.y != null && shape.width != null && shape.height != null) {
      ctx.beginPath();
      ctx.rect(shape.x, shape.y, shape.width, shape.height);
      ctx.stroke();
    } else if (shape.type === "ellipse" && shape.x != null && shape.y != null && shape.width != null && shape.height != null) {
      const rx = Math.abs(shape.width / 2);
      const ry = Math.abs(shape.height / 2);
      if (rx < 0.5 || ry < 0.5) return;
      ctx.beginPath();
      ctx.ellipse(shape.x + shape.width / 2, shape.y + shape.height / 2, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  render(): void {
    const { overlayCanvas: canvas, ctx } = this;
    if (!canvas || !ctx || !canvas.width || !canvas.height) return;

    const camera = this.getCamera();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.scale, camera.scale);

    for (const frame of this.frames) {
      if (this.drawingMode) {
        ctx.fillStyle = "rgba(255,255,255,0.015)";
        ctx.fillRect(frame.x, frame.y, frame.width, frame.height);
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(frame.x, frame.y, frame.width, frame.height);
      ctx.clip();
      for (const shape of this.shapes) {
        if (shape.frameId === frame.id) this.drawShape(ctx, shape, camera.scale);
      }
      if (this.currentShape && this.currentShape.frameId === frame.id) {
        this.drawShape(ctx, this.currentShape, camera.scale);
      }
      ctx.restore();

      if (frame.id === this.selectedFrameId) {
        ctx.strokeStyle = "#f5a623";
        ctx.lineWidth = 2.5 / camera.scale;
        ctx.strokeRect(frame.x, frame.y, frame.width, frame.height);
      }

      if (this.drawingMode) {
        ctx.strokeStyle = "rgba(26,115,232,0.5)";
        ctx.lineWidth = 2 / camera.scale;
        ctx.setLineDash([8 / camera.scale, 4 / camera.scale]);
        ctx.strokeRect(frame.x, frame.y, frame.width, frame.height);
        ctx.setLineDash([]);

        const size = 8 / camera.scale;
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#1a73e8";
        ctx.lineWidth = 1.5 / camera.scale;
        for (const pt of Object.values(this.getHandles(frame))) {
          ctx.fillRect(pt.x - size / 2, pt.y - size / 2, size, size);
          ctx.strokeRect(pt.x - size / 2, pt.y - size / 2, size, size);
        }
      }
    }

    if (this.newFrame) {
      const f = this.newFrame;
      ctx.strokeStyle = "#1a73e8";
      ctx.lineWidth = 2 / camera.scale;
      ctx.strokeRect(f.x, f.y, f.width, f.height);
    }

    ctx.restore();

    if (this.drawingMode) {
      for (const frame of this.frames) {
        const c = this.deleteBtnCenter(frame);
        ctx.beginPath();
        ctx.arc(c.x, c.y, 9, 0, Math.PI * 2);
        ctx.fillStyle = "#e5484d";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(c.x - 3.5, c.y - 3.5);
        ctx.lineTo(c.x + 3.5, c.y + 3.5);
        ctx.moveTo(c.x + 3.5, c.y - 3.5);
        ctx.lineTo(c.x - 3.5, c.y + 3.5);
        ctx.stroke();
      }
    }

    if (this.frames.length === 0 && !this.newFrame && this.drawingMode) {
      ctx.fillStyle = "rgba(26,115,232,0.06)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(30,30,30,0.65)";
      ctx.font = "13px var(--font-interface, system-ui, sans-serif)";
      ctx.textAlign = "center";
      ctx.fillText(
        "Pilih 🖼 Frame lalu drag untuk membuat area gambar",
        canvas.width / 2,
        canvas.height / 2
      );
      ctx.textAlign = "left";
    }
  }

  saveHistory(): void {
    this.history.push(JSON.stringify({ shapes: this.shapes, frames: this.frames }));
    if (this.history.length > 50) this.history.shift();
  }

  undo(): void {
    if (!this.history.length) return;
    const snap = JSON.parse(this.history.pop()!);
    this.shapes = snap.shapes ?? [];
    this.frames = snap.frames ?? [];
    this.render();
    this.save();
  }

  async save(): Promise<void> {
    try {
      const canvasView = this.leaf.view as unknown as { file?: { path: string } };
      const key = canvasView.file?.path ?? "unknown";
      const all: CanvasPluginData = (await this.plugin.loadData()) ?? {};
      all.drawings = all.drawings ?? {};
      if (this.shapes.length === 0 && this.frames.length === 0 && !this.belowNodes) {
        delete all.drawings[key];
      } else {
        all.drawings[key] = {
          shapes: this.shapes,
          frames: this.frames,
          belowNodes: this.belowNodes,
        };
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

  async load(): Promise<void> {
    let all: CanvasPluginData = {};
    try {
      all = (await this.plugin.loadData()) ?? {};
    } catch (e) {
      console.error("[Rich Canvas] load error", e);
    }
    const canvasView = this.leaf.view as unknown as { file?: { path: string } };
    const key = canvasView.file?.path ?? "unknown";

    if (all.settings) {
      if (all.settings.color) this.color = all.settings.color;
      if (all.settings.lineWidth) this.lineWidth = all.settings.lineWidth;
      if (this.colorPicker) this.colorPicker.value = this.color;
      if (this.sizeSlider) this.sizeSlider.value = String(this.lineWidth);
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
        /* ignore */
      }
    }

    if (data) {
      this.shapes = data.shapes ?? [];
      this.belowNodes = !!data.belowNodes;
      if (Array.isArray(data.frames)) {
        this.frames = data.frames;
      } else if ((data as unknown as { frame?: DrawingFrame }).frame) {
        const f = { id: this.genId(), ...(data as unknown as { frame: DrawingFrame }).frame };
        this.frames = [f];
        for (const s of this.shapes) if (!s.frameId) s.frameId = f.id;
      } else {
        this.frames = [];
      }
      if (this.shapes.length || this.frames.length) this.save();
    }

    this.applyOverlayStacking();
    this.render();
  }
}
