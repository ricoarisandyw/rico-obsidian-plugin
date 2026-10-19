import { App, Component, ItemView, MarkdownRenderer, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import { canvasPath, dataSignature, focusCanvasNode, readCanvasData } from "./data";
import { OutlineItem, buildOutline, OUTLINE_BASE_DEPTH, countItems, filterOutline, itemMarkdown } from "./logic";

export const CANVAS_OUTLINE_VIEW_TYPE = "rico-canvas-outline";

const POLL_MS = 1000;

/**
 * Remembers the canvas the user looked at last. Clicking the outline makes the
 * outline the active leaf, so "the active canvas" alone is not enough.
 */
export class CanvasLeafTracker {
  private last: WorkspaceLeaf | null = null;

  constructor(private app: App) {}

  update(leaf: WorkspaceLeaf | null): void {
    if (leaf?.view?.getViewType() === "canvas") this.last = leaf;
  }

  current(): WorkspaceLeaf | null {
    const leaves = this.app.workspace.getLeavesOfType("canvas");
    if (this.last && leaves.includes(this.last)) return this.last;
    return leaves[0] ?? null;
  }
}

/**
 * Read-only outline of the open canvas, shown as a markdown document.
 * Nothing here writes to the canvas.
 */
export class CanvasOutlineView extends ItemView {
  private metaEl!: HTMLElement;
  private listEl!: HTMLElement;
  private query = "";
  private signature = "";
  private renderId = 0;
  private items: OutlineItem[] = [];
  private path = "";
  private canvasLeaf: WorkspaceLeaf | null = null;
  /** Owns the rendered markdown; replaced on every redraw so old renders are cleaned up. */
  private renderer: Component | null = null;
  /** Collapsed branch ids, remembered per canvas file. */
  private collapsed = new Map<string, Set<string>>();

  constructor(leaf: WorkspaceLeaf, private tracker: CanvasLeafTracker) {
    super(leaf);
  }

  getViewType(): string {
    return CANVAS_OUTLINE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Canvas outline";
  }

  getIcon(): string {
    return "list-tree";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("rico-outline");

    const header = this.contentEl.createDiv({ cls: "rico-outline-header" });
    this.metaEl = header.createDiv({ cls: "rico-outline-meta" });
    const search = header.createEl("input", {
      cls: "rico-outline-search",
      attr: { type: "search", placeholder: "Cari node…" },
    });
    search.addEventListener("input", () => {
      this.query = search.value;
      this.draw();
    });
    this.listEl = this.contentEl.createDiv({ cls: "rico-outline-list" });

    const { workspace } = this.app;
    this.registerEvent(workspace.on("active-leaf-change", () => void this.refresh(true)));
    this.registerEvent(workspace.on("layout-change", () => void this.refresh(true)));
    // Canvas has no change event, so look again every second; unchanged data is skipped.
    this.registerInterval(window.setInterval(() => void this.refresh(false), POLL_MS));
    void this.refresh(true);
  }

  async onClose(): Promise<void> {
    this.renderId++;
    this.resetRenderer();
  }

  private resetRenderer(): Component {
    if (this.renderer) this.removeChild(this.renderer);
    this.renderer = this.addChild(new Component());
    return this.renderer;
  }

  private async refresh(force: boolean): Promise<void> {
    const id = ++this.renderId;
    const leaf = this.tracker.current();
    if (!leaf) {
      this.show(null, "Buka sebuah canvas");
      return;
    }
    const data = await readCanvasData(this.app, leaf);
    if (id !== this.renderId) return;
    if (!data) {
      this.show(null, "Canvas ini tidak bisa dibaca");
      return;
    }

    const path = canvasPath(leaf);
    const signature = `${path}|${dataSignature(data)}`;
    if (!force && signature === this.signature) return;
    this.signature = signature;

    this.canvasLeaf = leaf;
    this.path = path;
    this.items = buildOutline(data);
    this.draw();
  }

  /** Empty the panel and show a single message. */
  private show(path: string | null, text: string): void {
    this.signature = "";
    this.canvasLeaf = null;
    this.items = [];
    this.path = path ?? "";
    this.metaEl.setText("");
    this.resetRenderer();
    this.listEl.empty();
    this.listEl.createDiv({ cls: "rico-outline-empty", text });
  }

  private draw(): void {
    if (!this.canvasLeaf) return;
    const total = countItems(this.items);
    const name = this.path.replace(/^.*\//, "").replace(/\.canvas$/i, "") || "Canvas";
    this.metaEl.setText(`${name} · ${total} node`);

    this.resetRenderer();
    this.listEl.empty();
    if (total === 0) {
      this.listEl.createDiv({ cls: "rico-outline-empty", text: "Canvas ini kosong" });
      return;
    }
    const searching = this.query.trim() !== "";
    const shown = filterOutline(this.items, this.query);
    if (shown.length === 0) {
      this.listEl.createDiv({ cls: "rico-outline-empty", text: "Tidak ada hasil" });
      return;
    }
    this.drawTitle(name);
    this.drawItems(shown, OUTLINE_BASE_DEPTH, searching);
  }

  /** The canvas name as an H1, followed by a divider. */
  private drawTitle(name: string): void {
    const row = this.listEl.createDiv({ cls: "rico-outline-block rico-outline-title" });
    row.createSpan({ cls: "rico-outline-twisty" });
    const body = row.createDiv({ cls: "rico-outline-body markdown-rendered" });
    void this.renderMarkdown(`# ${name}`, body.createDiv({ cls: "rico-outline-content" }));
    body.createEl("hr");
  }

  /** `groupDepth` = how many headings sit above the list (the title counts as one). */
  private drawItems(list: OutlineItem[], groupDepth: number, searching: boolean): void {
    const collapsed = this.collapsed.get(this.path) ?? new Set<string>();
    for (const item of list) {
      const hasKids = item.children.length > 0;
      const isCollapsed = hasKids && !searching && collapsed.has(item.id);
      const markdown = itemMarkdown(item, groupDepth, false);

      if (markdown) {
        const row = this.listEl.createDiv({
          cls: `rico-outline-block rico-outline-${item.type === "group" ? "group" : "node"}`,
          attr: { "aria-label": item.label },
        });

        const twisty = row.createSpan({ cls: "rico-outline-twisty" });
        if (hasKids) {
          setIcon(twisty, isCollapsed ? "chevron-right" : "chevron-down");
          twisty.addEventListener("click", (event) => {
            event.stopPropagation();
            this.toggle(item.id);
          });
        }
        const body = row.createDiv({ cls: "rico-outline-body markdown-rendered" });
        void this.renderMarkdown(markdown, body.createDiv({ cls: "rico-outline-content" }));
        this.drawRelations(item, body);
        if (item.type !== "group") body.createEl("hr");
        row.addEventListener("click", (event) => {
          // Let links work as links; everything else zooms to the node.
          if ((event.target as HTMLElement).closest("a")) return;
          this.focus(item.id);
        });
      }

      if (hasKids && !isCollapsed) {
        this.drawItems(item.children, item.type === "group" ? groupDepth + 1 : groupDepth, searching);
      }
    }
  }

  /** The relations of a node as a bullet list; clicking a name zooms to that node. */
  private drawRelations(item: OutlineItem, parent: HTMLElement): void {
    if (item.relations.length === 0) return;
    const list = parent.createEl("ul", { cls: "rico-outline-relations" });
    for (const relation of item.relations) {
      const li = list.createEl("li");
      li.appendText(`${relation.arrow} `);
      const link = li.createEl("a", { cls: "rico-outline-relation", text: relation.label, attr: { href: "#" } });
      link.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.focus(relation.id);
      });
      if (relation.edgeLabel) li.createEl("em", { text: ` (${relation.edgeLabel})` });
    }
  }

  /** Render markdown into `el` and lock anything interactive (read-only). */
  private async renderMarkdown(markdown: string, el: HTMLElement): Promise<void> {
    if (!this.renderer) return;
    await MarkdownRenderer.render(this.app, markdown, el, this.path, this.renderer);
    el.querySelectorAll("input").forEach((input) => input.setAttribute("disabled", "true"));
  }

  private toggle(id: string): void {
    const set = this.collapsed.get(this.path) ?? new Set<string>();
    if (!set.delete(id)) set.add(id);
    this.collapsed.set(this.path, set);
    this.draw();
  }

  private focus(id: string): void {
    if (!this.canvasLeaf || !focusCanvasNode(this.app, this.canvasLeaf, id)) {
      new Notice("Node tidak ditemukan di canvas");
    }
  }
}
