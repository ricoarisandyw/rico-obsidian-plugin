import { setIcon } from "obsidian";
import {
  countActiveFilters,
  emptyFilters,
  parseList,
  type FileKind,
  type SearchFilters,
} from "./filters";

/**
 * The collapsible filter controls inside the panel.
 *
 * Filters belong next to the results, not buried in settings: you adjust them
 * while looking at what came back.
 */

interface PanelDeps {
  filters: () => SearchFilters;
  setFilters: (next: SearchFilters) => void;
  onChange: () => void;
}

/** "2026-01-31" -> epoch ms, or null when blank or unparseable. */
export function parseDate(value: string, endOfDay = false): number | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  const parsed = new Date(endOfDay ? `${trimmed}T23:59:59` : `${trimmed}T00:00:00`);
  const time = parsed.getTime();
  return Number.isFinite(time) ? time : null;
}

/** epoch ms -> "2026-01-31" for a date input. */
export function formatDate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export class FilterPanel {
  private bodyEl!: HTMLElement;
  private badgeEl!: HTMLElement;
  private chevronEl!: HTMLElement;
  private expanded = false;

  constructor(private deps: PanelDeps) {}

  render(container: HTMLElement): void {
    const root = container.createDiv({ cls: "rico-ss-filters" });

    const head = root.createDiv({ cls: "rico-ss-filters-head" });
    head.addEventListener("click", () => {
      this.expanded = !this.expanded;
      this.draw();
    });
    this.chevronEl = head.createSpan({ cls: "rico-ss-filters-chevron" });
    head.createSpan({ cls: "rico-ss-filters-title", text: "Filters" });
    this.badgeEl = head.createSpan({ cls: "rico-ss-filters-badge" });

    this.bodyEl = root.createDiv({ cls: "rico-ss-filters-body" });
    this.draw();
  }

  private update(patch: Partial<SearchFilters>): void {
    this.deps.setFilters({ ...this.deps.filters(), ...patch });
    this.draw();
    this.deps.onChange();
  }

  draw(): void {
    const filters = this.deps.filters();
    const active = countActiveFilters(filters);

    setIcon(this.chevronEl, this.expanded ? "chevron-down" : "chevron-right");
    this.badgeEl.setText(active ? `${active} active` : "none");
    this.badgeEl.toggleClass("is-active", active > 0);

    this.bodyEl.empty();
    this.bodyEl.toggleClass("is-hidden", !this.expanded);
    if (!this.expanded) return;

    // --- file kind ---
    const kindRow = this.bodyEl.createDiv({ cls: "rico-ss-filter-row" });
    kindRow.createDiv({ cls: "rico-ss-filter-label", text: "File type" });
    const kinds = kindRow.createDiv({ cls: "rico-ss-filter-chips" });
    for (const [kind, label] of [
      ["md", "Notes"],
      ["canvas", "Canvas"],
    ] as [FileKind, string][]) {
      const on = filters.kinds.includes(kind);
      const chip = kinds.createEl("button", {
        cls: `rico-ss-chip-btn${on ? " is-on" : ""}`,
        text: label,
      });
      chip.addEventListener("click", () => {
        // An empty list means "everything", which is the same as all selected.
        const next = on
          ? filters.kinds.filter((k) => k !== kind)
          : [...filters.kinds, kind];
        this.update({ kinds: next });
      });
    }

    // --- paths ---
    this.textRow(
      "Folder contains",
      filters.includePaths.join(", "),
      "Projects/, Daily/",
      (value) => this.update({ includePaths: parseList(value) }),
    );
    this.textRow(
      "Folder excludes",
      filters.excludePaths.join(", "),
      "Archive/, Templates/",
      (value) => this.update({ excludePaths: parseList(value) }),
    );

    // --- frontmatter ---
    this.textRow(
      "Property has",
      filters.frontmatterInclude.join(", "),
      "status:open, tags:work",
      (value) => this.update({ frontmatterInclude: parseList(value) }),
    );
    this.textRow(
      "Property excludes",
      filters.frontmatterExclude.join(", "),
      "status:done, draft",
      (value) => this.update({ frontmatterExclude: parseList(value) }),
    );

    // --- dates ---
    this.dateRow(
      "Created",
      filters.createdAfter,
      filters.createdBefore,
      (after, before) => this.update({ createdAfter: after, createdBefore: before }),
    );
    this.dateRow(
      "Updated",
      filters.updatedAfter,
      filters.updatedBefore,
      (after, before) => this.update({ updatedAfter: after, updatedBefore: before }),
    );

    if (active > 0) {
      const reset = this.bodyEl.createEl("button", {
        cls: "rico-ss-filter-reset",
        text: "Clear all filters",
      });
      reset.addEventListener("click", () => this.update(emptyFilters()));
    }
  }

  private textRow(
    label: string,
    value: string,
    placeholder: string,
    onCommit: (value: string) => void,
  ): void {
    const row = this.bodyEl.createDiv({ cls: "rico-ss-filter-row" });
    row.createDiv({ cls: "rico-ss-filter-label", text: label });
    const input = row.createEl("input", {
      cls: "rico-ss-filter-input",
      attr: { type: "text", placeholder },
    }) as HTMLInputElement;
    input.value = value;
    // Commit on blur or Enter, not per keystroke: each change re-runs the search.
    input.addEventListener("blur", () => onCommit(input.value));
    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        onCommit(input.value);
      }
    });
  }

  private dateRow(
    label: string,
    after: number | null,
    before: number | null,
    onCommit: (after: number | null, before: number | null) => void,
  ): void {
    const row = this.bodyEl.createDiv({ cls: "rico-ss-filter-row" });
    row.createDiv({ cls: "rico-ss-filter-label", text: label });
    const pair = row.createDiv({ cls: "rico-ss-filter-dates" });

    const fromEl = pair.createEl("input", {
      cls: "rico-ss-filter-input",
      attr: { type: "date", "aria-label": `${label} from` },
    }) as HTMLInputElement;
    fromEl.value = formatDate(after);

    pair.createSpan({ cls: "rico-ss-filter-dash", text: "–" });

    const toEl = pair.createEl("input", {
      cls: "rico-ss-filter-input",
      attr: { type: "date", "aria-label": `${label} to` },
    }) as HTMLInputElement;
    toEl.value = formatDate(before);

    const commit = () => onCommit(parseDate(fromEl.value), parseDate(toEl.value, true));
    fromEl.addEventListener("change", commit);
    toEl.addEventListener("change", commit);
  }
}
