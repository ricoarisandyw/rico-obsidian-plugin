import { describe, it, expect } from "vitest";
import { INTRO_TITLE, ID_PREFIX, findHeadings, flatten, parseSections } from "../src/modules/canvas/note-to-canvas/parser";
import { DEFAULT_LAYOUT, layoutSections } from "../src/modules/canvas/note-to-canvas/layout";
import { REMOVED_MARK, buildCanvas, cardText, isForeignCanvas, mergeCanvas } from "../src/modules/canvas/note-to-canvas/builder";
import { canvasPathFor } from "../src/modules/canvas/note-to-canvas/paths";

const titles = (sections: { title: string }[]): string[] => sections.map((s) => s.title);

const NOTE = [
  "Some intro text.",
  "",
  "# Plan",
  "The big picture.",
  "",
  "## Goals",
  "Ship it.",
  "",
  "## Risks",
  "Scope creep.",
  "",
  "### Mitigation",
  "Say no.",
].join("\n");

describe("findHeadings", () => {
  it("ignores a # inside a fenced code block", () => {
    const lines = ["# Real", "```bash", "# not a heading", "```", "## Also real"].join("\n").split("\n");
    expect(findHeadings(lines).map((h) => h.title)).toEqual(["Real", "Also real"]);
  });

  it("handles ~~~ fences too, and an unclosed fence swallows the rest", () => {
    const lines = ["~~~", "# hidden", "~~~", "# shown", "```", "# also hidden"].join("\n").split("\n");
    expect(findHeadings(lines).map((h) => h.title)).toEqual(["shown"]);
  });
});

describe("parseSections", () => {
  it("builds the parent/child tree from heading levels", () => {
    const roots = parseSections(NOTE);
    expect(titles(roots)).toEqual([INTRO_TITLE, "Plan"]);

    const plan = roots[1];
    expect(titles(plan.children)).toEqual(["Goals", "Risks"]);
    expect(titles(plan.children[1].children)).toEqual(["Mitigation"]);
    expect(plan.children[1].children[0].parentId).toBe(plan.children[1].id);
  });

  it("keeps text before the first heading as an intro section", () => {
    const roots = parseSections(NOTE);
    expect(roots[0].title).toBe(INTRO_TITLE);
    expect(roots[0].body).toBe("Some intro text.");
    expect(roots[0].parentId).toBeNull();
  });

  it("captures the body up to the next heading", () => {
    const plan = parseSections(NOTE)[1];
    expect(plan.body).toBe("The big picture.");
    expect(plan.children[0].body).toBe("Ship it.");
  });

  it("makes one card for a note with no headings", () => {
    const roots = parseSections("just a paragraph\n\nand another");
    expect(roots).toHaveLength(1);
    expect(roots[0].title).toBe(INTRO_TITLE);
    expect(roots[0].body).toBe("just a paragraph\n\nand another");
  });

  it("returns nothing for an empty note", () => {
    expect(parseSections("   \n\n  ")).toEqual([]);
  });

  it("folds headings deeper than maxDepth into the parent body", () => {
    const roots = parseSections(NOTE, 2);
    const risks = roots[1].children[1];
    expect(risks.children).toEqual([]);
    expect(risks.body).toContain("### Mitigation");
    expect(risks.body).toContain("Say no.");
  });

  it("gives duplicate sibling headings distinct ids", () => {
    const roots = parseSections("## Notes\na\n\n## Notes\nb");
    expect(roots[0].id).not.toBe(roots[1].id);
    expect(roots[1].id).toContain("(2)");
  });

  it("builds ids from the full heading path", () => {
    const goals = parseSections(NOTE)[1].children[0];
    expect(goals.id).toBe(`${ID_PREFIX}Plan/Goals`);
  });
});

describe("layoutSections", () => {
  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  it("puts children in the column to the right of their parent", () => {
    const placed = layoutSections(parseSections(NOTE));
    const byTitle = new Map(placed.map((p) => [p.section.title, p]));
    expect(byTitle.get("Goals")!.x).toBeGreaterThan(byTitle.get("Plan")!.x);
    expect(byTitle.get("Mitigation")!.x).toBeGreaterThan(byTitle.get("Risks")!.x);
  });

  it("never overlaps two cards", () => {
    const placed = layoutSections(parseSections(NOTE));
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(overlaps(placed[i], placed[j])).toBe(false);
      }
    }
  });

  it("honours a custom card size", () => {
    const placed = layoutSections(parseSections(NOTE), { cardWidth: 100, cardHeight: 50 });
    expect(placed.every((p) => p.width === 100 && p.height === 50)).toBe(true);
  });

  it("uses the default size when nothing is passed", () => {
    const placed = layoutSections(parseSections("# One"));
    expect(placed[0].width).toBe(DEFAULT_LAYOUT.cardWidth);
  });
});

