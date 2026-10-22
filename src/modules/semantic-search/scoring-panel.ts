import { setIcon } from "obsidian";
import { rebalanceWeights, type ScorerKey, type ScorerWeights } from "./scoring";
import type { RicoPluginSettings } from "../../types";

/**
 * The collapsible scoring controls inside the panel.
 *
 * The same knobs exist in settings, but tuning weights is something you do
 * while looking at results, so they need to be reachable without leaving the
 * sidebar.
 */

const SCORERS: { key: ScorerKey; label: string; hint: string }[] = [
  { key: "vector", label: "Vector", hint: "Meaning. Finds notes that are about the same thing." },
  { key: "exact", label: "Exact", hint: "Literal text. Needs the term to actually appear." },
  { key: "fuzzy", label: "Fuzzy", hint: "Near misses. Tolerates typos and partial words." },
];

/**
 * Which settings keys this panel edits.
 *
 * The graph view wants the same three sliders but its own weights, so tuning
 * one panel never silently changes the other. Rather than copy the widget, the
 * panel is told which keys to read and write.
 */
export interface ScoringKeys {
  use: Record<ScorerKey, keyof RicoPluginSettings>;
  weight: Record<ScorerKey, keyof RicoPluginSettings>;
  /** Omitted when the view has no exact-required option, as the graph does not. */
  exactRequired?: keyof RicoPluginSettings;
}

export const SEARCH_SCORING_KEYS: ScoringKeys = {
  use: {
    vector: "semanticSearchUseVector",
    exact: "semanticSearchUseExact",
    fuzzy: "semanticSearchUseFuzzy",
  },
  weight: {
    vector: "semanticSearchWeightVector",
    exact: "semanticSearchWeightExact",
    fuzzy: "semanticSearchWeightFuzzy",
  },
  exactRequired: "semanticSearchExactRequired",
};

export const GRAPH_SCORING_KEYS: ScoringKeys = {
  use: {
    vector: "semanticGraphUseVector",
    exact: "semanticGraphUseExact",
    fuzzy: "semanticGraphUseFuzzy",
  },
  weight: {
    vector: "semanticGraphWeightVector",
    exact: "semanticGraphWeightExact",
    fuzzy: "semanticGraphWeightFuzzy",
  },
};

interface PanelDeps {
  settings: () => RicoPluginSettings;
  save: () => Promise<void>;
  /** Re-run the search after a change. */
  onChange: () => void;
  /** Defaults to the search panel's own keys. */
  keys?: ScoringKeys;
}

export class ScoringPanel {
  private bodyEl!: HTMLElement;
  private summaryEl!: HTMLElement;
  private expanded = false;

  constructor(private deps: PanelDeps) {}

  render(container: HTMLElement): void {
    const root = container.createDiv({ cls: "rico-ss-scoring" });

    const head = root.createDiv({ cls: "rico-ss-scoring-head" });
    head.addEventListener("click", () => {
      this.expanded = !this.expanded;
      this.draw();
    });
    const chevron = head.createSpan({ cls: "rico-ss-scoring-chevron" });
    setIcon(chevron, "chevron-right");
    head.createSpan({ cls: "rico-ss-scoring-title", text: "Scoring" });
    this.summaryEl = head.createSpan({ cls: "rico-ss-scoring-summary" });

    this.bodyEl = root.createDiv({ cls: "rico-ss-scoring-body" });
    this.draw();
  }

  /** Short line showing which scorers are on, so the collapsed state still informs. */
  private summary(): string {
    const s = this.deps.settings();
    const on = SCORERS.filter(({ key }) => this.isOn(key, s)).map(({ label }) => label);
    return on.length ? on.join(" + ") : "none enabled";
  }

  private get keys(): ScoringKeys {
    return this.deps.keys ?? SEARCH_SCORING_KEYS;
  }

  private isOn(key: ScorerKey, s: RicoPluginSettings): boolean {
    return !!s[this.keys.use[key]];
  }

