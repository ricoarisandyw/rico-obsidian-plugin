import { Notice, setIcon, setTooltip } from "obsidian";
import type RicoObsidianPlugin from "../../../main";

/* ------------------------------------------------------------------ *
 * Canvas Layers
 * A Photoshop-style layers panel for Obsidian Canvas.
 *
 * Z-ORDER MODEL
 *   In the .canvas file, a node's position in the `nodes` array is its
 *   stacking order: the LAST element renders on top (front), the FIRST
 *   element renders at the bottom (back). We reorder that array and call
 *   canvas.setData() + canvas.requestSave() so the change persists and
 *   re-renders immediately. The panel shows the list reversed, so the
 *   TOP row is the front-most layer (just like Photoshop).
 * ------------------------------------------------------------------ */

export interface CanvasNodeData {
  id: string;
  type?: string;
  file?: string;
  text?: string;
  url?: string;
  label?: string;
  ogData?: { title?: string };
  [key: string]: unknown;
}

export function nodeLabel(d: CanvasNodeData | undefined): string {
  if (!d) return "Node";
  if (d.ogData && d.ogData.title) return d.ogData.title;
  switch (d.type) {
    case "text": {
      const first = String(d.text || "")
        .trim()
        .split("\n")[0]
        .replace(/^#+\s*/, "")
        .replace(/[*_`>#-]/g, "")
        .trim();
      if (first) return first.slice(0, 80);
      if (d.url) return d.url;
      return "Empty text";
    }
    case "file": {
      const f = String(d.file || "");
      return f.split("/").pop() || "File";
    }
    case "group":
      return d.label || "Group";
    case "link":
      return d.url || "Link";
    default:
      return d.type || "Node";
  }
}

export function nodeIcon(d: CanvasNodeData | undefined): string {
  if (!d) return "square";
  if (d.ogData) return "link";
  switch (d.type) {
    case "text":
      return d.url ? "link" : "type";
    case "file": {
      const f = String(d.file || "").toLowerCase();
      if (/\.(png|jpe?g|gif|webp|svg|bmp)$/.test(f)) return "image";
      if (/\.(md|markdown)$/.test(f)) return "file-text";
      if (/\.canvas$/.test(f)) return "layout-dashboard";
      return "file";
    }
    case "group":
      return "group";
    case "link":
      return "globe";
    default:
      return "square";
  }
}

type OrderOp = (order: string[], sel: Set<string>) => string[];

function moveToFront(order: string[], sel: Set<string>): string[] {
  const keep = order.filter((id) => !sel.has(id));
  const move = order.filter((id) => sel.has(id));
  return keep.concat(move);
}

function moveToBack(order: string[], sel: Set<string>): string[] {
  const move = order.filter((id) => sel.has(id));
  const keep = order.filter((id) => !sel.has(id));
  return move.concat(keep);
}

function moveForward(order: string[], sel: Set<string>): string[] {
  const a = order.slice();
  for (let i = a.length - 2; i >= 0; i--) {
    if (sel.has(a[i]) && !sel.has(a[i + 1])) {
      const t = a[i];
      a[i] = a[i + 1];
      a[i + 1] = t;
    }
  }
  return a;
}

function moveBackward(order: string[], sel: Set<string>): string[] {
  const a = order.slice();
  for (let i = 1; i < a.length; i++) {
    if (sel.has(a[i]) && !sel.has(a[i - 1])) {
      const t = a[i];
      a[i] = a[i - 1];
      a[i - 1] = t;
    }
  }
  return a;
}

export class CanvasLayersManager {
  private plugin: RicoObsidianPlugin;
  private panel: { el: HTMLElement; header: HTMLElement; list: HTMLElement } | null = null;
  private pollTimer: number | null = null;
  private lastSig = "";
  private selFrameId: string | null = null;
  private _pos: { left: string; top: string } | null = null;
  private drawBtn: HTMLElement | null = null;
  private menuObserver: MutationObserver | null = null;

  constructor(plugin: RicoObsidianPlugin) {
    this.plugin = plugin;
  }

  init(): void {
    this.plugin.addCommand({
      id: "toggle-canvas-layers-panel",
      name: "Toggle layers panel",
      callback: () => this.togglePanel(),
    });

    this.plugin.addCommand({
      id: "layer-to-front",
      name: "Move layer to front",
      callback: () => this.applyOp(moveToFront),
    });
    this.plugin.addCommand({
      id: "layer-forward",
      name: "Move layer forward",
      callback: () => this.applyOp(moveForward),
    });
    this.plugin.addCommand({
      id: "layer-backward",
      name: "Move layer backward",
      callback: () => this.applyOp(moveBackward),
    });
    this.plugin.addCommand({
      id: "layer-to-back",
      name: "Move layer to back",
      callback: () => this.applyOp(moveToBack),
    });

    this.plugin.registerEvent(
      this.plugin.app.workspace.on("active-leaf-change", () => {
        this.refresh();
        this.syncButtons();
      })
    );

    this.plugin.registerEvent(
      this.plugin.app.workspace.on("layout-change", () => this.syncButtons())
    );

    this.menuObserver = new MutationObserver(() => this.syncButtons());
    this.menuObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    this.plugin.app.workspace.onLayoutReady(() => {
      this.syncButtons();
    });
    setTimeout(() => this.syncButtons(), 300);
  }

  destroy(): void {
    if (this.menuObserver) {
      this.menuObserver.disconnect();
      this.menuObserver = null;
    }
    document.querySelectorAll(".rich-canvas-layers-btn").forEach((el) => el.remove());
    this.closePanel();
  }

  syncButtons(): void {
    const leaves = this.plugin.app.workspace.getLeavesOfType("canvas");
    for (const leaf of leaves) {
      const view = leaf.view as any;
      if (!view) continue;
      const canvas = view.canvas;
      const cardMenu: HTMLElement | null =
        canvas?.cardMenuEl ||
        view.containerEl?.querySelector(".canvas-card-menu");
      if (!cardMenu) continue;

      let btn = cardMenu.querySelector<HTMLElement>(".rich-canvas-layers-btn");

      // Locate "Drag to add group" button in the canvas card creation menu
      const groupBtn =
        cardMenu.querySelector("#create-group") ||
        cardMenu.querySelector('.canvas-card-menu-button[aria-label*="group" i]') ||
        cardMenu.querySelector('.canvas-card-menu-button[data-tooltip*="group" i]') ||
        cardMenu.querySelector('.canvas-card-menu-button .svg-icon[data-icon="group"]')?.closest(".canvas-card-menu-button");

      if (!btn) {
        btn = document.createElement("div");
        btn.className = "canvas-card-menu-button clickable-icon rich-canvas-layers-btn";
        btn.setAttribute("aria-label", "Canvas Layers");
        setIcon(btn, "layers");
        setTooltip(btn, "Canvas Layers", { placement: "top" });
        btn.addEventListener("click", (e: MouseEvent) => {
          e.stopPropagation();
          this.togglePanel();
        });

        if (groupBtn) {
          groupBtn.insertAdjacentElement("afterend", btn);
        } else {
          cardMenu.appendChild(btn);
        }
      } else if (groupBtn && btn.previousElementSibling !== groupBtn) {
        groupBtn.insertAdjacentElement("afterend", btn);
      }

      btn.classList.toggle("is-active", !!this.panel);
    }
  }

  private updateButtonStates(): void {
    const active = !!this.panel;
    document.querySelectorAll(".rich-canvas-layers-btn").forEach((btn) => {
      btn.classList.toggle("is-active", active);
    });
  }

  private getActiveCanvas(): any {
    const leaf = this.plugin.app.workspace.activeLeaf;
    let view = leaf ? (leaf.view as any) : null;
    if (!view || view.getViewType?.() !== "canvas") {
      const leaves = this.plugin.app.workspace.getLeavesOfType("canvas");
      const withView = leaves.find((l: any) => l.view && l.view.canvas);
      view = withView ? (withView.view as any) : null;
    }
    if (view && view.getViewType && view.getViewType() === "canvas" && view.canvas) {
      return view.canvas;
    }
    return null;
  }

  private getDrawOverlay(): any {
    const canvas = this.getActiveCanvas();
    if (!canvas) return null;
    return this.plugin.getOverlayForCanvas(canvas);
  }

  private selectedIds(canvas: any): Set<string> {
    const s = new Set<string>();
    try {
      canvas.selection?.forEach((n: any) => n && n.id && s.add(n.id));
    } catch (_) {}
    return s;
  }

  private selectByIds(canvas: any, ids: string[]): void {
    const nodes = ids.map((id) => canvas.nodes?.get(id)).filter(Boolean);
    try {
      canvas.updateSelection(() => {
        canvas.selection = new Set(nodes);
      });
    } catch (_) {
      try {
        canvas.deselectAll();
        if (nodes[0]) canvas.selectOnly(nodes[0]);
      } catch (__) {}
    }
  }

  private applyOrder(canvas: any, orderedIds: string[]): void {
    const vp = { x: canvas.tx, y: canvas.ty, z: canvas.tZoom };
    const sel = [...this.selectedIds(canvas)];

    const data = canvas.getData();
    const byId = new Map(data.nodes.map((n: any) => [n.id, n]));
    const out: any[] = [];
    for (const id of orderedIds) {
      if (byId.has(id)) {
        out.push(byId.get(id));
        byId.delete(id);
      }
    }
    for (const n of byId.values()) out.push(n);
    data.nodes = out;

    canvas.setData(data);
    canvas.requestSave();

    try {
      canvas.setViewport(vp.x, vp.y, vp.z);
    } catch (_) {}
    this.selectByIds(canvas, sel);
    this.refresh(true);
  }

  applyOp(fn: OrderOp): void {
    const overlay = this.getDrawOverlay();
    if (this.selFrameId && overlay) {
      const order = overlay.apiGetFrameOrder();
      if (order.includes(this.selFrameId)) {
        overlay.apiSetFrameOrder(fn(order, new Set([this.selFrameId])));
        this.refresh(true);
        return;
      }
      this.selFrameId = null;
    }

    const canvas = this.getActiveCanvas();
    if (!canvas) {
      new Notice("No active canvas");
      return;
    }
    const sel = this.selectedIds(canvas);
    if (sel.size === 0) {
      new Notice("Select a node or drawing frame first");
      return;
    }
    const order = canvas.getData().nodes.map((n: any) => n.id);
    this.applyOrder(canvas, fn(order, sel));
  }

  togglePanel(): void {
    if (this.panel) this.closePanel();
    else this.openPanel();
  }

  openPanel(): void {
    const canvas = this.getActiveCanvas();
    if (!canvas) {
      new Notice("Open a canvas first");
      return;
    }

    const el = document.createElement("div");
    el.className = "canvas-layers-panel";
    document.body.appendChild(el);

    const header = el.createDiv({ cls: "cl-header" });
    const title = header.createDiv({ cls: "cl-title" });
    setIcon(title.createSpan({ cls: "cl-title-icon" }), "layers");
    title.createSpan({ text: "Layers" });
    const closeBtn = header.createDiv({ cls: "cl-close" });
    setIcon(closeBtn, "x");
    closeBtn.onclick = () => this.closePanel();

    const bar = el.createDiv({ cls: "cl-toolbar" });
    const mkBtn = (icon: string, tip: string, fn: OrderOp) => {
      const b = bar.createDiv({ cls: "cl-btn", attr: { "aria-label": tip } });
      setIcon(b, icon);
      b.onclick = () => this.applyOp(fn);
    };
    mkBtn("chevrons-up", "Move to front", moveToFront);
    mkBtn("chevron-up", "Move forward", moveForward);
    mkBtn("chevron-down", "Move backward", moveBackward);
    mkBtn("chevrons-down", "Move to back", moveToBack);

    bar.createDiv({ cls: "cl-bar-sep" });
    const drawBtn = bar.createDiv({
      cls: "cl-btn cl-draw-toggle",
      attr: { "aria-label": "Toggle drawings above / below nodes" },
    });
    setIcon(drawBtn, "pencil-ruler");
    drawBtn.onclick = () => {
      const ov = this.getDrawOverlay();
      if (!ov) {
        new Notice("No drawings on this canvas");
        return;
      }
      ov.apiSetBelowNodes(!ov.apiGetBelowNodes());
      this.refresh(true);
    };
    this.drawBtn = drawBtn;

    const list = el.createDiv({ cls: "cl-list" });

    this.panel = { el, header, list };
    this.makeDraggable(el, header);
    this.startPoll();
    this.refresh(true);
    this.updateButtonStates();
  }

  closePanel(): void {
    this.stopPoll();
    if (this.panel) {
      this.panel.el.remove();
      this.panel = null;
    }
    this.updateButtonStates();
  }

  private makeDraggable(el: HTMLElement, handle: HTMLElement): void {
    const saved = this._pos;
    if (saved) {
      el.style.left = saved.left;
      el.style.top = saved.top;
      el.style.right = "auto";
    }
    let sx = 0,
      sy = 0,
      ox = 0,
      oy = 0,
      dragging = false;

    const down = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(".cl-close")) return;
      dragging = true;
      const r = el.getBoundingClientRect();
      sx = e.clientX;
      sy = e.clientY;
      ox = r.left;
      oy = r.top;
      el.style.right = "auto";
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
      e.preventDefault();
    };
    const move = (e: MouseEvent) => {
      if (!dragging) return;
      el.style.left = ox + (e.clientX - sx) + "px";
      el.style.top = oy + (e.clientY - sy) + "px";
    };
    const up = () => {
      dragging = false;
      this._pos = { left: el.style.left, top: el.style.top };
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    handle.addEventListener("mousedown", down);
  }

  private startPoll(): void {
    this.stopPoll();
    this.pollTimer = window.setInterval(() => this.refresh(false), 350);
    this.plugin.registerInterval(this.pollTimer);
  }

  private stopPoll(): void {
    if (this.pollTimer) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private signature(canvas: any): string {
    const ids = canvas.getData().nodes.map((n: any) => n.id).join(",");
    const sel = [...this.selectedIds(canvas)].sort().join(",");
    const file = canvas.view && canvas.view.file ? canvas.view.file.path : "";
    let draw = "";
    const ov = this.getDrawOverlay();
    if (ov) {
      draw =
        ov
          .apiListFrames()
          .map((f: any) => f.id + ":" + f.strokeCount + (f.selected ? "*" : ""))
          .join(",") +
        "|" +
        ov.apiGetBelowNodes();
    }
    return file + "|" + ids + "|" + draw + "||" + sel;
  }

  refresh(force = false): void {
    if (!this.panel) return;
    const canvas = this.getActiveCanvas();
    if (!canvas) {
      if (force) {
        this.panel.list.empty();
        this.panel.list.createDiv({ cls: "cl-empty", text: "No active canvas" });
      }
      return;
    }
    const sig = this.signature(canvas);
    if (!force && sig === this.lastSig) return;

    const structuralChanged =
      force || sig.split("||")[0] !== (this.lastSig.split("||")[0] || "");
    this.lastSig = sig;

    if (structuralChanged) this.renderList(canvas);
    else this.updateHighlight(canvas);
  }

  private renderList(canvas: any): void {
    if (!this.panel) return;
    const list = this.panel.list;
    list.empty();

    const overlay = this.getDrawOverlay();
    if (overlay) {
      const below = overlay.apiGetBelowNodes();
      if (this.drawBtn) this.drawBtn.toggleClass("is-active", below);
      const frames = overlay.apiListFrames();
      if (frames.length) {
        const sec = list.createDiv({ cls: "cl-section" });
        sec.createSpan({ text: "Drawings" });
        sec.createSpan({ cls: "cl-section-tag", text: below ? "below nodes" : "above nodes" });

        frames.forEach((f: any) => {
          const row = list.createDiv({ cls: "cl-row cl-row-draw", attr: { "data-fid": f.id } });
          if (f.selected) row.addClass("is-selected");

          const ic = row.createDiv({ cls: "cl-row-icon" });
          setIcon(ic, "pen-line");
          row.createDiv({
            cls: "cl-row-label",
            text: f.label + (f.strokeCount ? " · " + f.strokeCount : ""),
          });

          const actions = row.createDiv({ cls: "cl-row-actions" });
          const up = actions.createDiv({ cls: "cl-mini", attr: { "aria-label": "Move forward" } });
          setIcon(up, "chevron-up");
          const dn = actions.createDiv({ cls: "cl-mini", attr: { "aria-label": "Move backward" } });
          setIcon(dn, "chevron-down");
          const del = actions.createDiv({
            cls: "cl-mini cl-mini-danger",
            attr: { "aria-label": "Delete frame" },
          });
          setIcon(del, "trash-2");

          up.onclick = (e) => {
            e.stopPropagation();
            overlay.apiMoveFrame(f.id, -1);
            this.refresh(true);
          };
          dn.onclick = (e) => {
            e.stopPropagation();
            overlay.apiMoveFrame(f.id, +1);
            this.refresh(true);
          };
          del.onclick = (e) => {
            e.stopPropagation();
            if (this.selFrameId === f.id) this.selFrameId = null;
            overlay.apiDeleteFrame(f.id);
            this.refresh(true);
          };
          row.addEventListener("click", () => {
            this.selFrameId = f.id;
            overlay.apiFocusFrame(f.id);
            this.refresh(true);
          });
        });

        list.createDiv({ cls: "cl-section", text: "Nodes" });
      }
    }

    const nodes = canvas.getData().nodes.slice();
    const sel = this.selectedIds(canvas);
    const display = nodes.slice().reverse();

    display.forEach((d: any, i: number) => {
      const zTop = display.length - i;
      const row = list.createDiv({ cls: "cl-row", attr: { draggable: "true", "data-id": d.id } });
      if (sel.has(d.id)) row.addClass("is-selected");

      const grip = row.createDiv({ cls: "cl-grip" });
      setIcon(grip, "grip-vertical");

      const ic = row.createDiv({ cls: "cl-row-icon" });
      setIcon(ic, nodeIcon(d));

      row.createDiv({ cls: "cl-row-label", text: nodeLabel(d) });
      row.createDiv({ cls: "cl-row-z", text: "z" + zTop });

      row.addEventListener("mousedown", (e: MouseEvent) => {
        if (e.button !== 0) return;
        this.selFrameId = null;
        if (overlay) overlay.apiClearFrameSelection();
        const cur = this.selectedIds(canvas);
        let next: Set<string>;
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          next = new Set(cur);
          if (next.has(d.id)) next.delete(d.id);
          else next.add(d.id);
        } else {
          next = new Set([d.id]);
        }
        this.selectByIds(canvas, [...next]);
        this.refresh(false);
      });

      row.addEventListener("dblclick", () => {
        this.selectByIds(canvas, [d.id]);
        try {
          canvas.zoomToSelection();
        } catch (_) {}
      });

      this.attachDnD(row, canvas);
    });

    if (display.length === 0) {
      list.createDiv({ cls: "cl-empty", text: "Canvas is empty" });
    }
  }

  private updateHighlight(canvas: any): void {
    if (!this.panel) return;
    const sel = this.selectedIds(canvas);
    this.panel.list.querySelectorAll(".cl-row").forEach((row) => {
      const id = row.getAttribute("data-id");
      row.toggleClass("is-selected", sel.has(id!));
    });
  }

  private attachDnD(row: HTMLElement, canvas: any): void {
    row.addEventListener("dragstart", (e) => {
      row.addClass("cl-dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        try {
          e.dataTransfer.setData("text/plain", row.getAttribute("data-id") || "");
        } catch (_) {}
      }
    });
    row.addEventListener("dragend", () => {
      row.removeClass("cl-dragging");
      this.clearDropMarks();
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const r = row.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      this.clearDropMarks();
      row.addClass(after ? "cl-drop-below" : "cl-drop-above");
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      const dragId = e.dataTransfer?.getData("text/plain");
      const r = row.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      const targetId = row.getAttribute("data-id");
      this.clearDropMarks();
      if (!dragId || dragId === targetId) return;
      this.reorderByDrop(canvas, dragId, targetId!, after);
    });
  }

  private clearDropMarks(): void {
    if (!this.panel) return;
    this.panel.list.querySelectorAll(".cl-drop-above, .cl-drop-below").forEach((r) => {
      r.removeClass("cl-drop-above");
      r.removeClass("cl-drop-below");
    });
  }

  private reorderByDrop(canvas: any, dragId: string, targetId: string, after: boolean): void {
    let visual = this.panel?.list
      ? [...this.panel.list.querySelectorAll(".cl-row")].map((r) => r.getAttribute("data-id")!)
      : null;
    if (!visual || !visual.length) {
      visual = canvas.getData().nodes.map((n: any) => n.id).reverse();
    }
    visual = visual.filter((id) => id !== dragId);
    let idx = visual.indexOf(targetId);
    if (idx === -1) idx = visual.length - 1;
    const insertAt = after ? idx + 1 : idx;
    visual.splice(insertAt, 0, dragId);
    const arrayOrder = visual.slice().reverse();
    this.applyOrder(canvas, arrayOrder);
  }
}
