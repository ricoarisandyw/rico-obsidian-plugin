import { describe, it, expect } from "vitest";
import {
  allowedExtensions,
  checkFileName,
  joinPath,
  resolveTargetFolder,
} from "../src/modules/new-file/logic";

const ALLOWED = ["md", "html", "js", "ts", "css", "json"];

describe("allowedExtensions", () => {
  it("always allows md and adds the settings list", () => {
    expect(allowedExtensions("html, .JS; *.ts", true)).toEqual(["md", "html", "js", "ts"]);
  });

  it("is md only when the code editor is off", () => {
    expect(allowedExtensions("html, js", false)).toEqual(["md"]);
  });

  it("does not repeat md", () => {
    expect(allowedExtensions("md, json", true)).toEqual(["md", "json"]);
  });
});

describe("checkFileName", () => {
  it("accepts a valid name and keeps its extension", () => {
    expect(checkFileName("data.json", ALLOWED)).toEqual({ ok: true, path: "data.json", extension: "json", addedMd: false });
  });

  it("is case-insensitive for the extension", () => {
    const r = checkFileName("DATA.JSON", ALLOWED);
    expect(r).toMatchObject({ ok: true, extension: "json", path: "DATA.JSON" });
  });

  it("adds .md when there is no extension", () => {
    expect(checkFileName("notes", ALLOWED)).toEqual({ ok: true, path: "notes.md", extension: "md", addedMd: true });
  });

  it("accepts subfolders and trims spaces", () => {
    expect(checkFileName("  utils/helpers.ts  ", ALLOWED)).toMatchObject({ ok: true, path: "utils/helpers.ts", extension: "ts" });
    expect(checkFileName("/a/b/c.css", ALLOWED)).toMatchObject({ ok: true, path: "a/b/c.css" });
  });

  it("rejects empty and whitespace-only names", () => {
    expect(checkFileName("", ALLOWED).ok).toBe(false);
    expect(checkFileName("   ", ALLOWED).ok).toBe(false);
  });

  it("rejects illegal characters", () => {
    for (const bad of ["bad:name.md", "a*b.md", "a?b.md", 'a"b.md', "a<b.md", "a|b.md", "a\\b.md"]) {
      expect(checkFileName(bad, ALLOWED).ok).toBe(false);
    }
  });

  it("rejects an extension that is not allowed and lists the allowed ones", () => {
    const r = checkFileName("run.exe", ALLOWED);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain(".exe");
      expect(r.error).toContain("json");
    }
  });

  it("rejects hidden names, odd folder parts and trailing dots or slashes", () => {
    for (const bad of [".env", ".hidden/x.md", "a//b.md", "../x.md", "a/./b.md", "notes.", "utils/"]) {
      expect(checkFileName(bad, ALLOWED).ok).toBe(false);
    }
  });

  it("rejects a name that is too long", () => {
    expect(checkFileName("a".repeat(300) + ".md", ALLOWED).ok).toBe(false);
  });
});

describe("resolveTargetFolder and joinPath", () => {
  it("uses the clicked folder itself", () => {
    expect(resolveTargetFolder("30-Learn/Raw", true)).toBe("30-Learn/Raw");
  });

  it("uses the parent folder of a clicked file", () => {
    expect(resolveTargetFolder("30-Learn/Raw/a.md", false)).toBe("30-Learn/Raw");
    expect(resolveTargetFolder("a.md", false)).toBe("");
  });

  it("treats the vault root as an empty path", () => {
    expect(resolveTargetFolder("/", true)).toBe("");
    expect(resolveTargetFolder("", true)).toBe("");
  });

  it("joins folder and name, handling the root", () => {
    expect(joinPath("A/B", "x.ts")).toBe("A/B/x.ts");
    expect(joinPath("", "x.ts")).toBe("x.ts");
  });
});
