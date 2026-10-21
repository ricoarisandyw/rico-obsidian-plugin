import { beforeEach, describe, expect, it, vi } from "vitest";

import { Component, TFile } from "./mocks/obsidian";
import { decorateDiagram } from "../src/modules/mermaid-links/decorate";
import { stripWikilinks } from "../src/modules/mermaid-links/wikilink";

/** A stand-in for the SVG mermaid produces for two labelled nodes. */
const SVG = `
<svg xmlns="http://www.w3.org/2000/svg">
  <g class="node" id="n1"><rect/><text class="nodeLabel">Admin Role</text></g>
  <g class="node" id="n2"><rect/><text class="nodeLabel">User Role</text></g>
  <g class="node" id="n3"><rect/><text class="nodeLabel">Plain</text></g>
</svg>`;

function makeApp(existing: string[]) {
  const byName = new Map(existing.map((n) => [n, new TFile(`${n}.md`)]));
  return {
    workspace: { openLinkText: vi.fn(), trigger: vi.fn() },
    metadataCache: { getFirstLinkpathDest: (n: string) => byName.get(n) ?? null },
  } as any;
}

describe("decorateDiagram", () => {
  let containerEl: HTMLElement;
  let component: Component;
  let app: ReturnType<typeof makeApp>;

  const byDisplay = stripWikilinks(
    "sequenceDiagram\n participant A as [[Admin Role]]\n participant U as [[User Role]]"
  ).byDisplay;

  beforeEach(() => {
    containerEl = document.createElement("div");
    containerEl.innerHTML = SVG;
    document.body.appendChild(containerEl);
    component = new Component();
    app = makeApp(["Admin Role", "User Role"]);
  });

  const run = () =>
    decorateDiagram(app, component as any, containerEl, byDisplay, "Current.md");

  it("binds each label that came from a wikilink", () => {
    expect(run()).toBe(2);
  });

  it("leaves a label that was never a wikilink alone", () => {
    run();
    const plain = containerEl.querySelector("#n3")!;
    expect(plain.classList.contains("internal-link")).toBe(false);
  });

  it("binds the node group, not just the text, so the whole shape is clickable", () => {
    run();
    const node = containerEl.querySelector("#n1")!;
    expect(node.classList.contains("internal-link")).toBe(true);
  });

  it("marks the element the way obsidian marks its own links", () => {
    run();
    const node = containerEl.querySelector("#n1")!;
    expect(node.getAttribute("data-href")).toBe("Admin Role");
  });

  it("opens the note on click", () => {
    run();
    containerEl
      .querySelector("#n1")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(app.workspace.openLinkText).toHaveBeenCalledWith("Admin Role", "Current.md", false);
  });

  it("opens in a new tab on ctrl-click", () => {
    run();
    containerEl
      .querySelector("#n1")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
    expect(app.workspace.openLinkText).toHaveBeenCalledWith("Admin Role", "Current.md", true);
  });

  it("triggers hover-link so the page preview can open", () => {
    run();
    containerEl
      .querySelector("#n1")!
      .dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    const call = app.workspace.trigger.mock.calls.find((c: any[]) => c[0] === "hover-link");
    expect(call?.[1]).toMatchObject({ linktext: "Admin Role", sourcePath: "Current.md" });
  });

  it("marks a link to a note that does not exist yet", () => {
    app = makeApp([]); // empty vault
    run();
    expect(containerEl.querySelector("#n1")!.classList.contains("is-unresolved")).toBe(true);
  });

  it("does nothing when the diagram had no wikilinks", () => {
    expect(decorateDiagram(app, component as any, containerEl, new Map(), "Current.md")).toBe(0);
  });

  it("uses the alias shown in the svg to find the link", () => {
    const aliased = stripWikilinks("participant A as [[Admin Role|Admin]]").byDisplay;
    containerEl.innerHTML = '<svg><g class="node" id="a"><text>Admin</text></g></svg>';
    expect(decorateDiagram(app, component as any, containerEl, aliased, "Current.md")).toBe(1);
    expect(containerEl.querySelector("#a")!.getAttribute("data-href")).toBe("Admin Role");
  });

  it("binds a node only once when text and tspan both match", () => {
    containerEl.innerHTML =
      '<svg><g class="node" id="a"><text class="nodeLabel"><tspan>Admin Role</tspan></text></g></svg>';
    expect(run()).toBe(1);
  });
});
