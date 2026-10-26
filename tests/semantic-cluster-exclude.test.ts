import { describe, expect, it } from "vitest";
import {
  buildExcluder,
  hasFolderNamed,
  isEmptyNote,
  isUnderFolder,
  rootFolders,
} from "../src/modules/semantic-cluster/exclude";

const base = {
  semanticSearchExcludeFilter: "",
  semanticClusterExclude: "",
  noteToCanvasFolder: "",
  quizFolderName: "DB Quiz",
  semanticSearchModelPath: ".models",
};

describe("isUnderFolder", () => {
  it("matches the folder itself and anything beneath it", () => {
    expect(isUnderFolder(".models", ".models")).toBe(true);
    expect(isUnderFolder(".models/e5/model.onnx", ".models")).toBe(true);
  });

  it("does not match a folder that merely starts with the same letters", () => {
    expect(isUnderFolder(".obsidianish/a.md", ".obsidian")).toBe(false);
  });

  it("ignores slashes around the folder name", () => {
    expect(isUnderFolder("Generated/a.canvas", "/Generated/")).toBe(true);
  });

  it("never matches an empty folder", () => {
    expect(isUnderFolder("a.md", "")).toBe(false);
    expect(isUnderFolder("a.md", "  ")).toBe(false);
  });
});

describe("hasFolderNamed", () => {
  it("finds the folder at any depth", () => {
    expect(hasFolderNamed("DB Quiz/q1.md", "DB Quiz")).toBe(true);
    expect(hasFolderNamed("20-Work/Learn/DB Quiz/q1.md", "DB Quiz")).toBe(true);
  });

  it("does not match a longer folder name or a note title", () => {
    expect(hasFolderNamed("My DB Quiz notes/a.md", "DB Quiz")).toBe(false);
    expect(hasFolderNamed("Notes/DB Quiz.md", "DB Quiz")).toBe(false);
  });

  it("matches nothing for an empty name", () => {
    expect(hasFolderNamed("a/b.md", "")).toBe(false);
  });
});

describe("rootFolders", () => {
  it("always includes the internal and plugin folders", () => {
    const folders = rootFolders(base);
    expect(folders).toEqual(expect.arrayContaining([".obsidian", ".trash", ".rico-plugin", ".models"]));
  });

  it("adds the generated canvas folder only when one is set", () => {
    expect(rootFolders(base)).not.toContain("");
    expect(rootFolders({ ...base, noteToCanvasFolder: "/Generated/Canvases/" })).toContain(
      "Generated/Canvases",
    );
  });
});

describe("buildExcluder", () => {
  it("keeps an ordinary note", () => {
    expect(buildExcluder(base)("Notes/meeting.md")).toBe(false);
  });

  it("leaves out the plugin's own data, model and internal folders", () => {
    const skip = buildExcluder(base);
    expect(skip(".rico-plugin/semantic-index.json")).toBe(true);
    expect(skip(".models/multilingual-e5-small/config.json")).toBe(true);
    expect(skip(".obsidian/plugins/x/data.json")).toBe(true);
    expect(skip(".trash/old.md")).toBe(true);
  });

  it("leaves out quiz folders wherever they sit, but not a note named like one", () => {
    const skip = buildExcluder(base);
    expect(skip("20-Work/DB Quiz/hvac.md")).toBe(true);
    expect(skip("Quiz ideas.md")).toBe(false);
    expect(skip("DB Quiz notes/a.md")).toBe(false);
  });

  it("follows a renamed quiz folder", () => {
    const skip = buildExcluder({ ...base, quizFolderName: "Questions" });
    expect(skip("Questions/a.md")).toBe(true);
    expect(skip("DB Quiz/a.md")).toBe(false);
  });

  it("leaves out generated canvases only once a folder is set", () => {
    expect(buildExcluder(base)("Generated/a.canvas")).toBe(false);
    expect(buildExcluder({ ...base, noteToCanvasFolder: "Generated" })("Generated/a.canvas")).toBe(true);
  });

  it("honours the semantic search exclude filter", () => {
    const skip = buildExcluder({ ...base, semanticSearchExcludeFilter: "Archive/, Daily" });
    expect(skip("Archive/old.md")).toBe(true);
    expect(skip("Journal/Daily/2025.md")).toBe(true);
    expect(skip("Notes/a.md")).toBe(false);
  });

  it("adds the cluster's own extra filter on top", () => {
    const skip = buildExcluder({
      ...base,
      semanticSearchExcludeFilter: "Archive/",
      semanticClusterExclude: "Templates/",
    });
    expect(skip("Archive/a.md")).toBe(true);
    expect(skip("Templates/t.md")).toBe(true);
    expect(skip("Notes/a.md")).toBe(false);
  });

  it("does not leave out everything when the quiz folder name is blank", () => {
    expect(buildExcluder({ ...base, quizFolderName: "" })("Notes/a.md")).toBe(false);
  });
});

describe("isEmptyNote", () => {
  it("is empty when only the title is there", () => {
    expect(isEmptyNote("Draft idea")).toBe(true);
    expect(isEmptyNote("Draft idea\n\n")).toBe(true);
  });

  it("ignores frontmatter", () => {
    expect(isEmptyNote("Draft\n\n---\ntags: [a]\ncreated: 2024-01-01\n---\n")).toBe(true);
  });

  it("is not empty once there is a real body", () => {
    expect(isEmptyNote("Draft\n\nSome actual paragraph of writing here.")).toBe(false);
  });

  it("does not judge a note when the index kept no text", () => {
    expect(isEmptyNote(undefined)).toBe(false);
    expect(isEmptyNote("")).toBe(false);
  });
});
