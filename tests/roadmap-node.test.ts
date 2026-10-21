import { describe, it, expect, vi } from "vitest";
import { TFile, TFolder } from "obsidian";
import {
  RoadmapCanvasNode,
  cycleStatus,
  displayTitle,
  readRoadmapData,
  resolveArticle,
  saveRoadmapData,
  writeRoadmapData,
  UNTITLED,
} from "../src/modules/canvas/roadmap-node/logic";
import {
  ROADMAP_NODE_TYPE,
  RoadmapStatus,
  STATUS_META,
  STATUS_ORDER,
} from "../src/modules/canvas/roadmap-node/types";
import { basename } from "../src/modules/canvas/roadmap-node/render";

/** Minimal stand-in for a canvas node: data in, data out. */
function makeNode(data: Record<string, unknown>): RoadmapCanvasNode & { data: Record<string, unknown> } {
  const node = {
    data,
    getData: () => node.data,
    setData: (next: Record<string, unknown>) => {
      node.data = next;
    },
    canvas: { requestSave: vi.fn() },
  };
  return node as RoadmapCanvasNode & { data: Record<string, unknown> };
}

function roadmapNode(payload: unknown) {
  return makeNode({ customNodeType: ROADMAP_NODE_TYPE, roadmapData: payload });
}

describe("readRoadmapData", () => {
  it("returns undefined for a plain text node", () => {
    expect(readRoadmapData(makeNode({ type: "text", text: "hello" }))).toBeUndefined();
  });

  it("returns undefined for a node with another plugin's custom type", () => {
    expect(readRoadmapData(makeNode({ customNodeType: "og-link", ogData: {} }))).toBeUndefined();
  });

  it("returns undefined when there is no node at all", () => {
    expect(readRoadmapData(undefined)).toBeUndefined();
  });

  it("parses a well-formed payload", () => {
    const node = roadmapNode({
      title: "Internet",
      status: "learning",
      articlePath: "10-Notes/Internet.md",
      links: [{ label: "MDN", url: "https://developer.mozilla.org" }],
    });
    expect(readRoadmapData(node)).toEqual({
      title: "Internet",
      status: "learning",
      articlePath: "10-Notes/Internet.md",
      links: [{ label: "MDN", url: "https://developer.mozilla.org" }],
    });
  });

  it("falls back to defaults for a half-written payload", () => {
    expect(readRoadmapData(roadmapNode({ title: "HTML" }))).toEqual({
      title: "HTML",
      status: "none",
      articlePath: "",
      links: [],
    });
  });

  it("does not throw on a hand-mangled payload", () => {
    const node = roadmapNode({ title: 42, status: "banana", articlePath: null, links: "nope" });
    expect(readRoadmapData(node)).toEqual({ title: "", status: "none", articlePath: "", links: [] });
  });

  it("treats a missing roadmapData blob as empty", () => {
    expect(readRoadmapData(makeNode({ customNodeType: ROADMAP_NODE_TYPE }))).toEqual({
      title: "",
      status: "none",
      articlePath: "",
      links: [],
    });
  });

  it("drops link entries without a usable url and labels the rest", () => {
    const node = roadmapNode({
      links: [
        { label: "Good", url: "https://a.test" },
        { label: "No url" },
        { url: "https://b.test" },
        "garbage",
        null,
        { label: "Blank", url: "   " },
      ],
    });
    expect(readRoadmapData(node)?.links).toEqual([
      { label: "Good", url: "https://a.test" },
      { label: "https://b.test", url: "https://b.test" },
    ]);
  });
});

