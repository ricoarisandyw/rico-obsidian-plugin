import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CanvasDrawingOverlay, DrawingFrame } from "../src/modules/canvas/drawing/overlay";
import { App, Plugin, WorkspaceLeaf } from "./mocks/obsidian";

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

    // Mock client dimensions for wrapperEl
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
      expect(overlay.color).toBe("#e63946");
      expect(overlay.lineWidth).toBe(3);
      expect(overlay.frames).toEqual([]);
      expect(overlay.shapes).toEqual([]);
    });

    it("should attach canvas overlay and toolbar to DOM", () => {
      expect(overlay.overlayCanvas).toBeDefined();
      expect(overlay.overlayCanvas.classList.contains("rich-canvas-overlay")).toBe(true);
      expect(overlay.toolbar).toBeDefined();
      expect(overlay.toolbar.classList.contains("rich-canvas-toolbar")).toBe(true);
      expect(overlay.toggleBtn).toBeDefined();
    });

    it("should have frame and pencil buttons in toolbar", () => {
      expect(overlay.toolBtns["frame"]).toBeDefined();
      expect(overlay.toolBtns["pencil"]).toBeDefined();
      expect(overlay.toolBtns["pencil"].classList.contains("active")).toBe(true);
    });
  });

  describe("2. Toggle Drawing Mode", () => {
    it("should toggle drawingMode boolean and update DOM classes", () => {
      expect(overlay.drawingMode).toBe(false);

      overlay.toggleDrawingMode();
      expect(overlay.drawingMode).toBe(true);
      expect(overlay.toggleBtn.classList.contains("active")).toBe(true);
      expect(overlay.toolbar.classList.contains("visible")).toBe(true);
      expect(overlay.overlayCanvas.classList.contains("active")).toBe(true);

      overlay.toggleDrawingMode();
      expect(overlay.drawingMode).toBe(false);
      expect(overlay.toggleBtn.classList.contains("active")).toBe(false);
      expect(overlay.toolbar.classList.contains("visible")).toBe(false);
      expect(overlay.overlayCanvas.classList.contains("active")).toBe(false);
    });
  });

  describe("3. Coordinate Transformations", () => {
    it("should convert screen coordinates to world and back correctly", () => {
      const screen = { x: 250, y: 180 };
      const world = overlay.screenToWorld(screen.x, screen.y);
      const backToScreen = overlay.worldToScreen(world.x, world.y);

      expect(Math.round(backToScreen.sx)).toBe(screen.x);
      expect(Math.round(backToScreen.sy)).toBe(screen.y);
    });

    it("should handle custom camera scale and translation", () => {
      // Simulate zoomed/panned canvas
      overlay.getCamera = () => ({ x: 100, y: 50, scale: 2 });

      const screenPt = { sx: 300, sy: 250 };
      // World = (screen - offset) / scale = (300 - 100)/2 = 100, (250 - 50)/2 = 100
      const worldPt = overlay.screenToWorld(screenPt.sx, screenPt.sy);
      expect(worldPt.x).toBe(100);
      expect(worldPt.y).toBe(100);

      // Back to screen = world * scale + offset = 100 * 2 + 100 = 300
      const back = overlay.worldToScreen(worldPt.x, worldPt.y);
      expect(back.sx).toBe(300);
      expect(back.sy).toBe(250);
    });
  });

  describe("4. Tool Switching", () => {
    it("should switch between frame and pencil tools", () => {
      overlay.toolBtns["frame"].click();
      expect(overlay.tool).toBe("frame");
      expect(overlay.toolBtns["frame"].classList.contains("active")).toBe(true);
      expect(overlay.toolBtns["pencil"].classList.contains("active")).toBe(false);

      overlay.toolBtns["pencil"].click();
      expect(overlay.tool).toBe("pencil");
      expect(overlay.toolBtns["pencil"].classList.contains("active")).toBe(true);
    });
  });

  describe("5. Frame Creation & Lifecycle", () => {
    beforeEach(() => {
      overlay.toggleDrawingMode();
      overlay.tool = "frame";
    });

    it("should create a valid frame when dragged above minimum size (>=20px)", () => {
      // Mouse down at (50, 50)
      overlay.getPos = () => ({ sx: 50, sy: 50 });
      overlay.onMouseDown({ button: 0 } as MouseEvent);

      expect(overlay.isDrawingFrame).toBe(true);
      expect(overlay.newFrame).toBeDefined();

      // Mouse drag to (250, 200) -> w: 200, h: 150
      overlay.getPos = () => ({ sx: 250, sy: 200 });
      overlay.onDocMouseMove({ clientX: 250, clientY: 200 } as MouseEvent);

      expect(overlay.newFrame?.width).toBe(200);
      expect(overlay.newFrame?.height).toBe(150);

      // Mouse up
      overlay.onDocMouseUp();

      expect(overlay.isDrawingFrame).toBe(false);
      expect(overlay.frames.length).toBe(1);
      expect(overlay.frames[0].width).toBe(200);
      expect(overlay.frames[0].height).toBe(150);
      // Automatically switches tool back to pencil for immediate drawing
      expect(overlay.tool).toBe("pencil");
    });

    it("should discard frame creation if dimensions are smaller than 20px", () => {
      overlay.getPos = () => ({ sx: 10, sy: 10 });
      overlay.onMouseDown({ button: 0 } as MouseEvent);

      overlay.getPos = () => ({ sx: 22, sy: 22 }); // w: 12, h: 12 (< 20)
      overlay.onDocMouseMove({ clientX: 22, clientY: 22 } as MouseEvent);
      overlay.onDocMouseUp();

      expect(overlay.frames.length).toBe(0);
    });
  });

  describe("6. Hit Testing", () => {
    const testFrame: DrawingFrame = {
      id: "frame-1",
      x: 100,
      y: 100,
      width: 200,
      height: 150,
    };

    beforeEach(() => {
      overlay.frames = [testFrame];
    });

    it("should detect frame at given world coordinates with getFrameAt", () => {
      expect(overlay.getFrameAt(150, 150)).toBe(testFrame);
      expect(overlay.getFrameAt(50, 50)).toBeNull();
      expect(overlay.getFrameAt(350, 300)).toBeNull();
    });

    it("should calculate correct handle positions with getHandles", () => {
      const handles = overlay.getHandles(testFrame);
      expect(handles.tl).toEqual({ x: 100, y: 100 });
      expect(handles.tr).toEqual({ x: 300, y: 100 });
      expect(handles.bl).toEqual({ x: 100, y: 250 });
      expect(handles.br).toEqual({ x: 300, y: 250 });
      expect(handles.tm).toEqual({ x: 200, y: 100 });
    });

    it("should detect resize handle within tolerance using hitTestHandle", () => {
      // Top-left handle is at (100, 100)
      const hit = overlay.hitTestHandle(103, 102); // within 7px
      expect(hit).not.toBeNull();
      expect(hit?.name).toBe("tl");
      expect(hit?.frame.id).toBe("frame-1");

      const miss = overlay.hitTestHandle(120, 120);
      expect(miss).toBeNull();
    });

    it("should detect delete button click in drawing mode with hitTestDelete", () => {
      overlay.drawingMode = true;
      const delCenter = overlay.deleteBtnCenter(testFrame);

      const hit = overlay.hitTestDelete(delCenter.x + 2, delCenter.y - 2);
      expect(hit).toBe(testFrame);

      const miss = overlay.hitTestDelete(delCenter.x + 30, delCenter.y);
      expect(miss).toBeNull();
    });
  });

  describe("7. Frame Resizing", () => {
    let testFrame: DrawingFrame;

    beforeEach(() => {
      testFrame = { id: "frame-resize", x: 100, y: 100, width: 200, height: 150 };
      overlay.frames = [testFrame];
      overlay.resizeFrame = testFrame;
      overlay.resizeHandle = "br";
      overlay.resizeStart = {
        frame: { ...testFrame },
        worldX: 300,
        worldY: 250,
      };
    });

    it("should expand frame when bottom-right handle is dragged outward", () => {
      // Drag br handle from (300, 250) to (350, 300) -> +50w, +50h
      overlay.applyResize(350, 300);

      expect(testFrame.width).toBe(250);
      expect(testFrame.height).toBe(200);
    });

    it("should respect minimum frame size constraint (MIN = 50px)", () => {
      // Drag br handle inward past 0
      overlay.applyResize(50, 50);

      expect(testFrame.width).toBe(50);
      expect(testFrame.height).toBe(50);
    });
  });

  describe("8. Drawing Pencil Strokes", () => {
    beforeEach(() => {
      overlay.frames = [{ id: "f1", x: 50, y: 50, width: 300, height: 200 }];
      overlay.toggleDrawingMode();
      overlay.tool = "pencil";
    });

    it("should draw a stroke when dragging inside an existing frame", () => {
      // Start inside frame
      overlay.getPos = () => ({ sx: 100, sy: 100 });
      overlay.onMouseDown({ button: 0 } as MouseEvent);

      expect(overlay.isDrawing).toBe(true);
      expect(overlay.currentShape).toBeDefined();
      expect(overlay.currentShape?.frameId).toBe("f1");

      // Move multiple points
      overlay.getPos = () => ({ sx: 110, sy: 110 });
      overlay.onDocMouseMove({ clientX: 110, clientY: 110 } as MouseEvent);

      overlay.getPos = () => ({ sx: 120, sy: 120 });
      overlay.onDocMouseMove({ clientX: 120, clientY: 120 } as MouseEvent);

      overlay.getPos = () => ({ sx: 130, sy: 130 });
      overlay.onDocMouseMove({ clientX: 130, clientY: 130 } as MouseEvent);

      // Finish stroke
      overlay.onDocMouseUp();

      expect(overlay.isDrawing).toBe(false);
      expect(overlay.shapes.length).toBe(1);
      expect(overlay.shapes[0].points.length).toBeGreaterThan(2);
      expect(overlay.shapes[0].frameId).toBe("f1");
    });

    it("should not start drawing if mouse down occurs outside all frames", () => {
      overlay.getPos = () => ({ sx: 10, sy: 10 }); // outside frame at (50, 50)
      overlay.onMouseDown({ button: 0 } as MouseEvent);

      expect(overlay.isDrawing).toBe(false);
      expect(overlay.currentShape).toBeNull();
    });

    it("should discard stroke if mouseup occurs with 2 or fewer points (accidental click)", () => {
      overlay.getPos = () => ({ sx: 100, sy: 100 });
      overlay.onMouseDown({ button: 0 } as MouseEvent);
      overlay.onDocMouseUp();

      expect(overlay.shapes.length).toBe(0);
    });
  });

  describe("9. History & Undo Functionality", () => {
    it("should restore previous state upon calling undo()", () => {
      overlay.frames = [{ id: "f1", x: 10, y: 10, width: 100, height: 100 }];
      overlay.shapes = [];

      overlay.saveHistory();

      // Add another frame and shape
      overlay.frames.push({ id: "f2", x: 120, y: 10, width: 100, height: 100 });
      overlay.shapes.push({
        type: "pencil",
        color: "#000",
        lineWidth: 2,
        points: [{ x: 15, y: 15 }, { x: 20, y: 20 }, { x: 25, y: 25 }],
        frameId: "f1",
      });

      expect(overlay.frames.length).toBe(2);
      expect(overlay.shapes.length).toBe(1);

      overlay.undo();

      expect(overlay.frames.length).toBe(1);
      expect(overlay.frames[0].id).toBe("f1");
      expect(overlay.shapes.length).toBe(0);
    });
  });

  describe("10. Public API Methods", () => {
    beforeEach(() => {
      overlay.frames = [
        { id: "f1", x: 10, y: 10, width: 100, height: 100 },
        { id: "f2", x: 120, y: 10, width: 100, height: 100 },
      ];
      overlay.shapes = [
        {
          type: "pencil",
          color: "#000",
          lineWidth: 2,
          points: [{ x: 15, y: 15 }, { x: 20, y: 20 }, { x: 25, y: 25 }],
          frameId: "f1",
        },
      ];
    });

    it("apiListFrames should report frames in reverse display order with stroke counts", () => {
      const list = overlay.apiListFrames();
      expect(list.length).toBe(2);
      expect(list[0].id).toBe("f2"); // Reverse order
      expect(list[1].id).toBe("f1");
      expect(list[1].strokeCount).toBe(1);
    });

    it("apiFocusFrame and apiClearFrameSelection should manage frame selection", () => {
      overlay.apiFocusFrame("f1");
      expect(overlay.selectedFrameId).toBe("f1");

      overlay.apiClearFrameSelection();
      expect(overlay.selectedFrameId).toBeNull();
    });

    it("apiDeleteFrame should delete the frame and its associated shapes", () => {
      overlay.apiDeleteFrame("f1");

      expect(overlay.frames.find((f) => f.id === "f1")).toBeUndefined();
      expect(overlay.shapes.filter((s) => s.frameId === "f1").length).toBe(0);
      expect(overlay.frames.length).toBe(1);
    });

    it("apiMoveFrame should reorder frames", () => {
      expect(overlay.frames[0].id).toBe("f1");
      expect(overlay.frames[1].id).toBe("f2");

      overlay.apiMoveFrame("f1", -1);
      expect(overlay.frames[0].id).toBe("f2");
      expect(overlay.frames[1].id).toBe("f1");
    });

    it("apiSetBelowNodes / apiGetBelowNodes should toggle belowNodes mode", () => {
      expect(overlay.apiGetBelowNodes()).toBe(false);

      overlay.apiSetBelowNodes(true);
      expect(overlay.apiGetBelowNodes()).toBe(true);

      overlay.apiSetBelowNodes(false);
      expect(overlay.apiGetBelowNodes()).toBe(false);
    });

    it("apiSetFrameOrder should update frame order to match the provided IDs array", () => {
      overlay.apiSetFrameOrder(["f2", "f1"]);
      expect(overlay.frames.map((f) => f.id)).toEqual(["f2", "f1"]);
    });
  });
});
