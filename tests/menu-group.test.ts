import { describe, expect, it, vi } from "vitest";
import { addGroupedItems, type MenuEntry } from "../src/shared/lib/menu-group";
import type { Menu } from "obsidian";

/**
 * Two fake menus: one that supports the undocumented setSubmenu, one that does
 * not. The whole point of the helper is behaving sensibly on both, so both are
 * exercised against the same entries.
 */

interface FakeItem {
  title?: string;
  icon?: string;
  section?: string;
  disabled?: boolean;
  isLabel?: boolean;
  click?: () => void;
  submenu?: FakeMenu;
}

class FakeMenu {
  items: FakeItem[] = [];

  constructor(private withSubmenu: boolean) {}

  addItem(cb: (item: unknown) => void): this {
    const record: FakeItem = {};
    const api: Record<string, unknown> = {
      setTitle(title: string) {
        record.title = title;
        return api;
      },
      setIcon(icon: string) {
        record.icon = icon;
        return api;
      },
      setSection(section: string) {
        record.section = section;
        return api;
      },
      setDisabled(disabled: boolean) {
        record.disabled = disabled;
        return api;
      },
      setIsLabel(isLabel: boolean) {
        record.isLabel = isLabel;
        return api;
      },
      onClick(fn: () => void) {
        record.click = fn;
        return api;
      },
    };
    if (this.withSubmenu) {
      api.setSubmenu = () => {
        const child = new FakeMenu(true);
        record.submenu = child;
        return child;
      };
    }
    this.items.push(record);
    cb(api);
    return this;
  }
}

function menuWithSubmenu(): FakeMenu {
  return new FakeMenu(true);
}

function menuWithoutSubmenu(): FakeMenu {
  return new FakeMenu(false);
}

/** Cast past the fake's shape; the helper only uses addItem. */
function asMenu(menu: FakeMenu): Menu {
  return menu as unknown as Menu;
}

function entries(...titles: string[]): MenuEntry[] {
  return titles.map((title) => ({ title, onClick: () => undefined }));
}

