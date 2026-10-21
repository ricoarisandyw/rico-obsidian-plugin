import { ItemView, MarkdownRenderer, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { RoadmapCanvasNode, displayTitle, readRoadmapData, resolveArticle, saveRoadmapData } from "./logic";
import { PICKABLE_STATUSES, RoadmapStatus, STATUS_META } from "./types";

export const ROADMAP_PANEL_VIEW_TYPE = "rico-roadmap-article";

/**
 * Right-sidebar reader for a roadmap card: the status buttons across the top,
 * the linked note rendered below. Read-only — "Open note" goes to a real editor.
 */
export class RoadmapArticleView extends ItemView {
  private node: RoadmapCanvasNode | null = null;
  /** Told the manager a card changed, so the canvas drawing can be refreshed. */
  private onStatusChange: (node: RoadmapCanvasNode) => void;

  private headerEl!: HTMLElement;
  private titleTextEl!: HTMLElement;
  private statusBarEl!: HTMLElement;
  private bodyEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, onStatusChange: (node: RoadmapCanvasNode) => void) {
    super(leaf);
    this.onStatusChange = onStatusChange;
  }

  getViewType(): string {
    return ROADMAP_PANEL_VIEW_TYPE;
  }

  getDisplayText(): string {
    const data = this.node ? readRoadmapData(this.node) : undefined;
    return data ? displayTitle(data) : "Roadmap article";
  }

  getIcon(): string {
    return "map";
  }

  async onOpen(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("rico-roadmap-panel");

    this.headerEl = root.createDiv({ cls: "rico-roadmap-panel-header" });
    this.titleTextEl = this.headerEl.createEl("h2", { cls: "rico-roadmap-panel-title" });
    this.statusBarEl = this.headerEl.createDiv({ cls: "rico-roadmap-panel-status" });
    this.bodyEl = root.createDiv({ cls: "rico-roadmap-panel-body" });

    this.renderEmpty("Click a roadmap card on your canvas to read its note here.");
  }

  /** Point the panel at a card and draw it. */
  async show(node: RoadmapCanvasNode): Promise<void> {
    this.node = node;
    await this.refresh();
  }

  /** True when the panel is currently showing this exact node. */
  isShowing(node: RoadmapCanvasNode): boolean {
    return this.node === node;
  }

  /** Redraw from the node's current data (after a status flip or an edit). */
  async refresh(): Promise<void> {
    const data = this.node ? readRoadmapData(this.node) : undefined;
    if (!this.node || !data) {
      this.titleTextEl.setText("Roadmap article");
      this.statusBarEl.empty();
      this.renderEmpty("Click a roadmap card on your canvas to read its note here.");
      return;
    }

    this.titleTextEl.setText(displayTitle(data));
    this.renderStatusBar(data.status);

    const file = resolveArticle(this.app, data);
    this.bodyEl.empty();

    if (!data.articlePath) {
      this.renderEmpty("No note is linked to this card yet. Right-click the card and choose “Edit roadmap node” to link one.");
    } else if (!file) {
      this.renderEmpty(`The linked note is missing: ${data.articlePath}`);
    } else {
      await this.renderArticle(file);
    }

    this.renderLinks(data.links);
  }

  private renderStatusBar(current: RoadmapStatus): void {
    this.statusBarEl.empty();
    for (const status of PICKABLE_STATUSES) {
      const meta = STATUS_META[status];
      const active = current === status;
      const btn = this.statusBarEl.createEl("button", {
        cls: `rico-roadmap-status-btn ${meta.cls}${active ? " is-active" : ""}`,
        attr: { type: "button", "aria-pressed": String(active) },
      });
      setIcon(btn.createSpan(), meta.icon);
      btn.createSpan({ text: meta.label });
      btn.addEventListener("click", () => {
        if (!this.node) return;
        const data = readRoadmapData(this.node);
        if (!data) return;
        // Clicking the active status clears it back to "not started".
        const next: RoadmapStatus = data.status === status ? "none" : status;
        saveRoadmapData(this.node, { ...data, status: next });
        this.onStatusChange(this.node);
        void this.refresh();
      });
    }
  }

  private async renderArticle(file: TFile): Promise<void> {
    const actions = this.bodyEl.createDiv({ cls: "rico-roadmap-panel-actions" });
    const open = actions.createEl("button", { text: "Open note", attr: { type: "button" } });
    open.addEventListener("click", () => {
      void this.app.workspace.getLeaf("tab").openFile(file);
    });
    actions.createSpan({ cls: "rico-roadmap-panel-path", text: file.path });

    const article = this.bodyEl.createDiv({ cls: "rico-roadmap-panel-article markdown-rendered" });
    try {
      const markdown = await this.app.vault.cachedRead(file);
      await MarkdownRenderer.render(this.app, markdown, article, file.path, this);
    } catch (err) {
      article.setText(`Could not read the note: ${(err as Error).message}`);
    }
  }

  private renderLinks(links: { label: string; url: string }[]): void {
    if (links.length === 0) return;
    const section = this.bodyEl.createDiv({ cls: "rico-roadmap-panel-links" });
    section.createEl("h4", { text: "Resources" });
    for (const link of links) {
      const row = section.createDiv({ cls: "rico-roadmap-panel-link" });
      const a = row.createEl("a", { text: link.label, href: link.url });
      a.setAttr("target", "_blank");
      a.setAttr("rel", "noopener");
    }
  }

  private renderEmpty(message: string): void {
    this.bodyEl.empty();
    this.bodyEl.createDiv({ cls: "rico-roadmap-panel-empty", text: message });
  }

  async onClose(): Promise<void> {
    this.node = null;
  }
}

/** Open the panel in the right sidebar, reusing the tab when it is already there. */
export async function openRoadmapPanel(
  app: ItemView["app"],
  node: RoadmapCanvasNode
): Promise<void> {
  const { workspace } = app;
  let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(ROADMAP_PANEL_VIEW_TYPE)[0] ?? null;
  if (!leaf) {
    leaf = workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice("No room in the right sidebar for the roadmap panel.");
      return;
    }
    await leaf.setViewState({ type: ROADMAP_PANEL_VIEW_TYPE, active: true });
  }
  await workspace.revealLeaf(leaf);
  const view = leaf.view as RoadmapArticleView;
  await view.show(node);
}

/** Refresh every open panel that is showing this node. */
export function refreshPanelsFor(app: ItemView["app"], node: RoadmapCanvasNode): void {
  for (const leaf of app.workspace.getLeavesOfType(ROADMAP_PANEL_VIEW_TYPE)) {
    const view = leaf.view as RoadmapArticleView;
    if (view.isShowing(node)) void view.refresh();
  }
}
