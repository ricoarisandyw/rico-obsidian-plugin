import { describe, it, expect } from "vitest";
import { languageIdFor, usesJsx } from "../src/modules/code-editor/language-map";

describe("code editor language map", () => {
  it("maps each extension to its language", () => {
    expect(languageIdFor("json")).toBe("json");
    expect(languageIdFor("jsonc")).toBe("json");
    for (const e of ["js", "mjs", "cjs", "jsx"]) expect(languageIdFor(e)).toBe("javascript");
    for (const e of ["ts", "mts", "cts", "tsx"]) expect(languageIdFor(e)).toBe("typescript");
    expect(languageIdFor("css")).toBe("css");
    expect(languageIdFor("html")).toBe("html");
    expect(languageIdFor("htm")).toBe("html");
  });

  it("is case-insensitive and accepts a leading dot", () => {
    expect(languageIdFor("TS")).toBe("typescript");
    expect(languageIdFor(".Json")).toBe("json");
    expect(languageIdFor("  css ")).toBe("css");
  });

  it("falls back to plain text for unknown or empty extensions", () => {
    expect(languageIdFor("py")).toBeNull();
    expect(languageIdFor("md")).toBeNull();
    expect(languageIdFor("")).toBeNull();
  });

  it("only turns on JSX for jsx and tsx", () => {
    expect(usesJsx("jsx")).toBe(true);
    expect(usesJsx("TSX")).toBe(true);
    expect(usesJsx("ts")).toBe(false);
    expect(usesJsx("js")).toBe(false);
  });
});
