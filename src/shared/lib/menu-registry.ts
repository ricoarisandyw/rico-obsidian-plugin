import type { Menu, TAbstractFile } from "obsidian";
import { addGroupedItems, type MenuEntry } from "./menu-group";

/**
 * One "Rico Plugin" parent shared by every module.
 *
 * Each module registers its own `file-menu` listener, so none of them can see
 * what the others added — left alone they each push a row onto the root menu
 * and the grouping never happens. Instead they contribute *providers* here,
 * and this registers a single listener that asks every provider what it wants
 * to offer for the file being clicked, then adds the lot under one parent.
 *
 * A provider returning nothing is simply skipped, which is how the existing
 * conditions (folder only, quiz folder only, runnable file only) survive the
 * move unchanged.
 */

/** Decides what this module offers for the clicked file, if anything. */
export type MenuProvider = (file: TAbstractFile) => MenuEntry[];

export interface MenuRegistryOptions {
  /** Read live, so the settings toggle applies without a reload. */
  grouped: () => boolean;
  label?: string;
  icon?: string;
}

export class FileMenuRegistry {
  private providers: MenuProvider[] = [];

  constructor(private options: MenuRegistryOptions) {}

  /** Add a provider. Modules call this instead of registering their own listener. */
  add(provider: MenuProvider): void {
    this.providers.push(provider);
  }

  /**
   * Collect from every provider, skipping any that throws.
   *
   * One module misbehaving should cost its own menu entries, not the whole
   * right-click menu for every other module.
   */
  collect(file: TAbstractFile): MenuEntry[] {
    const entries: MenuEntry[] = [];
    for (const provider of this.providers) {
      try {
        entries.push(...provider(file));
      } catch (err) {
        console.error("[rico-menu] a menu provider failed", err);
      }
    }
    return entries;
  }

  /** Build the menu for one right-click. */
  fill(menu: Menu, file: TAbstractFile): void {
    const entries = this.collect(file);
    if (!entries.length) return;
    addGroupedItems(menu, entries, {
      label: this.options.label,
      icon: this.options.icon,
      flat: !this.options.grouped(),
    });
  }
}
