import { ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type { Embedder } from "./embedder";
import { MissingModelError } from "./embedder";
import type { VectorStore } from "./store";
import type { IndexSync } from "./sync";
import { search, type SearchResult } from "./search";
import { Debouncer, RunGuard, normalizeQuery, resolveMode } from "./query-state";
import { ScoringPanel } from "./scoring-panel";
import { FilterPanel } from "./filter-panel";
import { emptyFilters, type SearchFilters } from "./filters";
import type { ScoreBreakdown, ScorerToggles, ScorerWeights } from "./scoring";
import type { RicoPluginSettings } from "../../types";

export const SEMANTIC_SEARCH_VIEW_TYPE = "rico-semantic-search";

interface ViewDeps {
  store: VectorStore;
  embedder: Embedder;
  sync: IndexSync;
  settings: () => RicoPluginSettings;
  /** Persist a settings change made from inside the panel. */
  save: () => Promise<void>;
}

/**
 * Right-sidebar panel with two modes.
 *
 * Type in the box and it searches that text; leave it empty and it follows the
 * note you are reading. The box's contents decide the mode, so there is no
 * toggle that can disagree with what is on screen.
 *
 * Read-only: nothing here changes a note.
 */
export class SemanticSearchView extends ItemView {
  private inputEl!: HTMLInputElement;
  private exactEl!: HTMLInputElement;
  private clearEl!: HTMLElement;
  private exactClearEl!: HTMLElement;
  private scoringPanel!: ScoringPanel;
  private filterPanel!: FilterPanel;
  /** Session-scoped: filters reset when Obsidian restarts. */
  private filters: SearchFilters = emptyFilters();
  private contextEl!: HTMLElement;
  private listEl!: HTMLElement;
  private statusEl!: HTMLElement;

  private query = "";
  private exactQuery = "";
  private currentPath = "";
  /** Rows whose score breakdown is open, keyed by path. */
  private expandedRows = new Set<string>();
  /** Stops an older lookup from overwriting a newer one. */
  private readonly guard = new RunGuard();
  private readonly debouncer: Debouncer;
  /** Collapses the two events a single note switch fires into one run. */
  private readonly noteSwitch = new Debouncer(() => 150);

  constructor(
    leaf: WorkspaceLeaf,
    private deps: ViewDeps,
  ) {
    super(leaf);
    this.debouncer = new Debouncer(() => this.deps.settings().semanticSearchDebounceMs);
  }

  getViewType(): string {
    return SEMANTIC_SEARCH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Semantic relation notes";
  }

  getIcon(): string {
    return "search";
  }

  async onOpen(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("rico-semantic-search");

    const header = root.createDiv({ cls: "rico-ss-header" });
    header.createEl("div", { cls: "rico-ss-title", text: "Semantic relation notes" });
    const refresh = header.createEl("button", { cls: "rico-ss-icon-btn" });
    setIcon(refresh, "refresh-cw");
    refresh.setAttribute("aria-label", "Refresh");
    refresh.addEventListener("click", () => void this.run(true));

    const box = root.createDiv({ cls: "rico-ss-searchbox" });
    const searchIcon = box.createSpan({ cls: "rico-ss-search-icon" });
    setIcon(searchIcon, "search");
    this.inputEl = box.createEl("input", {
      cls: "rico-ss-input",
      attr: { type: "text", placeholder: "Search by meaning…" },
    });
    this.clearEl = box.createEl("button", { cls: "rico-ss-icon-btn rico-ss-clear" });
    setIcon(this.clearEl, "x");
    this.clearEl.setAttribute("aria-label", "Clear search");
    this.clearEl.addEventListener("click", () => this.clearQuery());

    this.inputEl.addEventListener("input", () => {
      this.query = this.inputEl.value;
      this.syncClearButton();
      // An emptied box goes straight back to the active note: there is nothing
      // to embed, so waiting out the debounce would just feel sluggish.
      if (!normalizeQuery(this.query)) {
        this.debouncer.cancel();
        void this.run(true);
        return;
      }
      if (!this.deps.settings().semanticSearchAsYouType) return;
      this.debouncer.schedule(() => void this.run(true));
    });

    this.inputEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        this.debouncer.flush(() => void this.run(true));
      } else if (evt.key === "Escape") {
        evt.preventDefault();
        this.clearQuery();
      }
    });

    const exactBox = root.createDiv({ cls: "rico-ss-searchbox" });
    const quoteIcon = exactBox.createSpan({ cls: "rico-ss-search-icon rico-ss-quote" });
    quoteIcon.setText("\u0022");
    this.exactEl = exactBox.createEl("input", {
      cls: "rico-ss-input",
      attr: {
        type: "text",
        placeholder: 'Must contain…  "exact phrase" -exclude',
      },
    });
    this.exactClearEl = exactBox.createEl("button", { cls: "rico-ss-icon-btn rico-ss-clear" });
    setIcon(this.exactClearEl, "x");
    this.exactClearEl.setAttribute("aria-label", "Clear exact text");
    this.exactClearEl.addEventListener("click", () => {
      this.exactQuery = "";
      this.exactEl.value = "";
      this.syncClearButton();
      void this.run(true);
    });

    this.exactEl.addEventListener("input", () => {
      this.exactQuery = this.exactEl.value;
      this.syncClearButton();
      if (!this.deps.settings().semanticSearchAsYouType) return;
      this.debouncer.schedule(() => void this.run(true));
    });
    this.exactEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        this.debouncer.flush(() => void this.run(true));
      } else if (evt.key === "Escape") {
        evt.preventDefault();
        this.exactQuery = "";
        this.exactEl.value = "";
        this.syncClearButton();
        void this.run(true);
      }
    });

    this.scoringPanel = new ScoringPanel({
      settings: this.deps.settings,
      save: this.deps.save,
      onChange: () => void this.run(true),
    });
    this.scoringPanel.render(root);

    this.filterPanel = new FilterPanel({
      filters: () => this.filters,
      setFilters: (next) => {
        this.filters = next;
      },
      onChange: () => void this.run(true),
    });
    this.filterPanel.render(root);

    this.contextEl = root.createDiv({ cls: "rico-ss-context" });
    this.statusEl = root.createDiv({ cls: "rico-ss-status" });
    this.listEl = root.createDiv({ cls: "rico-ss-list" });

    this.syncClearButton();

    // These only matter in follow-note mode; run() ignores them while a query
    // is set, so results stay put while you look around the vault.
    // Both events fire for the same switch, so debounce them together and skip
    // the work entirely while the panel is not on screen.
    const onNoteChange = () => {
      if (!this.isVisible()) return;
      this.noteSwitch.schedule(() => void this.run());
    };
    this.registerEvent(this.app.workspace.on("active-leaf-change", onNoteChange));
    this.registerEvent(this.app.workspace.on("file-open", onNoteChange));

    await this.run(true);
  }

  private syncClearButton(): void {
    this.clearEl.toggleClass("is-hidden", !this.inputEl.value);
    this.exactClearEl.toggleClass("is-hidden", !this.exactEl.value);
  }

  private toggles(): ScorerToggles {
    const s = this.deps.settings();
    return {
      vector: s.semanticSearchUseVector,
      exact: s.semanticSearchUseExact,
      fuzzy: s.semanticSearchUseFuzzy,
    };
  }

  private weights(): ScorerWeights {
    const s = this.deps.settings();
    return {
      vector: s.semanticSearchWeightVector,
      exact: s.semanticSearchWeightExact,
      fuzzy: s.semanticSearchWeightFuzzy,
    };
  }

  /** Options shared by both modes, so scoring behaves the same either way. */
  private searchOptions(settings: RicoPluginSettings) {
    return {
      limit: settings.semanticSearchResultsLimit,
      excludeFilter: settings.semanticSearchExcludeFilter,
      minScore: settings.semanticSearchMinScore,
      exactQuery: normalizeQuery(this.exactQuery) ?? "",
      exactRequired: settings.semanticSearchExactRequired,
      weights: this.weights(),
      toggles: this.toggles(),
      filters: this.filters,
      // Read lazily: only entries that survive the cheaper filters get here.
      frontmatterOf: (path: string) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return null;
        return this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
      },
    };
  }

  private clearQuery(): void {
    this.debouncer.cancel();
    this.query = "";
    this.inputEl.value = "";
    this.syncClearButton();
    this.inputEl.blur();
    void this.run(true);
  }

  /** A hidden panel does not need to embed anything. */
  private isVisible(): boolean {
    return this.containerEl.isShown();
  }

  private activeFile(): TFile | null {
    const file = this.app.workspace.getActiveFile();
    return file && file.extension === "md" ? file : null;
  }

  /** Message plus an optional action button, used for every empty state. */
  private showStatus(message: string, action?: { label: string; onClick: () => void }): void {
    this.listEl.empty();
    this.statusEl.empty();
    this.statusEl.createEl("p", { text: message });
    if (action) {
      const btn = this.statusEl.createEl("button", {
        cls: "mod-cta rico-ss-action",
        text: action.label,
      });
      btn.addEventListener("click", action.onClick);
    }
  }

  private setContext(text: string, detail?: string): void {
    this.contextEl.empty();
    if (!text) return;
    this.contextEl.createSpan({ cls: "rico-ss-context-label", text });
    if (detail) this.contextEl.createSpan({ cls: "rico-ss-context-count", text: detail });
  }

  /**
   * Decide what the panel should show, then show it.
   * @param force re-run even when the target has not changed.
   */
  async run(force = false): Promise<void> {
    const settings = this.deps.settings();
    const queryText = normalizeQuery(this.query);
    const mode = resolveMode(this.query);
    const token = this.guard.begin();

    if (!(await this.deps.embedder.isReady())) {
      this.setContext("");
      this.showStatus(
        "No model downloaded yet. Open Settings -> Semantic Search and press Download.",
      );
      return;
    }

    if (this.deps.store.size === 0) {
      this.setContext("");
      this.showStatus("No notes indexed yet.", {
        label: "Index now",
        onClick: () => void this.runIndex(),
      });
      return;
    }

    if (mode === "query" && queryText) {
      await this.runQuery(queryText, token, settings);
      return;
    }

    // Typing only in the exact box is still a search, just without a vector.
    const exactOnly = normalizeQuery(this.exactQuery);
    if (exactOnly) {
      this.currentPath = "";
      const context = `Results for: "${exactOnly}"`;
      this.setContext(context);
      const results = search("", [], this.deps.store.all(), this.searchOptions(settings));
      this.renderResults(results, context);
      return;
    }

    await this.runFollowNote(force, token, settings);
  }

  /** Query mode: rank the index against whatever was typed. */
  private async runQuery(
    queryText: string,
    token: number,
    settings: RicoPluginSettings,
  ): Promise<void> {
    const context = `Results for: ${queryText}`;
    // Forget the note we were following, so clearing the box re-runs cleanly.
    this.currentPath = "";
    this.setContext(context);
    this.statusEl.setText("Searching…");

    try {
      const vec = await this.deps.embedder.embed(queryText, "query");
      if (!this.guard.isCurrent(token)) return;
      // No note to exclude here, so the target path is empty.
      const results = search("", vec, this.deps.store.all(), this.searchOptions(settings));
      this.renderResults(results, context);
    } catch (err) {
      if (!this.guard.isCurrent(token)) return;
      this.reportError(err);
    }
  }

  /** Follow-note mode: rank the index against the note being read. */
  private async runFollowNote(
    force: boolean,
    token: number,
    settings: RicoPluginSettings,
  ): Promise<void> {
    const file = this.activeFile();
    if (!file) {
      this.setContext("");
      this.showStatus("Open a markdown note, or type something to search.");
      return;
    }
    if (!force && file.path === this.currentPath && this.listEl.childElementCount) return;
    this.currentPath = file.path;

    const context = `Related to: ${file.basename}`;
    this.setContext(context);
    this.statusEl.setText("Searching…");

    try {
      // Prefer the stored vector. Re-embedding costs as much as indexing a note,
      // so it only happens when the note is genuinely missing from the index, or
      // when the user explicitly refreshed a note that has since changed.
      const cached = this.deps.store.get(file.path);
      let vec = cached?.vec;
      const staleButIndexed = !!cached && cached.mtime !== file.stat.mtime;
      if (!vec || (staleButIndexed && force)) {
        const raw = await this.app.vault.cachedRead(file);
        const max = settings.semanticSearchMaxChars;
        const text = `${file.basename}\n\n${raw}`;
        vec = await this.deps.embedder.embed(max > 0 ? text.slice(0, max) : text, "query");
      }
      if (!this.guard.isCurrent(token)) return;

      const results = search(file.path, vec ?? [], this.deps.store.all(), this.searchOptions(settings));
      this.renderResults(results, context);
    } catch (err) {
      if (!this.guard.isCurrent(token)) return;
      this.reportError(err);
    }
  }

  private reportError(err: unknown): void {
    if (err instanceof MissingModelError) {
      this.showStatus(err.message);
      return;
    }
    console.error("[semantic-search] search failed", err);
    this.showStatus("Something went wrong. Check the developer console.");
  }

  private async runIndex(): Promise<void> {
    const notice = new Notice("Semantic search: indexing…", 0);
    try {
      const result = await this.deps.sync.indexVault((done, total) => {
        notice.setMessage(`Semantic search: indexing ${done}/${total}`);
      });
      notice.hide();
      if (result.failed > 0) {
        console.error("[semantic-search] first indexing error", result.firstError);
        new Notice(
          `Semantic search: ${result.indexed} indexed, ${result.failed} failed. See the console.`,
          10000,
        );
      } else {
        new Notice(`Semantic search: indexed ${result.indexed} note(s).`);
      }
      await this.run(true);
    } catch (err) {
      notice.hide();
      const message =
        err instanceof MissingModelError ? err.message : "Indexing failed. See the console.";
      new Notice(message, 8000);
      console.error("[semantic-search] indexing failed", err);
    }
  }

  private renderResults(results: SearchResult[], context: string): void {
    this.statusEl.empty();
    this.listEl.empty();

    if (!results.length) {
      this.setContext(context);
      this.showStatus("Nothing matched closely enough. Try different wording.");
      return;
    }

    this.setContext(context, `${results.length} result${results.length === 1 ? "" : "s"}`);

    const showPath = this.deps.settings().semanticSearchShowFullPath;
    const showBreakdown = this.deps.settings().semanticSearchShowBreakdown;
    for (const result of results) {
      const file = this.app.vault.getAbstractFileByPath(result.path);
      if (!(file instanceof TFile)) continue;

      const wrapper = this.listEl.createDiv({ cls: "rico-ss-item-wrap" });
      const row = wrapper.createDiv({ cls: "rico-ss-item" });
      const main = row.createDiv({ cls: "rico-ss-item-main" });

      const nameRow = main.createDiv({ cls: "rico-ss-item-name" });
      if (result.kind === "canvas") {
        const icon = nameRow.createSpan({ cls: "rico-ss-kind-icon" });
        setIcon(icon, "layout-dashboard");
      }
      nameRow.createSpan({ text: file.basename });

      if (showPath) {
        main.createDiv({ cls: "rico-ss-item-path", text: file.parent?.path ?? "" });
      }

      // Percentage reads more naturally than a raw cosine value.
      const scoreEl = row.createDiv({ cls: "rico-ss-item-score" });
      scoreEl.createSpan({ text: `${Math.round(result.score * 100)}%` });

      const canExpand =
        showBreakdown && !!result.breakdown?.parts.some((part) => part.score != null);
      if (canExpand) {
        const caret = scoreEl.createSpan({ cls: "rico-ss-item-caret" });
        setIcon(caret, this.expandedRows.has(result.path) ? "chevron-up" : "chevron-down");
      }

      row.addEventListener("click", (evt) => {
        // Clicking the score area inspects the result; clicking the name opens it.
        if (canExpand && (evt.target as HTMLElement)?.closest(".rico-ss-item-score")) {
          evt.preventDefault();
          if (this.expandedRows.has(result.path)) this.expandedRows.delete(result.path);
          else this.expandedRows.add(result.path);
          this.renderResults(results, context);
          return;
        }
        void this.app.workspace.openLinkText(result.path, "", evt.ctrlKey || evt.metaKey);
      });
      row.addEventListener("mouseover", (evt) => {
        this.app.workspace.trigger("hover-link", {
          event: evt,
          source: SEMANTIC_SEARCH_VIEW_TYPE,
          hoverParent: this,
          targetEl: row,
          linktext: result.path,
        });
      });

      if (canExpand && this.expandedRows.has(result.path) && result.breakdown) {
        this.renderBreakdown(wrapper, result.breakdown);
      }
    }
  }

  /** Variant D: the per-scorer maths, shown only when a row is expanded. */
  private renderBreakdown(container: HTMLElement, breakdown: ScoreBreakdown): void {
    const box = container.createDiv({ cls: "rico-ss-breakdown" });
    for (const part of breakdown.parts) {
      if (part.score == null) continue;
      const line = box.createDiv({ cls: "rico-ss-breakdown-line" });
      line.createSpan({ cls: "rico-ss-bd-key", text: part.key });
      line.createSpan({
        cls: "rico-ss-bd-math",
        text: `${Math.round(part.score * 100)}% × ${part.weight.toFixed(2)}`,
      });
      line.createSpan({
        cls: "rico-ss-bd-value",
        text: (part.contribution * 100).toFixed(1),
      });
    }
    const total = box.createDiv({ cls: "rico-ss-breakdown-line is-total" });
    total.createSpan({ cls: "rico-ss-bd-key", text: "total" });
    total.createSpan({ cls: "rico-ss-bd-math", text: "" });
    total.createSpan({
      cls: "rico-ss-bd-value",
      text: `${(breakdown.total * 100).toFixed(1)}%`,
    });
  }

  async onClose(): Promise<void> {
    this.debouncer.cancel();
    this.guard.invalidate();
    this.listEl?.empty();
  }
}
