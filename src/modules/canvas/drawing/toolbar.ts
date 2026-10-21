import { setIcon } from "obsidian";
import type { DrawingTool } from "./shapes";

export interface ToolbarHost {
  tool: DrawingTool;
  color: string;
  lineWidth: number;
  setTool(tool: DrawingTool): void;
  setColor(color: string): void;
  setLineWidth(width: number): void;
  undo(): void;
  redo(): void;
  clearAll(): void;
  close(): void;
}

/** Tool buttons in toolbar order; the index doubles as the 1-6 shortcut. */
export const TOOL_DEFS: Array<{ id: DrawingTool; icon: string; title: string }> = [
  { id: "pencil", icon: "pencil", title: "Pen (1)" },
  { id: "line", icon: "minus", title: "Line (2) — hold Shift for 45°" },
  { id: "arrow", icon: "move-right", title: "Arrow (3) — hold Shift for 45°" },
  { id: "rect", icon: "square", title: "Rectangle (4)" },
  { id: "ellipse", icon: "circle", title: "Ellipse (5)" },
  { id: "eraser", icon: "eraser", title: "Eraser (6)" },
];

export class DrawingToolbar {
  el: HTMLElement;
  private toolBtns = new Map<DrawingTool, HTMLButtonElement>();
  private colorInput: HTMLInputElement;
  private sizeInput: HTMLInputElement;

  constructor(parent: HTMLElement, private readonly host: ToolbarHost) {
    this.el = parent.createEl("div", { cls: "rich-canvas-toolbar" });

    for (const def of TOOL_DEFS) {
      const btn = this.el.createEl("button", {
        cls: "rich-canvas-tool-btn",
        attr: { "aria-label": def.title, title: def.title },
      });
      setIcon(btn, def.icon);
      btn.addEventListener("click", () => this.host.setTool(def.id));
      this.toolBtns.set(def.id, btn);
    }

    this.el.createEl("div", { cls: "rich-canvas-sep" });

    this.colorInput = this.el.createEl("input", {
      cls: "rich-canvas-color",
      attr: { type: "color", "aria-label": "Stroke colour" },
    });
    this.colorInput.value = host.color;
    this.colorInput.addEventListener("input", () => this.host.setColor(this.colorInput.value));

    this.sizeInput = this.el.createEl("input", {
      cls: "rich-canvas-size",
      attr: { type: "number", min: "1", max: "30", step: "1", title: "Stroke width (1–30)" },
    });
    this.sizeInput.value = String(host.lineWidth);
    const commitSize = () => {
      const v = parseInt(this.sizeInput.value, 10);
      if (!isNaN(v)) this.host.setLineWidth(Math.max(1, Math.min(30, v)));
    };
    this.sizeInput.addEventListener("input", commitSize);
    this.sizeInput.addEventListener("change", () => {
      commitSize();
      this.sizeInput.value = String(this.host.lineWidth);
    });

    this.el.createEl("div", { cls: "rich-canvas-sep" });

    this.iconBtn("undo-2", "Undo (Ctrl+Z)", () => this.host.undo());
    this.iconBtn("redo-2", "Redo (Ctrl+Shift+Z)", () => this.host.redo());
    this.iconBtn("trash-2", "Clear all drawings", () => this.host.clearAll());

    this.el.createEl("div", { cls: "rich-canvas-sep" });

    this.iconBtn("x", "Close drawing mode (Esc)", () => this.host.close());

    this.syncTool();
  }

  private iconBtn(icon: string, title: string, onClick: () => void): HTMLButtonElement {
    const btn = this.el.createEl("button", {
      cls: "rich-canvas-tool-btn",
      attr: { "aria-label": title, title },
    });
    setIcon(btn, icon);
    btn.addEventListener("click", onClick);
    return btn;
  }

  /** Highlight the button matching the host's current tool. */
  syncTool(): void {
    for (const [id, btn] of this.toolBtns) btn.toggleClass("active", id === this.host.tool);
  }

  syncSettings(): void {
    this.colorInput.value = this.host.color;
    this.sizeInput.value = String(this.host.lineWidth);
  }

  setVisible(visible: boolean): void {
    this.el.toggleClass("visible", visible);
  }

  destroy(): void {
    this.el.remove();
  }
}