describe("buildCanvas", () => {
  it("makes one node per section", () => {
    const roots = parseSections(NOTE);
    const data = buildCanvas(roots);
    expect(data.nodes).toHaveLength(flatten(roots).length);
    expect(data.nodes.every((n) => n.type === "text")).toBe(true);
  });

  it("connects each child to its parent and nothing else", () => {
    const roots = parseSections(NOTE);
    const data = buildCanvas(roots);
    const children = flatten(roots).filter((s) => s.parentId);
    expect(data.edges).toHaveLength(children.length);
    for (const edge of data.edges) {
      const child = flatten(roots).find((s) => s.id === edge.toNode);
      expect(child?.parentId).toBe(edge.fromNode);
    }
  });

  it("puts the heading and body in the card", () => {
    const goals = parseSections(NOTE)[1].children[0];
    expect(cardText(goals, {})).toBe("## Goals\n\nShip it.");
  });

  it("embeds a link back to the note when the body is left out", () => {
    const goals = parseSections(NOTE)[1].children[0];
    expect(cardText(goals, { includeBody: false, notePath: "notes/Plan.md" })).toBe(
      "## Goals\n\n![[notes/Plan#Goals]]"
    );
  });
});

describe("mergeCanvas", () => {
  const fresh = buildCanvas(parseSections(NOTE));

  it("keeps the position the user dragged a card to", () => {
    const moved = { ...fresh.nodes[0], x: 9999, y: 8888, width: 123, height: 45 };
    const merged = mergeCanvas({ nodes: [moved], edges: [] }, fresh);
    const node = merged.nodes.find((n) => n.id === moved.id)!;
    expect([node.x, node.y, node.width, node.height]).toEqual([9999, 8888, 123, 45]);
  });

  it("refreshes the text of a card it made before", () => {
    const stale = { ...fresh.nodes[0], text: "old text" };
    const merged = mergeCanvas({ nodes: [stale], edges: [] }, fresh);
    expect(merged.nodes.find((n) => n.id === stale.id)!.text).toBe(fresh.nodes[0].text);
  });

  it("adds sections that are new since the last run", () => {
    const merged = mergeCanvas({ nodes: [fresh.nodes[0]], edges: [] }, fresh);
    expect(merged.nodes).toHaveLength(fresh.nodes.length);
  });

  it("marks a card whose heading is gone instead of deleting it", () => {
    const orphan = { id: `${ID_PREFIX}Gone`, type: "text", text: "leftover", x: 0, y: 0, width: 10, height: 10 };
    const merged = mergeCanvas({ nodes: [orphan], edges: [] }, fresh);
    const kept = merged.nodes.find((n) => n.id === orphan.id)!;
    expect(kept.text).toContain(REMOVED_MARK);
  });

  it("does not stack the removed mark on every re-run", () => {
    const orphan = { id: `${ID_PREFIX}Gone`, type: "text", text: `leftover\n\n${REMOVED_MARK}`, x: 0, y: 0, width: 10, height: 10 };
    const merged = mergeCanvas({ nodes: [orphan], edges: [] }, fresh);
    const text = merged.nodes.find((n) => n.id === orphan.id)!.text as string;
    expect(text.match(new RegExp(REMOVED_MARK.replace(/%/g, "\\%"), "g"))).toHaveLength(1);
  });

  it("leaves cards the user added by hand alone", () => {
    const mine = { id: "my-own-card", type: "text", text: "mine", x: 5, y: 5, width: 10, height: 10 };
    const merged = mergeCanvas({ nodes: [mine], edges: [] }, fresh);
    expect(merged.nodes.find((n) => n.id === "my-own-card")).toEqual(mine);
  });

  it("drops a user edge whose endpoints are gone", () => {
    const edge = { id: "mine", fromNode: "a", toNode: "b" };
    const merged = mergeCanvas({ nodes: [], edges: [edge] }, fresh);
    expect(merged.edges.find((e) => e.id === "mine")).toBeUndefined();
  });

  it("does not duplicate generated edges across runs", () => {
    const once = mergeCanvas(fresh, fresh);
    expect(once.edges).toHaveLength(fresh.edges.length);
  });
});

describe("isForeignCanvas", () => {
  it("is true for a canvas with only hand-made cards", () => {
    expect(isForeignCanvas({ nodes: [{ id: "x", type: "text" }], edges: [] })).toBe(true);
  });

  it("is false for an empty canvas and for one we generated", () => {
    expect(isForeignCanvas({ nodes: [], edges: [] })).toBe(false);
    expect(isForeignCanvas({ nodes: [{ id: `${ID_PREFIX}A` }], edges: [] })).toBe(false);
  });
});

describe("canvasPathFor", () => {
  it("saves beside the note when no folder is set", () => {
    expect(canvasPathFor("notes/Plan.md", "")).toBe("notes/Plan.canvas");
  });

  it("saves into the configured folder", () => {
    expect(canvasPathFor("notes/Plan.md", "Canvas")).toBe("Canvas/Plan.canvas");
    expect(canvasPathFor("notes/Plan.md", "/Canvas/")).toBe("Canvas/Plan.canvas");
  });

  it("handles a note at the vault root", () => {
    expect(canvasPathFor("Plan.md", "")).toBe("Plan.canvas");
  });
});
