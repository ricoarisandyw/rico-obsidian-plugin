import { describe, expect, it, vi } from "vitest";
import { FileMenuRegistry } from "../src/shared/lib/menu-registry";
import type { MenuEntry } from "../src/shared/lib/menu-group";
import type { Menu, TAbstractFile } from "obsidian";

/** Stand-in for a clicked file; providers only look at the path here. */
function file(path: string): TAbstractFile {
  return { path, name: path } as TAbstractFile;
}

function entry(title: string): MenuEntry {
  return { title, onClick: () => undefined };
}

/** Minimal menu that records the rows and supports submenus. */
function fakeMenu() {
  const rows: { title?: string; children: string[] }[] = [];
  const menu = {
    addItem(cb: (item: unknown) => void) {
      const row: { title?: string; children: string[] } = { children: [] };
      const api: Record<string, unknown> = {
        setTitle(t: string) {
          row.title = t;
          return api;
        },
        setIcon: () => api,
        setSection: () => api,
        setDisabled: () => api,
        setIsLabel: () => api,
        onClick: () => api,
        setSubmenu: () => ({
          addItem(childCb: (item: unknown) => void) {
            const childApi: Record<string, unknown> = {
              setTitle(t: string) {
                row.children.push(t);
                return childApi;
              },
              setIcon: () => childApi,
              setSection: () => childApi,
              setDisabled: () => childApi,
              setIsLabel: () => childApi,
              onClick: () => childApi,
            };
            childCb(childApi);
            return this;
          },
        }),
      };
      rows.push(row);
      cb(api);
      return menu;
    },
  };
  return { menu: menu as unknown as Menu, rows };
}

function grouped(): FileMenuRegistry {
  return new FileMenuRegistry({ grouped: () => true });
}

describe("FileMenuRegistry", () => {
  it("collects from every provider", () => {
    const registry = grouped();
    registry.add(() => [entry("A")]);
    registry.add(() => [entry("B"), entry("C")]);
    expect(registry.collect(file("note.md")).map((e) => e.title)).toEqual(["A", "B", "C"]);
  });

  it("lets a provider opt out by returning nothing", () => {
    const registry = grouped();
    registry.add((f) => (f.path.endsWith(".md") ? [entry("A")] : []));
    expect(registry.collect(file("note.md"))).toHaveLength(1);
    expect(registry.collect(file("folder"))).toHaveLength(0);
  });

  it("passes the clicked file to each provider", () => {
    const registry = grouped();
    const provider = vi.fn(() => []);
    registry.add(provider);
    const target = file("deep/note.md");
    registry.collect(target);
    expect(provider).toHaveBeenCalledWith(target);
  });

  it("keeps going when one provider throws", () => {
    const registry = grouped();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    registry.add(() => {
      throw new Error("boom");
    });
    registry.add(() => [entry("survivor")]);
    expect(registry.collect(file("note.md")).map((e) => e.title)).toEqual(["survivor"]);
    spy.mockRestore();
  });

  it("puts everything under one parent row", () => {
    const registry = grouped();
    registry.add(() => [entry("A")]);
    registry.add(() => [entry("B")]);
    const { menu, rows } = fakeMenu();
    registry.fill(menu, file("note.md"));
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Rico Plugin");
    expect(rows[0].children).toEqual(["A", "B"]);
  });

  it("adds nothing when no provider offers anything", () => {
    const registry = grouped();
    registry.add(() => []);
    const { menu, rows } = fakeMenu();
    registry.fill(menu, file("note.md"));
    expect(rows).toHaveLength(0);
  });

  it("goes flat when grouping is switched off", () => {
    const registry = new FileMenuRegistry({ grouped: () => false });
    registry.add(() => [entry("A"), entry("B")]);
    const { menu, rows } = fakeMenu();
    registry.fill(menu, file("note.md"));
    expect(rows.map((r) => r.title)).toEqual(["A", "B"]);
  });

  it("reads the toggle live, not once at construction", () => {
    let on = true;
    const registry = new FileMenuRegistry({ grouped: () => on });
    registry.add(() => [entry("A")]);

    const first = fakeMenu();
    registry.fill(first.menu, file("note.md"));
    expect(first.rows[0].title).toBe("Rico Plugin");

    on = false;
    const second = fakeMenu();
    registry.fill(second.menu, file("note.md"));
    expect(second.rows[0].title).toBe("A");
  });
});
