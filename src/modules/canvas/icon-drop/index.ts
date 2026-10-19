import { App, Modal, Notice, setIcon, setTooltip } from "obsidian";
import type RicoObsidianPlugin from "../../../main";
import { generateCanvasId } from "../../../shared/utils/canvas";

/* ------------------------------------------------------------------ *
 * Canvas Icon Drop
 * Adds a "drag to add icon" button beside the Canvas Layers button in
 * the card-creation menu. Dragging it onto the canvas and dropping opens
 * an icon picker (backed by the Iconize plugin's icon packs); the chosen
 * icon is inserted as a canvas node at the drop position using Iconize's
 * own inline shortcode syntax (e.g. ":LiSmile:"), so it renders through
 * Iconize's markdown post-processor and stays in sync with icon packs.
 * ------------------------------------------------------------------ */

const ICONIZE_ID = "obsidian-icon-folder";
const ICON_DRAG_MIME = "application/x-rico-icon-drop";
const ICON_NODE_SIZE = 140;

interface IconizeIcon {
  name: string;
  prefix: string;
  iconPackName: string;
  svgElement: string;
}

interface IconizeIconPack {
  name: string;
  prefix: string;
  custom: boolean;
  icons: IconizeIcon[];
}

interface IconizePluginInstance {
  api?: { getAllIconPacks: () => IconizeIconPack[] };
  getSettings?: () => { iconIdentifier: string };
}

function getIconizePlugin(app: App): IconizePluginInstance | null {
  const plugins = (app as unknown as { plugins?: { plugins?: Record<string, IconizePluginInstance> } })
    .plugins?.plugins;
  const p = plugins?.[ICONIZE_ID];
  if (p && p.api && p.getSettings) return p;
  return null;
}

class IconPickerModal extends Modal {
  private iconize: IconizePluginInstance;
  private onPick: (shortcode: string) => void;

  constructor(app: App, iconize: IconizePluginInstance, onPick: (shortcode: string) => void) {
    super(app);
    this.iconize = iconize;
    this.onPick = onPick;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("rico-icon-picker-modal");
    contentEl.createEl("h3", { text: "Pick an icon" });

    const input = contentEl.createEl("input", {
      cls: "rico-icon-picker-search",
      type: "text",
      attr: { placeholder: "Search icons…" },
    });

    const grid = contentEl.createDiv({ cls: "rico-icon-picker-grid" });

    const packs = this.iconize.api!.getAllIconPacks();
    const allIcons = packs.flatMap((pack) => pack.icons);

    const render = (query: string) => {
      grid.empty();
      const q = query.trim().toLowerCase();
      const list = (q ? allIcons.filter((ic) => ic.name.toLowerCase().includes(q)) : allIcons).slice(0, 300);

      if (!list.length) {
        grid.createDiv({ cls: "rico-icon-picker-empty", text: "No icons found" });
        return;
      }

      for (const ic of list) {
        const cell = grid.createDiv({ cls: "rico-icon-picker-cell", attr: { "aria-label": ic.name } });
        setTooltip(cell, ic.name, { placement: "top" });
        cell.innerHTML = ic.svgElement;
        cell.addEventListener("click", () => {
          const identifier = this.iconize.getSettings!().iconIdentifier;
          const shortcode = `${identifier}${ic.prefix}${ic.name}${identifier}`;
          this.onPick(shortcode);
          this.close();
        });
      }
    };

    render("");
    input.addEventListener("input", () => render(input.value));
    input.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function createIconNode(canvas: any, pos: { x: number; y: number }, shortcode: string): void {
  if (!canvas?.getData || !canvas?.setData) return;
  const data = canvas.getData();
  data.nodes.push({
    id: generateCanvasId(),
    type: "text",
    text: `# ${shortcode}`,
    x: Math.round(pos.x - ICON_NODE_SIZE / 2),
    y: Math.round(pos.y - ICON_NODE_SIZE / 2),
    width: ICON_NODE_SIZE,
    height: ICON_NODE_SIZE,
  });
  canvas.setData(data);
  canvas.requestSave?.();
  canvas.requestFrame?.();
}

export class CanvasIconDropManager {
  private plugin: RicoObsidianPlugin;
  private menuObserver: MutationObserver | null = null;
  private dropZones: WeakSet<HTMLElement> = new WeakSet();

  constructor(plugin: RicoObsidianPlugin) {
    this.plugin = plugin;
  }

  init(): void {
    this.menuObserver = new MutationObserver(() => this.sync());
    this.menuObserver.observe(document.body, { childList: true, subtree: true });

    this.plugin.app.workspace.onLayoutReady(() => this.sync());
    setTimeout(() => this.sync(), 300);
  }

  destroy(): void {
    this.menuObserver?.disconnect();
    this.menuObserver = null;
    document.querySelectorAll(".rico-icon-drop-btn").forEach((el) => el.remove());
  }

  private sync(): void {
    const leaves = this.plugin.app.workspace.getLeavesOfType("canvas");
    for (const leaf of leaves) {
      const view = leaf.view as any;
      if (!view) continue;
      const canvas = view.canvas;
      if (!canvas) continue;

      const cardMenu: HTMLElement | null =
        canvas.cardMenuEl || view.containerEl?.querySelector(".canvas-card-menu");
      if (cardMenu) this.ensureButton(cardMenu);

      const wrapper: HTMLElement | null =
        view.containerEl?.querySelector(".canvas-wrapper") || view.containerEl;
      if (wrapper) this.ensureDropZone(wrapper, canvas);
    }
  }

  private ensureButton(cardMenu: HTMLElement): void {
    if (cardMenu.querySelector(".rico-icon-drop-btn")) return;

    const btn = document.createElement("div");
    btn.className = "canvas-card-menu-button clickable-icon rico-icon-drop-btn";
    btn.setAttribute("aria-label", "Drag to add icon");
    btn.setAttribute("draggable", "true");
    setIcon(btn, "sparkles");
    setTooltip(btn, "Drag to add icon", { placement: "top" });

    btn.addEventListener("dragstart", (e: DragEvent) => {
      if (!e.dataTransfer) return;
      e.dataTransfer.setData(ICON_DRAG_MIME, "1");
      e.dataTransfer.effectAllowed = "copy";
    });

    btn.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      const iconize = getIconizePlugin(this.plugin.app);
      if (!iconize) {
        new Notice("Iconize plugin is not enabled");
        return;
      }
      new Notice("Drag this button onto the canvas to drop an icon");
    });

    const layersBtn = cardMenu.querySelector(".rich-canvas-layers-btn");
    if (layersBtn) layersBtn.insertAdjacentElement("afterend", btn);
    else cardMenu.appendChild(btn);
  }

  private ensureDropZone(wrapper: HTMLElement, canvas: any): void {
    if (this.dropZones.has(wrapper)) return;
    this.dropZones.add(wrapper);

    wrapper.addEventListener("dragover", (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes(ICON_DRAG_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });

    wrapper.addEventListener("drop", (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes(ICON_DRAG_MIME)) return;
      e.preventDefault();
      this.handleDrop(e, canvas);
    });
  }

  private handleDrop(e: DragEvent, canvas: any): void {
    const iconize = getIconizePlugin(this.plugin.app);
    if (!iconize) {
      new Notice("Iconize plugin is not enabled");
      return;
    }

    let pos = { x: 0, y: 0 };
    try {
      pos = canvas.posFromClient({ x: e.clientX, y: e.clientY });
    } catch (_) {
      /* fall back to origin */
    }

    new IconPickerModal(this.plugin.app, iconize, (shortcode) => {
      createIconNode(canvas, pos, shortcode);
    }).open();
  }
}
