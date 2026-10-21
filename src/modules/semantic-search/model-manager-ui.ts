import { Modal, Notice, Platform, setIcon, type App } from "obsidian";
import { MODELS, formatBytes, type ModelSpec } from "./model-registry";
import {
  DownloadCancelled,
  DownloadFailed,
  type DownloadProgress,
  type ModelManager,
  type ModelStatus,
} from "./model-manager";

/**
 * The "Models" block in settings: one row per model with its state on disk and
 * a Download or Delete button.
 *
 * Progress lives on the manager, not in here, so closing and reopening
 * settings while a download runs picks the progress back up.
 */

const STATE_LABEL: Record<ModelStatus["state"], string> = {
  ready: "Ready",
  partial: "Incomplete",
  missing: "Not downloaded",
};

interface UiDeps {
  app: App;
  manager: ModelManager;
  /** Tell the plugin the files on disk changed. */
  onModelsChanged?: () => void;
  selectedKey: () => string;
  onSelect: (key: string) => Promise<void>;
  /** Model the current index was built with, so deleting it can warn. */
  indexedKey: () => string | null;
}

class ConfirmModal extends Modal {
  constructor(
    app: App,
    private opts: { title: string; body: string; confirmText: string; onConfirm: () => void },
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.opts.title);
    this.contentEl.createEl("p", { text: this.opts.body });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    const confirm = buttons.createEl("button", {
      cls: "mod-warning",
      text: this.opts.confirmText,
    });
    confirm.addEventListener("click", () => {
      this.close();
      this.opts.onConfirm();
    });
    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class ModelManagerUi {
  private root: HTMLElement | null = null;
  private statuses = new Map<string, ModelStatus>();
  private expanded = new Set<string>();
  private progress: DownloadProgress | null = null;
  private progressKey: string | null = null;

  constructor(private deps: UiDeps) {}

  /** Build the block into the given container and load disk state. */
  async render(container: HTMLElement): Promise<void> {
    this.root = container.createDiv({ cls: "rico-ss-models" });
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.deps.onModelsChanged?.();
    const list = await this.deps.manager.allStatuses();
    this.statuses = new Map(list.map((s) => [s.key, s]));
    this.draw();
  }

  private draw(): void {
    const root = this.root;
    if (!root) return;
    root.empty();

    const header = root.createDiv({ cls: "rico-ss-models-header" });
    header.createDiv({ cls: "rico-ss-models-title", text: "Models" });
    const refreshBtn = header.createEl("button", { cls: "rico-ss-icon-btn" });
    setIcon(refreshBtn, "refresh-cw");
    refreshBtn.setAttribute("aria-label", "Re-read the model folder");
    refreshBtn.addEventListener("click", () => void this.refresh());

    for (const spec of MODELS) this.drawRow(root, spec);
  }

  private drawRow(root: HTMLElement, spec: ModelSpec): void {
    const status = this.statuses.get(spec.key);
    const selected = this.deps.selectedKey() === spec.key;
    const busy = this.deps.manager.isDownloading;
    const downloadingThis = this.progressKey === spec.key && busy;

    const row = root.createDiv({
      cls: `rico-ss-model${selected ? " is-selected" : ""}`,
    });

    const top = row.createDiv({ cls: "rico-ss-model-top" });

    // Clicking the body selects the model.
    const main = top.createDiv({ cls: "rico-ss-model-main" });
    main.addEventListener("click", () => {
      if (busy) return;
      void this.deps.onSelect(spec.key).then(() => this.draw());
    });

    const nameRow = main.createDiv({ cls: "rico-ss-model-name" });
    nameRow.createSpan({ text: spec.name });
    if (selected) nameRow.createSpan({ cls: "rico-ss-chip", text: "In use" });

    const state = status?.state ?? "missing";
    const meta = main.createDiv({ cls: "rico-ss-model-meta" });
    const badge = meta.createSpan({ cls: `rico-ss-badge is-${state}`, text: STATE_LABEL[state] });
    if (state === "partial" && status) {
      badge.setText(`${STATE_LABEL.partial} (${status.presentCount}/${status.files.length})`);
    }
    const onDisk = status && status.bytes > 0 ? formatBytes(status.bytes) : spec.size;
    meta.createSpan({ text: `${onDisk} · ${spec.dims} dims` });
    meta.createSpan({ cls: "rico-ss-model-langs", text: spec.languages });

    const actions = top.createDiv({ cls: "rico-ss-model-actions" });

    if (downloadingThis) {
      const cancel = actions.createEl("button", { text: "Cancel" });
      cancel.addEventListener("click", () => this.deps.manager.cancel());
    } else if (state === "ready") {
      const del = actions.createEl("button", { cls: "mod-warning", text: "Delete" });
      del.disabled = busy;
      del.addEventListener("click", () => this.confirmDelete(spec));
    } else {
      const label = state === "partial" ? "Resume" : "Download";
      const dl = actions.createEl("button", { cls: "mod-cta", text: label });
      dl.disabled = busy;
      dl.addEventListener("click", () => void this.startDownload(spec));
    }

    const toggle = actions.createEl("button", { cls: "rico-ss-icon-btn" });
    setIcon(toggle, this.expanded.has(spec.key) ? "chevron-up" : "chevron-down");
    toggle.setAttribute("aria-label", "Show files");
    toggle.addEventListener("click", () => {
      if (this.expanded.has(spec.key)) this.expanded.delete(spec.key);
      else this.expanded.add(spec.key);
      this.draw();
    });

    // A 120MB download on mobile data is worth a heads-up, not a block.
    if (Platform.isMobile && state !== "ready" && !downloadingThis) {
      row.createDiv({
        cls: "rico-ss-model-hint",
        text: `About ${spec.size} — you may want to be on wifi.`,
      });
    }

    if (downloadingThis && this.progress) {
      const wrap = row.createDiv({ cls: "rico-ss-progress" });
      const bar = wrap.createDiv({ cls: "rico-ss-progress-bar" });
      bar.createDiv({
        cls: "rico-ss-progress-fill",
        attr: { style: `width: ${Math.round(this.progress.fraction * 100)}%` },
      });
      wrap.createDiv({
        cls: "rico-ss-progress-text",
        text:
          `${Math.round(this.progress.fraction * 100)}% · ` +
          `file ${this.progress.fileIndex + 1}/${this.progress.fileCount} · ${this.progress.file}`,
      });
    }

    if (this.expanded.has(spec.key) && status) {
      const files = row.createDiv({ cls: "rico-ss-model-files" });
      files.createDiv({ cls: "rico-ss-model-folder", text: status.folder });
      for (const file of status.files) {
        const line = files.createDiv({ cls: "rico-ss-model-file" });
        const icon = line.createSpan({ cls: "rico-ss-file-icon" });
        setIcon(icon, file.present ? "check" : "x");
        icon.addClass(file.present ? "is-present" : "is-absent");
        line.createSpan({ cls: "rico-ss-file-name", text: file.file });
        line.createSpan({
          cls: "rico-ss-file-size",
          text: file.present ? formatBytes(file.bytes) : "missing",
        });
      }
    }
  }

  private async startDownload(spec: ModelSpec): Promise<void> {
    this.progressKey = spec.key;
    this.progress = null;
    this.draw();

    try {
      const count = await this.deps.manager.download(spec.key, (p) => {
        this.progress = p;
        this.draw();
      });
      new Notice(
        count > 0
          ? `Downloaded ${spec.name}.`
          : `${spec.name} was already on disk.`,
      );
    } catch (err) {
      if (err instanceof DownloadCancelled) {
        new Notice("Download cancelled. Files already fetched were kept.");
      } else if (err instanceof DownloadFailed) {
        new Notice(`${err.message} Press Resume to try again.`, 10000);
        console.error("[semantic-search] download failed", err.cause);
      } else {
        new Notice("Download failed. See the developer console.", 8000);
        console.error("[semantic-search] download failed", err);
      }
    } finally {
      this.progressKey = null;
      this.progress = null;
      await this.refresh();
    }
  }

  private confirmDelete(spec: ModelSpec): void {
    const indexed = this.deps.indexedKey();
    const body =
      indexed === spec.key
        ? `This removes ${spec.name} from disk. Your index was built with this model, so related notes will stop working until you download it again or pick another model and re-index.`
        : `This removes ${spec.name} from disk. You can download it again later.`;

    new ConfirmModal(this.deps.app, {
      title: "Delete model?",
      body,
      confirmText: "Delete",
      onConfirm: () => {
        void (async () => {
          await this.deps.manager.remove(spec.key);
          new Notice(`Deleted ${spec.name}.`);
          await this.refresh();
        })();
      },
    }).open();
  }
}
