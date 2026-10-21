/**
 * Mode logic for the search box.
 *
 * No Obsidian imports, so it can be tested without a vault. The view owns the
 * DOM; this owns the question "what should the panel be showing right now?".
 */

export type SearchMode = "query" | "follow-note";

/** A filled box pins the panel to that query; an empty one follows the note. */
export function resolveMode(query: string | null | undefined): SearchMode {
  return (query ?? "").trim().length > 0 ? "query" : "follow-note";
}

/** The text actually sent to the model, or null when there is nothing to search. */
export function normalizeQuery(query: string | null | undefined): string | null {
  const trimmed = (query ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Runs the latest call and drops the ones before it.
 *
 * Embedding costs real time, so firing one per keystroke would queue up work
 * the user no longer cares about.
 */
export class Debouncer {
  private timer: number | null = null;

  constructor(private delayMs: () => number) {}

  /** Replace any pending run with this one. */
  schedule(fn: () => void): void {
    this.cancel();
    const delay = Math.max(0, this.delayMs());
    this.timer = globalThis.setTimeout(() => {
      this.timer = null;
      fn();
    }, delay) as unknown as number;
  }

  /** Skip the wait and run now, e.g. when the user presses Enter. */
  flush(fn: () => void): void {
    this.cancel();
    fn();
  }

  cancel(): void {
    if (this.timer !== null) {
      globalThis.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  get isPending(): boolean {
    return this.timer !== null;
  }
}

/**
 * Hands out run tokens so a slow result cannot overwrite a newer one.
 *
 * Without this, a long query finishing after a short one would replace the
 * results the user is already reading.
 */
export class RunGuard {
  private current = 0;

  /** Start a run and get its token. */
  begin(): number {
    return ++this.current;
  }

  /** True when this token is still the newest run. */
  isCurrent(token: number): boolean {
    return token === this.current;
  }

  /** Invalidate anything in flight without starting a new run. */
  invalidate(): void {
    this.current++;
  }
}