describe("writeRoadmapData", () => {
  const payload = { title: "CSS", status: "done" as RoadmapStatus, articlePath: "CSS.md", links: [] };

  it("preserves unrelated node fields", () => {
    const node = makeNode({ id: "abc", x: 10, y: 20, width: 320, height: 110, color: "4" });
    writeRoadmapData(node, payload);
    const data = node.getData!();
    expect(data).toMatchObject({ id: "abc", x: 10, y: 20, width: 320, height: 110, color: "4" });
  });

  it("tags the node so readRoadmapData recognises it", () => {
    const node = makeNode({});
    writeRoadmapData(node, payload);
    expect(node.getData!().customNodeType).toBe(ROADMAP_NODE_TYPE);
    expect(readRoadmapData(node)).toEqual(payload);
  });

  it("keeps the node a text node with empty text, so vanilla Obsidian copes", () => {
    const node = makeNode({ type: "text", text: "old body" });
    writeRoadmapData(node, payload);
    expect(node.getData!()).toMatchObject({ type: "text", text: "" });
  });

  it("round-trips: write then read gives back the same data", () => {
    const node = makeNode({});
    const full = {
      title: "JavaScript",
      status: "learning" as RoadmapStatus,
      articlePath: "js.md",
      links: [{ label: "Docs", url: "https://x.test" }],
    };
    writeRoadmapData(node, full);
    expect(readRoadmapData(node)).toEqual(full);
  });

  it("saveRoadmapData asks the canvas to persist", () => {
    const node = makeNode({});
    saveRoadmapData(node, payload);
    expect(node.canvas!.requestSave).toHaveBeenCalledOnce();
  });
});

describe("cycleStatus", () => {
  it("walks none → learning → done → skip → none", () => {
    expect(cycleStatus("none")).toBe("learning");
    expect(cycleStatus("learning")).toBe("done");
    expect(cycleStatus("done")).toBe("skip");
    expect(cycleStatus("skip")).toBe("none");
  });

  it("returns to the start after a full lap", () => {
    let status: RoadmapStatus = "none";
    for (let i = 0; i < STATUS_ORDER.length; i++) status = cycleStatus(status);
    expect(status).toBe("none");
  });
});

describe("resolveArticle", () => {
  const file = new TFile("10-Notes/Internet.md");
  const app = (found: unknown) =>
    ({ vault: { getAbstractFileByPath: vi.fn().mockReturnValue(found) } }) as never;

  it("returns the file for a linked note that exists", () => {
    const found = resolveArticle(app(file), {
      title: "Internet",
      status: "learning",
      articlePath: "10-Notes/Internet.md",
      links: [],
    });
    expect(found).toBe(file);
  });

  it("returns undefined when the path points at a folder", () => {
    const folder = new TFolder("10-Notes");
    expect(
      resolveArticle(app(folder), { title: "", status: "none", articlePath: "10-Notes", links: [] })
    ).toBeUndefined();
  });

  it("returns undefined when nothing is linked", () => {
    expect(resolveArticle(app(file), { title: "", status: "none", articlePath: "", links: [] })).toBeUndefined();
  });

  it("returns undefined for a whitespace-only path", () => {
    expect(resolveArticle(app(file), { title: "", status: "none", articlePath: "   ", links: [] })).toBeUndefined();
  });

  it("returns undefined when the note is gone", () => {
    expect(
      resolveArticle(app(null), { title: "", status: "none", articlePath: "missing.md", links: [] })
    ).toBeUndefined();
  });

  it("returns undefined when the data itself is missing", () => {
    expect(resolveArticle(app(file), undefined)).toBeUndefined();
  });
});

describe("displayTitle", () => {
  it("uses the title when there is one", () => {
    expect(displayTitle({ title: "Internet", status: "none", articlePath: "", links: [] })).toBe("Internet");
  });

  it("falls back for a blank title", () => {
    expect(displayTitle({ title: "   ", status: "none", articlePath: "", links: [] })).toBe(UNTITLED);
  });
});

describe("STATUS_META", () => {
  it("covers every status with no gaps", () => {
    for (const status of STATUS_ORDER) {
      const meta = STATUS_META[status];
      expect(meta.label).toBeTruthy();
      expect(meta.icon).toBeTruthy();
      expect(meta.cls).toMatch(/^is-/);
    }
  });

  it("gives each status its own css class", () => {
    const classes = STATUS_ORDER.map((s) => STATUS_META[s].cls);
    expect(new Set(classes).size).toBe(classes.length);
  });
});

describe("basename", () => {
  it("strips the folder and the .md extension", () => {
    expect(basename("10-Notes/HTTP basics.md")).toBe("HTTP basics");
  });

  it("handles a bare filename", () => {
    expect(basename("Internet.md")).toBe("Internet");
  });

  it("leaves a non-markdown name alone", () => {
    expect(basename("a/b/diagram.canvas")).toBe("diagram.canvas");
  });
});
