import { describe, expect, it } from "vitest";

import {
  hasWikilink,
  parseWikilink,
  splitSubpath,
  stripWikilinks,
} from "../src/modules/mermaid-links/wikilink";

describe("parseWikilink", () => {
  it("reads a plain note name", () => {
    expect(parseWikilink("Admin Role")).toMatchObject({
      path: "Admin Role",
      linktext: "Admin Role",
      display: "Admin Role",
    });
  });

  it("shows the alias but links to the note", () => {
    expect(parseWikilink("Admin Role|Admin")).toMatchObject({
      path: "Admin Role",
      linktext: "Admin Role",
      display: "Admin",
    });
  });

  it("keeps a heading in the linktext", () => {
    expect(parseWikilink("Note#Section")).toMatchObject({
      path: "Note",
      subpath: "#Section",
      linktext: "Note#Section",
      display: "Note",
    });
  });

  it("keeps a block reference", () => {
    expect(parseWikilink("Note#^abc123")).toMatchObject({
      subpath: "#^abc123",
      linktext: "Note#^abc123",
    });
  });

  it("handles a link into the current note", () => {
    expect(parseWikilink("#Section")).toMatchObject({
      path: "",
      subpath: "#Section",
      display: "#Section",
    });
  });

  it("rejects an empty link", () => {
    expect(parseWikilink("   ")).toBeNull();
  });
});

describe("splitSubpath", () => {
  it("returns no subpath when there is no hash", () => {
    expect(splitSubpath("Note")).toEqual({ path: "Note", subpath: "" });
  });

  it("splits on the first hash only", () => {
    expect(splitSubpath("Note#A#B")).toEqual({ path: "Note", subpath: "#A#B" });
  });
});

describe("hasWikilink", () => {
  it("is false for a diagram with no links", () => {
    expect(hasWikilink("sequenceDiagram\n  A->>B: x")).toBe(false);
  });

  it("is true when a link is present", () => {
    expect(hasWikilink("sequenceDiagram\n  participant A as [[Admin]]")).toBe(true);
  });

  it("is false for a subroutine shape, which only looks like a link", () => {
    expect(hasWikilink("flowchart LR\n  A[[Sub]] --> B")).toBe(false);
  });

  it("does not get stuck across repeated calls", () => {
    const src = "participant A as [[Admin]]";
    expect(hasWikilink(src)).toBe(true);
    expect(hasWikilink(src)).toBe(true);
  });
});

describe("stripWikilinks", () => {
  it("leaves a diagram without links untouched", () => {
    const src = "sequenceDiagram\n  A->>B: hello";
    expect(stripWikilinks(src).source).toBe(src);
  });

  it("replaces a link with text mermaid can parse", () => {
    // `participant A as [[Admin]]` would otherwise reach mermaid as a
    // wikilink, which its parser does not accept.
    const { source } = stripWikilinks("sequenceDiagram\n  participant A as [[Admin Role]]");
    expect(source).toBe("sequenceDiagram\n  participant A as Admin Role");
    expect(source).not.toContain("[[");
  });

  it("maps the rendered text back to the link", () => {
    const { byDisplay } = stripWikilinks("participant A as [[Admin Role]]");
    expect(byDisplay.get("Admin Role")).toMatchObject({ linktext: "Admin Role" });
  });

  it("uses the alias as the key, since that is what the svg will show", () => {
    const { source, byDisplay } = stripWikilinks("participant A as [[Admin Role|Admin]]");
    expect(source).toContain("Admin");
    expect(source).not.toContain("Admin Role");
    expect(byDisplay.get("Admin")).toMatchObject({ linktext: "Admin Role" });
  });

  it("handles several links on one line", () => {
    const { source, byDisplay } = stripWikilinks("  [[A]] --> [[B]]");
    expect(source).toBe("  A --> B");
    expect(byDisplay.size).toBe(2);
  });

  it("keeps the first of two links that would show the same text", () => {
    const { byDisplay } = stripWikilinks("[[One|Same]] [[Two|Same]]");
    expect(byDisplay.size).toBe(1);
    expect(byDisplay.get("Same")).toMatchObject({ linktext: "One" });
  });

  it("leaves an unparseable link exactly as it was", () => {
    const { source } = stripWikilinks("A[[[]]]");
    expect(source).toBe("A[[[]]]");
  });

  it("does not mistake a subroutine node shape for a wikilink", () => {
    // `A[[Sub]]` is a real mermaid shape, written exactly like a wikilink.
    const { source, byDisplay } = stripWikilinks("flowchart LR\n  A[[Sub]] --> B");
    expect(source).toBe("flowchart LR\n  A[[Sub]] --> B");
    expect(byDisplay.size).toBe(0);
  });

  it("still finds a wikilink nested inside a subroutine shape", () => {
    const { source, byDisplay } = stripWikilinks("flowchart LR\n  A[[[[Admin]]]] --> B");
    expect(byDisplay.get("Admin")).toBeDefined();
    expect(source).toBe("flowchart LR\n  A[[Admin]] --> B");
  });

  it("keeps the alias when the link sits inside a node shape", () => {
    const { source, byDisplay } = stripWikilinks("flowchart LR\n  X[[[Admin Role|Admin]]] --> Y");
    expect(source).toBe("flowchart LR\n  X[Admin] --> Y");
    expect(byDisplay.get("Admin")).toMatchObject({ linktext: "Admin Role" });
  });

  it("strips links in a flowchart label too", () => {
    const { source, byDisplay } = stripWikilinks("flowchart LR\n  X[[[Admin]]] --> Y");
    // The surviving brackets are the node shape, not a wikilink.
    expect(source).toBe("flowchart LR\n  X[Admin] --> Y");
    expect(byDisplay.get("Admin")).toBeDefined();
  });
});
