import { describe, it, expect } from "vitest";
import {
  anchorLine,
  collectBlockIds,
  generateBlockId,
  planBlockReference,
} from "../src/modules/block-reference/logic";

/** Apply a plan to the lines, the same way the editor does. */
function apply(lines: string[], line: number) {
  const plan = planBlockReference(lines, line, () => 0);
  if (!plan.ok || !plan.insert) return { plan, text: lines.join("\n") };
  const next = [...lines];
  next[plan.insert.line] += plan.insert.text;
  return { plan, text: next.join("\n") };
}

describe("planBlockReference: paragraphs", () => {
  it("adds the id to the end of the paragraph's last line", () => {
    const lines = ["Intro.", "", "First line of the paragraph", "second line.", "", "Next."];
    const { plan, text } = apply(lines, 2);
    expect(plan).toMatchObject({ ok: true, reused: false, id: "aaaaaa" });
    expect(text).toBe(
      ["Intro.", "", "First line of the paragraph", "second line. ^aaaaaa", "", "Next."].join("\n")
    );
  });

  it("gives the same result whichever line of the paragraph is selected", () => {
    const lines = ["one", "two", "three"];
    expect(apply(lines, 0).text).toBe(apply(lines, 2).text);
  });

  it("works on the last line of a note with no trailing newline", () => {
    expect(apply(["Only line"], 0).text).toBe("Only line ^aaaaaa");
  });

  it("reuses an id the paragraph already has", () => {
    const plan = planBlockReference(["Cited text. ^smith2024-p4"], 0);
    expect(plan).toEqual({ ok: true, id: "smith2024-p4", reused: true });
  });

  it("never picks an id that is already used in the note", () => {
    const lines = ["a ^aaaaaa", "", "b"];
    const values = [0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    let i = 0;
    const plan = planBlockReference(lines, 2, () => values[i++]);
    expect(plan).toMatchObject({ ok: true, reused: false });
    if (plan.ok) expect(plan.id).not.toBe("aaaaaa");
  });

  it("stops the paragraph at a list that follows it", () => {
    const lines = ["Paragraph", "- item"];
    expect(apply(lines, 0).text).toBe("Paragraph ^aaaaaa\n- item");
  });
});

describe("planBlockReference: other blocks", () => {
  it("puts the id on the list item, not the whole list", () => {
    const lines = ["- one", "- two", "- three"];
    expect(apply(lines, 1).text).toBe("- one\n- two ^aaaaaa\n- three");
  });

  it("covers a wrapped list item through its indented lines", () => {
    const lines = ["- one", "  still one", "- two"];
    expect(apply(lines, 0).text).toBe("- one\n  still one ^aaaaaa\n- two");
  });

  it("handles numbered and task list items", () => {
    expect(apply(["1. first"], 0).text).toBe("1. first ^aaaaaa");
    expect(apply(["- [ ] todo"], 0).text).toBe("- [ ] todo ^aaaaaa");
  });

  it("puts the id on its own line after a quote, with a blank line before", () => {
    const lines = ["> line one", "> line two", "", "after"];
    expect(apply(lines, 0).text).toBe("> line one\n> line two\n\n^aaaaaa\n\nafter");
  });

  it("treats a callout like a quote", () => {
    const lines = ["> [!quote] Smith", "> The text."];
    expect(apply(lines, 1).text).toBe("> [!quote] Smith\n> The text.\n\n^aaaaaa");
  });

  it("reuses the id that follows a quote on its own line", () => {
    const lines = ["> quoted", "", "^q1", "", "after"];
    expect(planBlockReference(lines, 0)).toEqual({ ok: true, id: "q1", reused: true });
  });

  it("finds the quote's id when the cursor is on the id line itself", () => {
    const lines = ["> quoted", "", "^q1"];
    expect(planBlockReference(lines, 2)).toEqual({ ok: true, id: "q1", reused: true });
  });

  it("puts the id after a table", () => {
    const lines = ["| a | b |", "| - | - |", "| 1 | 2 |"];
    expect(apply(lines, 2).text).toBe("| a | b |\n| - | - |\n| 1 | 2 |\n\n^aaaaaa");
  });

  it("puts the id after the closing fence of a code block, from any line inside it", () => {
    const lines = ["```ts", "const a = 1;", "", "const b = 2;", "```", "text"];
    expect(apply(lines, 3).text).toBe("```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n^aaaaaa\ntext");
  });
});

describe("planBlockReference: refuses", () => {
  it("a heading", () => {
    expect(planBlockReference(["## Title", "", "text"], 0)).toMatchObject({ ok: false });
  });

  it("a blank line", () => {
    expect(planBlockReference(["text", "", "more"], 1)).toMatchObject({ ok: false });
  });

  it("properties (frontmatter)", () => {
    const lines = ["---", "tags: a", "---", "", "text"];
    expect(planBlockReference(lines, 1)).toMatchObject({ ok: false });
    expect(planBlockReference(lines, 4)).toMatchObject({ ok: true });
  });

  it("a line outside the note", () => {
    expect(planBlockReference(["text"], 5)).toMatchObject({ ok: false });
  });
});

describe("helpers", () => {
  it("collects ids only from the end of a line", () => {
    const ids = collectBlockIds(["a ^one", "^two", "x^no", "price is ^3 here", "b ^four-5"]);
    expect([...ids].sort()).toEqual(["four-5", "one", "two"]);
  });

  it("generates 6 lowercase letters or digits", () => {
    expect(generateBlockId(new Set())).toMatch(/^[a-z0-9]{6}$/);
  });

  it("uses the last line of a selection, ignoring a trailing newline", () => {
    expect(anchorLine({ line: 2, ch: 0 }, { line: 4, ch: 7 })).toBe(4);
    expect(anchorLine({ line: 2, ch: 0 }, { line: 4, ch: 0 })).toBe(3);
    expect(anchorLine({ line: 2, ch: 3 }, { line: 2, ch: 0 })).toBe(2);
  });
});