  private setOn(key: ScorerKey, value: boolean, s: RicoPluginSettings): void {
    (s as unknown as Record<string, unknown>)[this.keys.use[key]] = value;
  }

  private weights(s: RicoPluginSettings): ScorerWeights {
    const { weight } = this.keys;
    return {
      vector: s[weight.vector] as number,
      exact: s[weight.exact] as number,
      fuzzy: s[weight.fuzzy] as number,
    };
  }

  private writeWeights(w: ScorerWeights, s: RicoPluginSettings): void {
    const { weight } = this.keys;
    const target = s as unknown as Record<string, unknown>;
    target[weight.vector] = w.vector;
    target[weight.exact] = w.exact;
    target[weight.fuzzy] = w.fuzzy;
  }

  draw(): void {
    const s = this.deps.settings();
    this.summaryEl.setText(this.summary());

    const head = this.summaryEl.parentElement;
    const chevron = head?.querySelector(".rico-ss-scoring-chevron");
    if (chevron instanceof HTMLElement) {
      setIcon(chevron, this.expanded ? "chevron-down" : "chevron-right");
    }

    this.bodyEl.empty();
    this.bodyEl.toggleClass("is-hidden", !this.expanded);
    if (!this.expanded) return;

    for (const { key, label, hint } of SCORERS) {
      const row = this.bodyEl.createDiv({ cls: "rico-ss-scorer" });

      const top = row.createDiv({ cls: "rico-ss-scorer-top" });
      const toggle = top.createEl("input", {
        cls: "rico-ss-scorer-toggle",
        attr: { type: "checkbox" },
      }) as HTMLInputElement;
      toggle.checked = this.isOn(key, s);
      toggle.addEventListener("change", () => {
        this.setOn(key, toggle.checked, s);
        void this.deps.save().then(() => {
          this.draw();
          this.deps.onChange();
        });
      });

      top.createSpan({ cls: "rico-ss-scorer-label", text: label });
      const value = top.createSpan({
        cls: "rico-ss-scorer-value",
        text: this.weights(s)[key].toFixed(2),
      });

      const slider = row.createEl("input", {
        cls: "rico-ss-scorer-slider",
        attr: { type: "range", min: "0", max: "1", step: "0.05" },
      }) as HTMLInputElement;
      slider.value = String(this.weights(s)[key]);
      slider.disabled = !this.isOn(key, s);

      // Show the number while dragging, but only save on release: every save
      // writes to disk and re-runs the search.
      slider.addEventListener("input", () => {
        value.setText(Number(slider.value).toFixed(2));
      });
      slider.addEventListener("change", () => {
        // Moving one slider pushes the others so the three always total 1.
        const next = rebalanceWeights(this.weights(s), key, Number(slider.value));
        this.writeWeights(next, s);
        void this.deps.save().then(() => {
          this.draw();
          this.deps.onChange();
        });
      });

      row.createDiv({ cls: "rico-ss-scorer-hint", text: hint });
    }

    const total =
      this.weights(s).vector + this.weights(s).exact + this.weights(s).fuzzy;
    this.bodyEl.createDiv({
      cls: "rico-ss-scoring-total",
      text: `Total: ${total.toFixed(2)}`,
    });

    // The graph has no exact-required option, so the row is skipped entirely.
    const requiredKey = this.keys.exactRequired;
    if (!requiredKey) return;

    const required = this.bodyEl.createDiv({ cls: "rico-ss-scoring-option" });
    const requiredBox = required.createEl("input", {
      attr: { type: "checkbox" },
    }) as HTMLInputElement;
    requiredBox.checked = !!s[requiredKey];
    requiredBox.addEventListener("change", () => {
      (s as unknown as Record<string, unknown>)[requiredKey] = requiredBox.checked;
      void this.deps.save().then(() => this.deps.onChange());
    });
    required.createSpan({ text: "Exact match is required" });
    this.bodyEl.createDiv({
      cls: "rico-ss-scorer-hint",
      text: "On: drop notes without the term. Off: they just score 0 for exact.",
    });
  }
}
