import { describe, it, expect } from "vitest";
import {
  ScriptAction,
  buildCommand,
  matchesAction,
  parseActions,
  shellQuote,
  varsFor,
} from "../src/modules/script-actions/logic";

function action(over: Partial<ScriptAction> = {}): ScriptAction {
  return { title: "T", icon: "play", target: "any", extensions: [], paths: [], command: "echo", mode: "terminal", ...over };
}
const folder = (path: string) => ({ path, isFolder: true, extension: "" });
const file = (path: string) => ({ path, isFolder: false, extension: path.split(".").pop() ?? "" });

describe("parseActions", () => {
  it("loads a valid action with defaults", () => {
    const { actions, errors } = parseActions('{"actions":[{"title":"Hi","command":"echo hi"}]}');
    expect(errors).toEqual([]);
    expect(actions[0]).toMatchObject({ title: "Hi", target: "any", mode: "terminal", icon: "play", extensions: [], paths: [] });
  });

  it("reports invalid JSON instead of throwing", () => {
    const { actions, errors } = parseActions("{ nope");
    expect(actions).toEqual([]);
    expect(errors[0]).toMatch(/Not valid JSON/);
  });

  it("reports a missing actions list", () => {
    expect(parseActions("{}").errors[0]).toMatch(/actions/);
  });

  it("skips broken actions but keeps the good ones", () => {
    const { actions, errors } = parseActions(
      JSON.stringify({
        actions: [
          { title: "Good", command: "echo" },
          { title: "No command" },
          { command: "echo" },
          { title: "Bad target", command: "echo", target: "everything" },
          { title: "Bad mode", command: "echo", mode: "loud" },
        ],
      })
    );
    expect(actions.map((a) => a.title)).toEqual(["Good"]);
    expect(errors).toHaveLength(4);
  });

  it("cleans extensions and paths", () => {
    const { actions } = parseActions(
      JSON.stringify({ actions: [{ title: "x", command: "c", extensions: [".TS", "py"], paths: ["./40-Creation/", "20-Work"] }] })
    );
    expect(actions[0].extensions).toEqual(["ts", "py"]);
    expect(actions[0].paths).toEqual(["40-Creation", "20-Work"]);
  });
});

describe("matchesAction", () => {
  it("shows folder actions on folders only, and file actions on files only", () => {
    expect(matchesAction(action({ target: "folder" }), folder("A"))).toBe(true);
    expect(matchesAction(action({ target: "folder" }), file("A/b.md"))).toBe(false);
    expect(matchesAction(action({ target: "file" }), file("A/b.md"))).toBe(true);
    expect(matchesAction(action({ target: "file" }), folder("A"))).toBe(false);
    expect(matchesAction(action({ target: "any" }), folder("A"))).toBe(true);
  });

  it("filters by extension (files only, case-insensitive)", () => {
    const a = action({ extensions: ["ts"] });
    expect(matchesAction(a, file("x/run.TS"))).toBe(true);
    expect(matchesAction(a, file("x/run.py"))).toBe(false);
    expect(matchesAction(a, folder("x"))).toBe(false);
  });

  it("filters by path prefix without matching look-alike folders", () => {
    const a = action({ paths: ["40-Creation"] });
    expect(matchesAction(a, folder("40-Creation"))).toBe(true);
    expect(matchesAction(a, folder("40-Creation/Projects"))).toBe(true);
    expect(matchesAction(a, file("40-Creation/a.md"))).toBe(true);
    expect(matchesAction(a, folder("40-Creation-old"))).toBe(false);
    expect(matchesAction(a, folder("20-Work"))).toBe(false);
  });
});

describe("buildCommand", () => {
  const vars = (p: string, isFolder = false) => varsFor({ path: p, isFolder, extension: "md" }, p.split("/").pop()!, "/Users/me/My Vault");

  it("quotes values so spaces and symbols stay one word", () => {
    expect(buildCommand("echo {{path}}", vars("Notes/Tom & Jerry.md"))).toBe("echo 'Notes/Tom & Jerry.md'");
  });

  it("escapes single quotes", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(buildCommand("echo {{name}}", vars("A/it's.md"))).toBe(`echo 'it'\\''s.md'`);
  });

  it("fills every placeholder, with spaces allowed inside the braces", () => {
    const out = buildCommand("x {{ path }} {{name}} {{folder}} {{vault}} {{ext}}", vars("A/B/c.md"));
    expect(out).toBe("x 'A/B/c.md' 'c.md' 'A/B' '/Users/me/My Vault' 'md'");
  });

  it("uses the folder itself for folders, parent for files, '.' at the root", () => {
    expect(varsFor({ path: "A/B", isFolder: true, extension: "" }, "B", "/v").folder).toBe("A/B");
    expect(varsFor({ path: "A/b.md", isFolder: false, extension: "md" }, "b.md", "/v").folder).toBe("A");
    expect(varsFor({ path: "b.md", isFolder: false, extension: "md" }, "b.md", "/v").folder).toBe(".");
  });
});
