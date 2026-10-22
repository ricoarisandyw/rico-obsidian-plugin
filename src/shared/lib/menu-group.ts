import type { Menu, MenuItem } from "obsidian";

/**
 * Gathering this plugin's context-menu items under one parent.
 *
 * Without this, every module adds its items straight to the root menu and a
 * right-click turns into a wall of text with Obsidian's own entries buried in
 * it. One parent, "Rico Plugin", keeps the root to a single line.
 *
 * The catch: `setSubmenu()` is not in obsidian.d.ts (checked against 1.13.1),
 * even though Obsidian's own "Copy path" menu clearly uses it. It is an
 * internal API, so this file is the only place that touches it, and it falls
 * back to a labelled section when it is missing. That matters because the
 * manifest claims minAppVersion 1.4.0, where submenus may not exist at all.
 */

/** One row in the group. */
export interface MenuEntry {
  title: string;
  icon?: string;
  onClick: () => void;
  /** Greyed out but still visible, so the user knows the action exists. */
  disabled?: boolean;
}

/** A `MenuItem` that may carry the undocumented submenu method. */
type MaybeSubmenuItem = MenuItem & { setSubmenu?: () => Menu };

/**
 * True when this Obsidian build can nest a submenu.
 *
 * Probed on a real item rather than the prototype, because that is the object
 * the call would actually be made on.
 */
export function supportsSubmenu(item: MenuItem): boolean {
  return typeof (item as MaybeSubmenuItem).setSubmenu === "function";
}

/** Fill one menu with the given entries. Shared by both layouts. */
function addEntries(menu: Menu, entries: MenuEntry[]): void {
  for (const entry of entries) {
    menu.addItem((item) => {
      item.setTitle(entry.title);
      if (entry.icon) item.setIcon(entry.icon);
      if (entry.disabled) item.setDisabled(true);
      item.onClick(() => entry.onClick());
    });
  }
}

export interface GroupOptions {
  /** Text on the parent row. */
  label?: string;
  icon?: string;
  /** Section the parent sits in, so it lands in a predictable spot. */
  section?: string;
  /** Skip the grouping and add the entries flat, for the settings toggle. */
  flat?: boolean;
}

const DEFAULT_LABEL = "Rico Plugin";
const DEFAULT_ICON = "package";
/** Section used for the fallback, so the entries at least stay together. */
const FALLBACK_SECTION = "rico-plugin";

/**
 * Add entries to a menu, nested under one parent where that is possible.
 *
 * Three outcomes, in order of preference:
 *   - submenu available -> one parent row that opens into the entries
 *   - not available     -> the entries in their own section, under a label
 *   - `flat` requested  -> the entries straight on the root menu
 *
 * Returns what it actually did, which is what the tests assert on.
 */
export function addGroupedItems(
  menu: Menu,
  entries: MenuEntry[],
  options: GroupOptions = {},
): "submenu" | "section" | "flat" | "empty" {
  if (!entries.length) return "empty";

  if (options.flat) {
    addEntries(menu, entries);
    return "flat";
  }

  const label = options.label ?? DEFAULT_LABEL;
  const icon = options.icon ?? DEFAULT_ICON;

  // The probe has to happen inside addItem, since that is the only way to get
  // hold of a MenuItem. If submenus are not supported we have already added a
  // row, so it is turned into the section's label rather than left dangling.
  let mode: "submenu" | "section" = "section";
  menu.addItem((item) => {
    const candidate = item as MaybeSubmenuItem;
    if (supportsSubmenu(item)) {
      mode = "submenu";
      item.setTitle(label).setIcon(icon);
      if (options.section) item.setSection(options.section);
      const submenu = candidate.setSubmenu!();
      addEntries(submenu, entries);
      return;
    }

    // Fallback: this row becomes a heading for the section below it.
    item.setTitle(label).setIcon(icon).setIsLabel(true);
    item.setSection(options.section ?? FALLBACK_SECTION);
  });

  if (mode === "section") {
    const section = options.section ?? FALLBACK_SECTION;
    for (const entry of entries) {
      menu.addItem((item) => {
        item.setTitle(entry.title).setSection(section);
        if (entry.icon) item.setIcon(entry.icon);
        if (entry.disabled) item.setDisabled(true);
        item.onClick(() => entry.onClick());
      });
    }
  }

  return mode;
}
