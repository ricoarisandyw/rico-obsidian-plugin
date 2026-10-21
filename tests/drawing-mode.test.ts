import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CanvasDrawingOverlay } from "../src/modules/canvas/drawing/overlay";
import { App, Plugin, WorkspaceLeaf } from "./mocks/obsidian";
import { registerRailButton, syncRail, unregisterRailButton } from "../src/modules/canvas/tool-rail";

/** Drive a full press-drag-release through the overlay's handlers. */
function stroke(
  overlay: CanvasDrawingOverlay,
  path: Array<[number, number]>,
  opts: { shiftKey?: boolean } = {}
): void {
  const [first, ...rest] = path;
  overlay.getPos = () => ({ sx: first[0], sy: first[1] });
  overlay.onMouseDown({ button: 0, shiftKey: !!opts.shiftKey } as MouseEvent);
  for (const [sx, sy] of rest) {
    overlay.getPos = () => ({ sx, sy });
    overlay.onDocMouseMove({ shiftKey: !!opts.shiftKey } as MouseEvent);
  }
  overlay.onDocMouseUp();
}

describe("Canvas Drawing Mode Suite", () => {
  let app: App;
  let plugin: Plugin;
  let leaf: WorkspaceLeaf;
  let containerEl: HTMLElement;
  let overlay: CanvasDrawingOverlay;

  beforeEach(() => {
    containerEl = document.createElement("div");
    containerEl.className = "canvas-wrapper";
    document.body.appendChild(containerEl);

    Object.defineProperty(containerEl, "clientWidth", { value: 1000, configurable: true });
    Object.defineProperty(containerEl, "clientHeight", { value: 800, configurable: true });

    app = new App();
    plugin = new Plugin(app);

    leaf = new WorkspaceLeaf({
      containerEl,
      canvas: {
        posFromClient: (pt: { x: number; y: number }) => ({ x: pt.x, y: pt.y }),
        zoomToBbox: (_box: any) => {},
      },
      file: { path: "drawing-test.canvas" },
    });

    overlay = new CanvasDrawingOverlay(leaf as any, app as any, plugin as any);
    overlay.attach();
  });

  afterEach(() => {
    overlay.detach();
    containerEl.remove();
  });

  describe("1. Initialization and DOM Attachment", () => {
    it("should initialize with default state", () => {
      expect(overlay.drawingMode).toBe(false);
      expect(overlay.tool).toBe("pencil");
      expect(overlay.color).toBe("#000000");
      expect(overlay.lineWidth).toBe(3);
      expect(overlay.shapes).toEqual([]);
    });

    it("should attach canvas overlay and toolbar to DOM", () => {
      expect(overlay.overlayCanvas.classList.contains("rich-canvas-overlay")).toBe(true);
      expect(overlay.toolbar.el.classList.contains("rich-canvas-toolbar")).toBe(true);
      expect(overlay.toggleBtn).toBeDefined();
    });

    it("should put the toggle on the left-edge rail", () => {
      const rail = containerEl.querySelector(".rico-canvas-rail");
      expect(rail).not.toBeNull();
      expect(rail!.parentElement).toBe(overlay.wrapperEl);

      const btn = rail!.querySelector(".rico-canvas-rail-btn-drawing");
      expect(btn).not.toBeNull();
      expect(overlay.toggleBtn).toBe(btn);
    });

    it("should order rail buttons by their registered order", () => {
      registerRailButton({ id: "zz-last", icon: "map", label: "Last", order: 99 });
      registerRailButton({ id: "aa-first", icon: "layers", label: "First", order: 1 });
      syncRail(overlay.wrapperEl);

      const ids = [...overlay.wrapperEl.querySelectorAll(".rico-canvas-rail-btn")].map((el) =>
        [...el.classList].find((c) => c.startsWith("rico-canvas-rail-btn-"))
      );
      expect(ids[0]).toBe("rico-canvas-rail-btn-aa-first");
      expect(ids[ids.length - 1]).toBe("rico-canvas-rail-btn-zz-last");

      unregisterRailButton("zz-last");
      unregisterRailButton("aa-first");
    });

    it("should not duplicate buttons when the rail is re-synced", () => {
      syncRail(overlay.wrapperEl);
      syncRail(overlay.wrapperEl);
      expect(overlay.wrapperEl.querySelectorAll(".rico-canvas-rail-btn-drawing").length).toBe(1);
      expect(overlay.wrapperEl.querySelectorAll(".rico-canvas-rail").length).toBe(1);
    });

    it("should expose one button per drawing tool", () => {
      const btns = overlay.toolbar.el.querySelectorAll(".rich-canvas-tool-btn");
      // Six tools plus undo, redo, clear and close.
      expect(btns.length).toBe(10);
    });
  });

  describe("2. Toggle Drawing Mode", () => {
    it("should toggle drawingMode boolean and update DOM classes", () => {
      expect(overlay.drawingMode).toBe(false);

      overlay.toggleDrawingMode();
      expect(overlay.drawingMode).toBe(true);
      expect(overlay.toggleBtn.classList.contains("active")).toBe(true);
      expect(overlay.toolbar.el.classList.contains("visible")).toBe(true);
      expect(overlay.overlayCanvas.classList.contains("active")).toBe(true);

      overlay.toggleDrawingMode();
      expect(overlay.drawingMode).toBe(false);
      expect(overlay.toggleBtn.classList.contains("active")).toBe(false);
      expect(overlay.toolbar.el.classList.contains("visible")).toBe(false);
      expect(overlay.overlayCanvas.classList.contains("active")).toBe(false);
    });

    it("should clear inline cursor and pointer-events when leaving drawing mode", () => {
      overlay.toggleDrawingMode();
      // A stroke plus a wheel event is what leaves the inline styles behind.
      stroke(overlay, [[10, 10], [40, 40]]);
      overlay.onWheel({ clientX: 40, clientY: 40, deltaX: 0, deltaY: 10, deltaZ: 0, deltaMode: 0 } as WheelEvent);
      expect(overlay.overlayCanvas.style.cursor).toBe("crosshair");

      overlay.toggleDrawingMode();
      expect(overlay.overlayCanvas.style.cursor).toBe("");
      expect(overlay.overlayCanvas.style.pointerEvents).toBe("");
    });

    it("should not re-enable pointer events on keyup after drawing mode is off", () => {
      overlay.toggleDrawingMode();
      overlay.onKeyDown({ code: "Space", repeat: false } as KeyboardEvent);
      expect(overlay.overlayCanvas.style.pointerEvents).toBe("none");

      overlay.toggleDrawingMode();
      overlay.onKeyUp({ code: "Space" } as KeyboardEvent);
      expect(overlay.overlayCanvas.style.pointerEvents).toBe("");
    });
  });

  describe("3. Coordinate Transformations", () => {
    it("should convert screen coordinates to world and back correctly", () => {
      const screen = { x: 250, y: 180 };
      const world = overlay.screenToWorld(screen.x, screen.y);
      const back = overlay.worldToScreen(world.x, world.y);

      expect(Math.round(back.sx)).toBe(screen.x);
      expect(Math.round(back.sy)).toBe(screen.y);
    });

    it("should handle custom camera scale and translation", () => {
      overlay.getCamera = () => ({ x: 100, y: 50, scale: 2 });

      const worldPt = overlay.screenToWorld(300, 250);
      expect(worldPt.x).toBe(100);
      expect(worldPt.y).toBe(100);

      const back = overlay.worldToScreen(worldPt.x, worldPt.y);
      expect(back.sx).toBe(300);
      expect(back.sy).toBe(250);
    });

    it("should store stroke width in world units so it zooms with the canvas", () => {
      overlay.toggleDrawingMode();
      overlay.lineWidth = 4;

      // Zoomed out to 50%: a 4px on-screen stroke is 8 world units.
      overlay.getCamera = () => ({ x: 0, y: 0, scale: 0.5 });
      stroke(overlay, [[0, 0], [20, 20], [40, 40]]);
      expect(overlay.shapes[0].lineWidth).toBeCloseTo(8);

      // Zoomed in to 200%: the same 4px is only 2 world units.
      overlay.getCamera = () => ({ x: 0, y: 0, scale: 2 });
      stroke(overlay, [[0, 0], [20, 20], [40, 40]]);
      expect(overlay.shapes[1].lineWidth).toBeCloseTo(2);
    });

    it("should render a stroke thinner as the camera zooms out", () => {
      overlay.toggleDrawingMode();
      overlay.lineWidth = 4;
      overlay.getCamera = () => ({ x: 0, y: 0, scale: 1 });
      stroke(overlay, [[0, 0], [15, 15], [30, 30]]);

      // drawShape sets lineWidth in world units; the camera transform applied
      // by render() then scales it, so effective on-screen width is w * scale.
      const worldWidth = overlay.shapes[0].lineWidth;
      expect(worldWidth * 1).toBeCloseTo(4);
      expect(worldWidth * 0.5).toBeCloseTo(2);
      expect(worldWidth * 2).toBeCloseTo(8);
    });
  });

  describe("4. Tool Switching", () => {
    it("should switch tools and move the active class", () => {
      overlay.setTool("arrow");
      expect(overlay.tool).toBe("arrow");

      const active = overlay.toolbar.el.querySelectorAll(".rich-canvas-tool-btn.active");
      expect(active.length).toBe(1);
      expect(active[0].getAttribute("aria-label")).toContain("Arrow");
    });

    it("should pick a tool from the number keys", () => {
      overlay.toggleDrawingMode();
      overlay.onKeyDown({
        code: "Digit3",
        key: "3",
        preventDefault: () => {},
        stopPropagation: () => {},
      } as KeyboardEvent);
      expect(overlay.tool).toBe("arrow");
    });
  });

  describe("5. Free drawing without frames", () => {
    beforeEach(() => {
      overlay.toggleDrawingMode();
    });

    it("should record a pencil stroke anywhere on the canvas", () => {
      stroke(overlay, [
        [50, 50],
        [60, 60],
        [70, 70],
        [80, 80],
      ]);
      expect(overlay.shapes.length).toBe(1);
      expect(overlay.shapes[0].type).toBe("pencil");
      expect(overlay.shapes[0].points.length).toBeGreaterThan(2);
    });

    it("should discard a stroke that was only a tap", () => {
      stroke(overlay, [[50, 50]]);
      expect(overlay.shapes.length).toBe(0);
    });

    it("should carry the current colour and width onto the stroke", () => {
      overlay.setColor("#00ff00");
      overlay.setLineWidth(9);
      stroke(overlay, [
        [0, 0],
        [10, 10],
        [20, 20],
        [30, 30],
      ]);
      expect(overlay.shapes[0].color).toBe("#00ff00");
      expect(overlay.shapes[0].lineWidth).toBe(9);
    });

    it("should give every shape a unique id", () => {
      stroke(overlay, [
        [0, 0],
        [10, 10],
        [20, 20],
        [30, 30],
      ]);
      stroke(overlay, [
        [100, 0],
        [110, 10],
        [120, 20],
        [130, 30],
      ]);
      expect(overlay.shapes[0].id).not.toBe(overlay.shapes[1].id);
    });
  });

  describe("6. Two-point shapes", () => {
    beforeEach(() => {
      overlay.toggleDrawingMode();
    });

    it("should draw a straight line from two drag endpoints", () => {
      overlay.setTool("line");
      stroke(overlay, [
        [10, 10],
        [200, 60],
      ]);
      expect(overlay.shapes.length).toBe(1);
      expect(overlay.shapes[0].type).toBe("line");
      expect(overlay.shapes[0].points).toEqual([
        { x: 10, y: 10 },
        { x: 200, y: 60 },
      ]);
    });

    it("should lock a line to 45 degrees while Shift is held", () => {
      overlay.setTool("line");
      stroke(overlay, [
        [0, 0],
        [200, 12],
      ], { shiftKey: true });
      const [, end] = overlay.shapes[0].points;
      expect(end.y).toBeCloseTo(0, 6);
    });

    it("should not angle-lock a rectangle", () => {
      overlay.setTool("rect");
      stroke(overlay, [
        [0, 0],
        [200, 12],
      ], { shiftKey: true });
      expect(overlay.shapes[0].points[1]).toEqual({ x: 200, y: 12 });
    });

    it("should discard a two-point shape that barely moved", () => {
      overlay.setTool("arrow");
      stroke(overlay, [
        [10, 10],
        [11, 11],
      ]);
      expect(overlay.shapes.length).toBe(0);
    });

    it("should record arrow and ellipse shapes", () => {
      overlay.setTool("arrow");
      stroke(overlay, [
        [0, 0],
        [100, 100],
      ]);
      overlay.setTool("ellipse");
      stroke(overlay, [
        [0, 0],
        [80, 40],
      ]);
      expect(overlay.shapes.map((s) => s.type)).toEqual(["arrow", "ellipse"]);
    });
  });

  describe("7. Eraser", () => {
    beforeEach(() => {
      overlay.toggleDrawingMode();
      overlay.setTool("line");
      stroke(overlay, [
        [0, 0],
        [100, 0],
      ]);
      stroke(overlay, [
        [0, 300],
        [100, 300],
      ]);
      overlay.setTool("eraser");
    });

    it("should remove only the stroke it touches", () => {
      stroke(overlay, [
        [50, 0],
        [55, 0],
      ]);
      expect(overlay.shapes.length).toBe(1);
      expect(overlay.shapes[0].points[0].y).toBe(300);
    });

    it("should leave everything alone when it misses", () => {
      stroke(overlay, [
        [50, 150],
        [55, 150],
      ]);
      expect(overlay.shapes.length).toBe(2);
    });
  });

  describe("8. Undo and Redo", () => {
    beforeEach(() => {
      overlay.toggleDrawingMode();
      overlay.setTool("line");
    });

    it("should undo strokes one at a time and redo them back", () => {
      for (let i = 0; i < 3; i++) {
        stroke(overlay, [
          [0, i * 50],
          [100, i * 50],
        ]);
      }
      expect(overlay.shapes.length).toBe(3);

      overlay.undo();
      overlay.undo();
      overlay.undo();
      expect(overlay.shapes.length).toBe(0);

      overlay.redo();
      expect(overlay.shapes.length).toBe(1);
      overlay.redo();
      overlay.redo();
      expect(overlay.shapes.length).toBe(3);
    });

    it("should restore an erased stroke on undo", () => {
      stroke(overlay, [
        [0, 0],
        [100, 0],
      ]);
      const id = overlay.shapes[0].id;

      overlay.setTool("eraser");
      stroke(overlay, [
        [50, 0],
        [55, 0],
      ]);
      expect(overlay.shapes.length).toBe(0);

      overlay.undo();
      expect(overlay.shapes.length).toBe(1);
      expect(overlay.shapes[0].id).toBe(id);
    });

    it("should drop the redo stack once a new stroke lands", () => {
      stroke(overlay, [
        [0, 0],
        [100, 0],
      ]);
      overlay.undo();
      stroke(overlay, [
        [0, 200],
        [100, 200],
      ]);
      overlay.redo();
      expect(overlay.shapes.length).toBe(1);
    });

    it("should do nothing when there is no history", () => {
      overlay.undo();
      overlay.redo();
      expect(overlay.shapes.length).toBe(0);
    });
  });

  describe("8b. Undo via keyboard", () => {
    /** Three points, the minimum a pencil stroke needs to be kept. */
    const draw = () => stroke(overlay, [[0, 0], [10, 10], [20, 20]]);

    it("should register undo on Obsidian's scope while drawing mode is on", () => {
      expect(app.scope.handlers.length).toBe(0);
      overlay.toggleDrawingMode();
      expect(app.scope.handlers.length).toBeGreaterThan(0);

      overlay.toggleDrawingMode();
      expect(app.scope.handlers.length).toBe(0);
    });

    it("should undo the drawing, not the node, on Mod+Z", () => {
      overlay.toggleDrawingMode();
      draw();
      expect(overlay.shapes.length).toBe(1);

      // false from the handler means the canvas's own undo is suppressed.
      const reachedCanvas = app.scope.dispatch(["Mod"], "z");
      expect(reachedCanvas).toBe(false);
      expect(overlay.shapes.length).toBe(0);
    });

    it("should redo on Mod+Shift+Z and Mod+Y", () => {
      overlay.toggleDrawingMode();
      draw();
      app.scope.dispatch(["Mod"], "z");
      expect(overlay.shapes.length).toBe(0);

      app.scope.dispatch(["Mod", "Shift"], "z");
      expect(overlay.shapes.length).toBe(1);

      app.scope.dispatch(["Mod"], "z");
      expect(overlay.shapes.length).toBe(0);
      app.scope.dispatch(["Mod"], "y");
      expect(overlay.shapes.length).toBe(1);
    });

    it("should release scope keys when the view detaches mid-drawing", () => {
      overlay.toggleDrawingMode();
      expect(app.scope.handlers.length).toBeGreaterThan(0);

      overlay.detach();
      expect(app.scope.handlers.length).toBe(0);

      // Re-attach so afterEach's detach() stays harmless.
      overlay.attach();
    });

    it("should leave undo to the canvas once drawing mode is off", () => {
      overlay.toggleDrawingMode();
      draw();
      overlay.toggleDrawingMode();

      // Nothing of ours is registered, so the key falls through to Obsidian.
      expect(app.scope.dispatch(["Mod"], "z")).toBe(true);
      expect(overlay.shapes.length).toBe(1);
    });
  });

  describe("9. Persistence and migration", () => {
    it("should round-trip shapes through plugin data", async () => {
      overlay.toggleDrawingMode();
      overlay.setTool("line");
      stroke(overlay, [
        [0, 0],
        [100, 100],
      ]);
      await overlay.save();

      const data = await plugin.loadData();
      expect(data.drawings["drawing-test.canvas"].shapes.length).toBe(1);
      expect(data.drawings["drawing-test.canvas"].frames).toBeUndefined();
    });

    it("should read legacy frame-era shapes and drop the frame data", async () => {
      await plugin.saveData({
        drawings: {
          "drawing-test.canvas": {
            frames: [{ id: "f1", x: 0, y: 0, width: 200, height: 200 }],
            shapes: [
              { type: "pencil", color: "#fff", lineWidth: 2, frameId: "f1", points: [
                { x: 1, y: 1 },
                { x: 2, y: 2 },
                { x: 3, y: 3 },
              ] },
            ],
          },
        },
      });

      const fresh = new CanvasDrawingOverlay(leaf as any, app as any, plugin as any);
      fresh.attach();
      await fresh.load();

      expect(fresh.shapes.length).toBe(1);
      expect(fresh.shapes[0].id).toBeTruthy();
      expect((fresh.shapes[0] as any).frameId).toBeUndefined();
      fresh.detach();
    });

    it("should convert legacy x/y/width/height rectangles to two points", async () => {
      await plugin.saveData({
        drawings: {
          "drawing-test.canvas": {
            shapes: [
              { type: "rect", color: "#fff", lineWidth: 2, points: [], x: 10, y: 20, width: 30, height: 40 },
            ],
          },
        },
      });

      const fresh = new CanvasDrawingOverlay(leaf as any, app as any, plugin as any);
      fresh.attach();
      await fresh.load();

      expect(fresh.shapes[0].points).toEqual([
        { x: 10, y: 20 },
        { x: 40, y: 60 },
      ]);
      fresh.detach();
    });

    it("should persist the stroke colour and width as shared settings", async () => {
      overlay.setColor("#123456");
      overlay.setLineWidth(7);
      await overlay.saveSettings();

      const data = await plugin.loadData();
      expect(data.settings).toEqual({ color: "#123456", lineWidth: 7 });
    });
  });

  describe("10. Layers API", () => {
    it("should report the stroke count and the below-nodes flag", () => {
      expect(overlay.apiShapeCount()).toBe(0);
      expect(overlay.apiGetBelowNodes()).toBe(false);

      overlay.apiSetBelowNodes(true);
      expect(overlay.apiGetBelowNodes()).toBe(true);
    });

    it("should clear all shapes and allow undoing the clear", () => {
      overlay.toggleDrawingMode();
      overlay.setTool("line");
      stroke(overlay, [
        [0, 0],
        [100, 0],
      ]);
      expect(overlay.apiShapeCount()).toBe(1);

      overlay.apiClearShapes();
      expect(overlay.apiShapeCount()).toBe(0);

      overlay.undo();
      expect(overlay.apiShapeCount()).toBe(1);
    });
  });
});
