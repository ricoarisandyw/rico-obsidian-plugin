import { describe, it, expect } from "vitest";
import { EXCLUDE_BASE_FILTER, baseName, buildBaseYaml, folderFilter, uniqueBasePath } from "../src/modules/folder-base/base-file";

/** Undo YAML single quoting, to check the filter survives the round trip. */
const unquote = (s: string): string => s.slice(1, -1).replace(/''/g, "'");
const filterLine = (yaml: string): string => yaml.split("\n").find((l) => l.startsWith("    - '"))!.slice(6);

describe("folderFilter", () => {
  it("keeps only the notes directly in the folder", () => {
    expect(folderFilter("Projects/Books")).toBe('file.folder == "Projects/Books"');
  });
});

describe("buildBaseYaml", () => {
  it("filters to the folder and lists name first, then the properties", () => {
    expect(buildBaseYaml("Books", ["status", "author", "pages"])).toBe(
      [
        "filters:",
        "  and:",
        `    - 'file.folder == "Books"'`,
        `    - '${EXCLUDE_BASE_FILTER}'`,
        "views:",
        "  - type: table",
        "    name: Table",
        "    order:",
        "      - file.name",
        "      - status",
        "      - author",
        "      - pages",
        "",
      ].join("\n"),
    );
  });

  it("has no folder filter for the whole vault, but still leaves out _BASE-* files", () => {
    const yaml = buildBaseYaml(null, ["status"]);
    expect(yaml).not.toContain("file.folder");
    expect(yaml.startsWith(`filters:\n  and:\n    - '${EXCLUDE_BASE_FILTER}'\nviews:`)).toBe(true);
  });

  it("always leaves out _BASE-* files, after the folder filter", () => {
    const lines = buildBaseYaml("Books", []).split("\n");
    const i = lines.indexOf(`    - '${EXCLUDE_BASE_FILTER}'`);
    expect(i).toBeGreaterThan(-1);
    expect(lines[i - 1]).toBe(`    - 'file.folder == "Books"'`);
  });

  it("does not repeat file.name or a property", () => {
    const yaml = buildBaseYaml("A", ["status", "file.name", "status"]);
    expect(yaml.match(/- file\.name/g)).toHaveLength(1);
    expect(yaml.match(/- status/g)).toHaveLength(1);
  });

  it("is still a valid table for a folder without properties", () => {
    expect(buildBaseYaml("Empty", [])).toBe(
      ["filters:", "  and:", `    - 'file.folder == "Empty"'`, `    - '${EXCLUDE_BASE_FILTER}'`, "views:", "  - type: table", "    name: Table", "    order:", "      - file.name", ""].join("\n"),
    );
  });

  it("keeps awkward folder names intact (colon, quotes, apostrophe, accents)", () => {
    for (const name of ['Catatan: "Ide"', "Rico's notes", "Ünïcode/日本語", "a #1 [x]"]) {
      expect(unquote(filterLine(buildBaseYaml(name, [])))).toBe(folderFilter(name));
    }
  });

  it("quotes property names that YAML could misread", () => {
    const yaml = buildBaseYaml("A", ["my prop", "a: b", "true", "yes", "2fast", "tags", "due-date", "_x"]);
    expect(yaml).toContain('      - "my prop"\n');
    expect(yaml).toContain('      - "a: b"\n');
    expect(yaml).toContain('      - "true"\n');
    expect(yaml).toContain('      - "yes"\n');
    expect(yaml).toContain('      - "2fast"\n');
    expect(yaml).toContain("      - tags\n");
    expect(yaml).toContain("      - due-date\n");
    expect(yaml).toContain("      - _x\n");
  });
});

describe("baseName", () => {
  it("prefixes the folder name with _BASE-", () => {
    expect(baseName("Books")).toBe("_BASE-Books");
  });

  it("uses Root for the whole vault", () => {
    expect(baseName(null)).toBe("_BASE-Root");
  });

  it("is matched by the exclude filter, numbered copies included", () => {
    expect(EXCLUDE_BASE_FILTER).toBe('!file.name.startsWith("_BASE-")');
  });
});

describe("uniqueBasePath", () => {
  it("uses the plain name when it is free", () => {
    expect(uniqueBasePath(() => false, "Books/", baseName("Books"))).toBe("Books/_BASE-Books.base");
  });

  it("adds a number until the name is free", () => {
    const taken = new Set(["Books/_BASE-Books.base", "Books/_BASE-Books 1.base"]);
    expect(uniqueBasePath((p) => taken.has(p), "Books/", baseName("Books"))).toBe("Books/_BASE-Books 2.base");
  });

  it("works for the vault root", () => {
    expect(uniqueBasePath((p) => p === "_BASE-Root.base", "", baseName(null))).toBe("_BASE-Root 1.base");
  });
});
