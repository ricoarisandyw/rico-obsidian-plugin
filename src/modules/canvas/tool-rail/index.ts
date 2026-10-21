/**
 * A Photoshop-style vertical tool rail pinned to the left edge of a canvas.
 *
 * Every rico canvas button used to inject itself into Obsidian's card menu,
 * where each module re-ran its own placement logic and the last writer won.
 * The rail owns placement instead: modules register a button spec and the rail
 * decides order, so re-syncs are idempotent and no module clobbers another.
 */

import { setIcon, setTooltip } from "obsidian";

export interface RailButtonSpec {
  /** Stable identifier, also the class suffix and the dedupe key. */
  id: string;
  /** Lucide icon name passed to setIcon(). */
  icon: string;
  /** Tooltip and aria-label text. */
  label: string;
  /** Lower sorts nearer the top of the rail. */
  order: number;
  /** Extra classes the owning module styles or queries by. */
  className?: string;
  /** Marks the button as a drag source; the module wires its own dragstart. */
  draggable?: boolean;
  onClick?: (e: MouseEvent, btn: HTMLElement) => void;
  /** Called once per freshly created element, for module-specific listeners. */
  onCreate?: (btn: HTMLElement) => void;
}

const RAIL_CLASS = "rico-canvas-rail";

/** Specs are global: every canvas rail renders the same set of buttons. */
const specs = new Map<string, RailButtonSpec>();

/**
 * Register (or replace) a button. Safe to call before any canvas is open, and
 * safe to call repeatedly: callers run inside MutationObserver handlers, so an
 * unconditional DOM write here would retrigger the observer and spin forever.
 * Re-registering an identical spec is therefore a no-op.
 */
export function registerRailButton(spec: RailButtonSpec): void {
  const prev = specs.get(spec.id);
  if (prev && sameSpec(prev, spec)) return;
  specs.set(spec.id, spec);
  syncRails();
}

/**
 * Compare the fields that affect rendering or ordering. Callbacks are rebuilt
 * on every sync pass by their owning module, so comparing them by identity
 * would make every spec look new and defeat the guard above.
 */
function sameSpec(a: RailButtonSpec, b: RailButtonSpec): boolean {
  return (
    a.icon === b.icon &&
    a.label === b.label &&
    a.order === b.order &&
    a.className === b.className &&
    !!a.draggable === !!b.draggable
  );
}

/** Drop a button from every rail, used when a feature is switched off. */
export function unregisterRailButton(id: string): void {
  specs.delete(id);
  document.querySelectorAll(`.${RAIL_CLASS}-btn-${id}`).forEach((el) => el.remove());
}

/** Find the rail for a canvas wrapper, creating it on first use. */
function ensureRail(wrapper: HTMLElement): HTMLElement {
  // A direct-child scan rather than ":scope >", which not every DOM
  // implementation we run against supports.
  for (const child of Array.from(wrapper.children)) {
    if (child.classList.contains(RAIL_CLASS)) return child as HTMLElement;
  }
  const rail = document.createElement("div");
  rail.className = RAIL_CLASS;
  rail.setAttribute("role", "toolbar");
  rail.setAttribute("aria-label", "Rico canvas tools");
  wrapper.appendChild(rail);
  return rail;
}

/** Build any missing buttons on one rail and put them all in order. */
export function syncRail(wrapper: HTMLElement): void {
  if (!wrapper.isConnected) return;
  const rail = ensureRail(wrapper);
  const ordered = [...specs.values()].sort((a, b) => a.order - b.order);

  let index = 0;
  for (const spec of ordered) {
    let btn = rail.querySelector<HTMLElement>(`.${RAIL_CLASS}-btn-${spec.id}`);
    if (!btn) {
      btn = document.createElement("button");
      btn.className = `${RAIL_CLASS}-btn ${RAIL_CLASS}-btn-${spec.id} clickable-icon${
        spec.className ? ` ${spec.className}` : ""
      }`;
      setIcon(btn, spec.icon);
      btn.setAttribute("aria-label", spec.label);
      setTooltip(btn, spec.label, { placement: "right" });
      if (spec.draggable) btn.setAttribute("draggable", "true");
      if (spec.onClick) {
        const handler = spec.onClick;
        btn.addEventListener("click", (e: MouseEvent) => {
          e.stopPropagation();
          handler(e, btn as HTMLElement);
        });
      }
      spec.onCreate?.(btn);
    }
    // appendChild on an existing child moves it, so this both adds and
    // reorders -- but an unconditional move is a DOM write on every pass, and
    // callers run inside MutationObserver handlers. Only move when out of place.
    const atIndex = rail.children[index];
    if (atIndex !== btn) rail.insertBefore(btn, atIndex ?? null);
    index++;
  }
}

/** Re-sync every rail currently in the document. */
export function syncRails(): void {
  document.querySelectorAll<HTMLElement>(`.${RAIL_CLASS}`).forEach((rail) => {
    const wrapper = rail.parentElement;
    if (wrapper) syncRail(wrapper);
  });
}

/** Look up a live button, for modules that toggle active state. */
export function getRailButtons(id: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  document.querySelectorAll<HTMLElement>(`.${RAIL_CLASS}-btn-${id}`).forEach((el) => out.push(el));
  return out;
}

/** Toggle a class on every instance of one button across all rails. */
export function setRailButtonActive(id: string, active: boolean, cls = "is-active"): void {
  for (const btn of getRailButtons(id)) {
    // Only write when it actually changes; see registerRailButton on why a
    // redundant attribute write is not free here.
    if (btn.classList.contains(cls) !== active) btn.classList.toggle(cls, active);
  }
}

/** Tear down all rails, used on plugin unload. */
export function removeAllRails(): void {
  document.querySelectorAll(`.${RAIL_CLASS}`).forEach((el) => el.remove());
}