describe("addGroupedItems with submenu support", () => {
  it("reports that it used a submenu", () => {
    const menu = menuWithSubmenu();
    expect(addGroupedItems(asMenu(menu), entries("A", "B"))).toBe("submenu");
  });

  it("adds exactly one row to the root menu", () => {
    const menu = menuWithSubmenu();
    addGroupedItems(asMenu(menu), entries("A", "B", "C"));
    expect(menu.items).toHaveLength(1);
  });

  it("names the parent row", () => {
    const menu = menuWithSubmenu();
    addGroupedItems(asMenu(menu), entries("A"));
    expect(menu.items[0].title).toBe("Rico Plugin");
  });

  it("takes a custom label", () => {
    const menu = menuWithSubmenu();
    addGroupedItems(asMenu(menu), entries("A"), { label: "Open in terminal" });
    expect(menu.items[0].title).toBe("Open in terminal");
  });

  it("puts every entry inside the submenu", () => {
    const menu = menuWithSubmenu();
    addGroupedItems(asMenu(menu), entries("A", "B", "C"));
    expect(menu.items[0].submenu?.items.map((i) => i.title)).toEqual(["A", "B", "C"]);
  });

  it("wires each entry's click through", () => {
    const menu = menuWithSubmenu();
    const onClick = vi.fn();
    addGroupedItems(asMenu(menu), [{ title: "A", onClick }]);
    menu.items[0].submenu?.items[0].click?.();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("carries the icon and disabled flag onto the entry", () => {
    const menu = menuWithSubmenu();
    addGroupedItems(asMenu(menu), [
      { title: "A", icon: "terminal", disabled: true, onClick: () => undefined },
    ]);
    const inner = menu.items[0].submenu?.items[0];
    expect(inner?.icon).toBe("terminal");
    expect(inner?.disabled).toBe(true);
  });

  it("puts the parent in the requested section", () => {
    const menu = menuWithSubmenu();
    addGroupedItems(asMenu(menu), entries("A"), { section: "action" });
    expect(menu.items[0].section).toBe("action");
  });
});

describe("addGroupedItems without submenu support", () => {
  it("reports that it fell back to a section", () => {
    const menu = menuWithoutSubmenu();
    expect(addGroupedItems(asMenu(menu), entries("A", "B"))).toBe("section");
  });

  it("still shows every entry", () => {
    const menu = menuWithoutSubmenu();
    addGroupedItems(asMenu(menu), entries("A", "B", "C"));
    // One label row plus the three entries.
    expect(menu.items).toHaveLength(4);
    expect(menu.items.slice(1).map((i) => i.title)).toEqual(["A", "B", "C"]);
  });

  it("turns the parent row into a non-clickable label", () => {
    const menu = menuWithoutSubmenu();
    addGroupedItems(asMenu(menu), entries("A"));
    expect(menu.items[0].isLabel).toBe(true);
    expect(menu.items[0].click).toBeUndefined();
  });

  it("keeps the label and its entries in one section", () => {
    const menu = menuWithoutSubmenu();
    addGroupedItems(asMenu(menu), entries("A", "B"));
    const sections = new Set(menu.items.map((i) => i.section));
    expect(sections.size).toBe(1);
  });

  it("still wires the clicks", () => {
    const menu = menuWithoutSubmenu();
    const onClick = vi.fn();
    addGroupedItems(asMenu(menu), [{ title: "A", onClick }]);
    menu.items[1].click?.();
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("addGroupedItems edge cases", () => {
  it("adds nothing at all for an empty list", () => {
    const menu = menuWithSubmenu();
    expect(addGroupedItems(asMenu(menu), [])).toBe("empty");
    expect(menu.items).toHaveLength(0);
  });

  it("skips the parent entirely when flat is asked for", () => {
    const menu = menuWithSubmenu();
    expect(addGroupedItems(asMenu(menu), entries("A", "B"), { flat: true })).toBe("flat");
    expect(menu.items.map((i) => i.title)).toEqual(["A", "B"]);
  });

  it("still works flat on a build without submenus", () => {
    const menu = menuWithoutSubmenu();
    addGroupedItems(asMenu(menu), entries("A"), { flat: true });
    expect(menu.items).toHaveLength(1);
    expect(menu.items[0].isLabel).toBeUndefined();
  });
});

describe("addGroupedItems with nested entries", () => {
  const nested = (): MenuEntry[] => [
    { title: "Plain", onClick: () => undefined },
    {
      title: "In System Actions",
      icon: "zap",
      onClick: () => undefined,
      children: entries("X", "Y"),
    },
  ];

  it("opens a second-level submenu for an entry with children", () => {
    const menu = menuWithSubmenu();
    addGroupedItems(asMenu(menu), nested());
    const group = menu.items[0].submenu?.items;
    expect(group?.map((i) => i.title)).toEqual(["Plain", "In System Actions"]);
    expect(group?.[1].submenu?.items.map((i) => i.title)).toEqual(["X", "Y"]);
  });

  it("wires clicks on the nested entries", () => {
    const menu = menuWithSubmenu();
    const onClick = vi.fn();
    addGroupedItems(asMenu(menu), [
      { title: "Group", onClick: () => undefined, children: [{ title: "X", onClick }] },
    ]);
    menu.items[0].submenu?.items[0].submenu?.items[0].click?.();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("lists the children after a label when submenus are unsupported", () => {
    const menu = menuWithoutSubmenu();
    addGroupedItems(asMenu(menu), nested());
    expect(menu.items.map((i) => i.title)).toEqual([
      "Rico Plugin",
      "Plain",
      "In System Actions",
      "X",
      "Y",
    ]);
    expect(menu.items[2].isLabel).toBe(true);
    expect(new Set(menu.items.map((i) => i.section)).size).toBe(1);
  });

  it("nests on the root menu when flat is asked for", () => {
    const menu = menuWithSubmenu();
    addGroupedItems(asMenu(menu), nested(), { flat: true });
    expect(menu.items.map((i) => i.title)).toEqual(["Plain", "In System Actions"]);
    expect(menu.items[1].submenu?.items).toHaveLength(2);
  });
});
