/**
 * Turning the text inside a rendered mermaid SVG back into Obsidian links.
 *
 * Mermaid never sees a wikilink: the source was stripped to plain text before
 * it rendered. So the SVG contains the display text and nothing else, and the
 * job here is to find the elements holding that text and make them behave like
 * links.
 *
 * Everything that reads or writes the DOM lives here, and it uses plain DOM
 * APIs throughout: these nodes are inside an <svg>, so they are SVGElement and
 * do not carry Obsidian's HTMLElement-only helpers like `addClass`.
 */

import { App, Component, Menu } from "obsidian";

import type { Wikilink } from "./wikilink";

/** Elements inside a mermaid SVG that can hold a node's visible label. */
const LABEL_SELECTOR = "text, .nodeLabel, .edgeLabel, .messageText, .actor, tspan";

/**
 * The element to make clickable for a label: prefer the whole node group, so
 * the entire shape is a click target rather than just the glyphs.
 */
function clickTarget(el: Element): Element {
  const group = el.closest(".node, .actor, g.root, .label-container");
  return group ?? el;
}

/** Visible text of an element, normalised the way the SVG renders it. */
function textOf(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Give `el` Obsidian's link behaviour for `link`.
 *
 * Exported so the behaviour can be tested directly, and reused if other
 * diagram types need it later.
 */
export function bindLink(
  app: App,
  component: Component,
  containerEl: HTMLElement,
  el: Element,
  link: Wikilink,
  sourcePath: string
): void {
  const resolved = app.metadataCache.getFirstLinkpathDest(link.path || sourcePath, sourcePath);

  el.classList.add("internal-link", "rico-mermaid-link");
  // Obsidian styles an unresolved link differently, and so do we.
  if (!resolved) el.classList.add("is-unresolved");
  el.setAttribute("data-href", link.linktext);
  el.setAttribute("aria-label", link.linktext);

  const open = (newLeaf: boolean) => {
    void app.workspace.openLinkText(link.linktext, sourcePath, newLeaf);
  };

  component.registerDomEvent(el as HTMLElement, "click", (evt: MouseEvent) => {
    evt.preventDefault();
    evt.stopPropagation();
    open(evt.ctrlKey || evt.metaKey);
  });

  // Middle click is the other "open in new tab" gesture, and auxclick is the
  // only event that reports it reliably.
  component.registerDomEvent(el as HTMLElement, "auxclick", (evt: MouseEvent) => {
    if (evt.button !== 1) return;
    evt.preventDefault();
    open(true);
  });

  component.registerDomEvent(el as HTMLElement, "mouseover", (evt: MouseEvent) => {
    app.workspace.trigger("hover-link", {
      event: evt,
      source: "rico-mermaid",
      hoverParent: containerEl,
      targetEl: el,
      linktext: link.linktext,
      sourcePath,
    });
  });

  component.registerDomEvent(el as HTMLElement, "contextmenu", (evt: MouseEvent) => {
    evt.preventDefault();
    evt.stopPropagation();
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("Open link")
        .setIcon("link")
        .onClick(() => open(false))
    );
    menu.addItem((item) =>
      item
        .setTitle("Open in new tab")
        .setIcon("file-plus")
        .onClick(() => open(true))
    );
    app.workspace.trigger("file-menu", menu, link.path, "rico-mermaid");
    menu.showAtMouseEvent(evt);
  });
}

/**
 * Find each label in the rendered SVG whose text was a wikilink, and bind it.
 *
 * Returns how many links were attached, which the caller uses to decide
 * whether the diagram still needs watching.
 */
export function decorateDiagram(
  app: App,
  component: Component,
  containerEl: HTMLElement,
  byDisplay: ReadonlyMap<string, Wikilink>,
  sourcePath: string
): number {
  if (byDisplay.size === 0) return 0;

  const bound = new Set<Element>();
  let count = 0;

  for (const el of Array.from(containerEl.querySelectorAll(LABEL_SELECTOR))) {
    const link = byDisplay.get(textOf(el));
    if (!link) continue;

    const target = clickTarget(el);
    // A <text> and its <tspan> both match; bind the group once.
    if (bound.has(target)) continue;
    bound.add(target);

    bindLink(app, component, containerEl, target, link, sourcePath);
    count++;
  }

  return count;
}
