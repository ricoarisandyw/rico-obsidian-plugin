import {
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  Plugin,
  TFile,
  debounce,
} from "obsidian";

import { decorateDiagram } from "./decorate";
import { MermaidGraphIndex } from "./graph";
import { hasWikilink, stripWikilinks, type Wikilink } from "./wikilink";

type MermaidLinksPlugin = Plugin & {
  settings: { enableMermaidLinks: boolean; mermaidLinksGraph: boolean };
};

/** ```mermaid fences, so a note can be scanned without rendering it. */
const MERMAID_BLOCK = /^[ \t]*(`{3,}|~{3,})[ \t]*mermaid[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm;

/** Every mermaid block's source in a note. */
export function mermaidBlocks(markdown: string): string[] {
  MERMAID_BLOCK.lastIndex = 0;
  return Array.from(markdown.matchAll(MERMAID_BLOCK), (m) => m[2]);
}

/**
 * Every note a file's diagrams link to, for the graph index.
 *
 * `stripWikilinks` alone finds every link in any diagram type, which is what
 * the graph needs; the parser is what recovers *edges*, and is used elsewhere.
 * Deduped, since a note named twice is still one relation.
 */
export function diagramLinktexts(markdown: string): string[] {
  const seen = new Set<string>();
  for (const block of mermaidBlocks(markdown)) {
    if (!hasWikilink(block)) continue;
    for (const link of stripWikilinks(block).byDisplay.values()) seen.add(link.linktext);
  }
  return Array.from(seen);
}

/**
 * One rendered diagram. Mermaid renders asynchronously after the post
 * processor returns, so the SVG is usually not there yet: this watches the
 * container until it appears, then decorates it once.
 */
class MermaidDiagram extends MarkdownRenderChild {
  private observer: MutationObserver | null = null;
  private done = false;

  constructor(
    private plugin: MermaidLinksPlugin,
    containerEl: HTMLElement,
    private byDisplay: ReadonlyMap<string, Wikilink>,
    private sourcePath: string
  ) {
    super(containerEl);
  }

  onload(): void {
    if (this.tryDecorate()) return;

    // Mermaid replaces the container's contents when it finishes.
    this.observer = new MutationObserver(() => this.tryDecorate());
    this.observer.observe(this.containerEl, { childList: true, subtree: true });

    // Give up watching rather than observing a diagram that never renders.
    window.setTimeout(() => this.stopObserving(), 10_000);
  }

  onunload(): void {
    this.stopObserving();
  }

  private tryDecorate(): boolean {
    if (this.done) return true;
    if (!this.containerEl.querySelector("svg")) return false;

    const bound = decorateDiagram(
      this.plugin.app,
      this,
      this.containerEl,
      this.byDisplay,
      this.sourcePath
    );
    if (bound === 0) return false;

    this.done = true;
    this.stopObserving();
    return true;
  }

  private stopObserving(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}

/**
 * Make wikilinks inside mermaid diagrams behave like links everywhere else:
 * clickable in the note, and visible in Graph View and the backlink panel.
 *
 * Mermaid's own parsers reject `[[...]]` in a label, so the diagram is
 * rewritten to plain text before mermaid sees it and the links are attached to
 * the rendered SVG afterwards.
 */
export function registerMermaidLinks(plugin: MermaidLinksPlugin): void {
  const graph = new MermaidGraphIndex(plugin.app);

  // ---- clickable links ----
  plugin.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    if (!plugin.settings.enableMermaidLinks) return;

    const blocks = el.querySelectorAll<HTMLElement>(".mermaid, pre.language-mermaid");
    for (const block of Array.from(blocks)) {
      const source = block.getAttribute("data-rico-src") ?? block.textContent ?? "";
      if (!hasWikilink(source)) continue;

      const { source: clean, byDisplay } = stripWikilinks(source);
      // Mermaid has not rendered yet when the text is still in the element,
      // so replacing it now is what keeps its parser from seeing `[[`.
      if (block.textContent?.includes("[[")) block.textContent = clean;
      block.setAttribute("data-rico-src", source);

      ctx.addChild(new MermaidDiagram(plugin, block, byDisplay, ctx.sourcePath));
    }
  });

  // ---- graph view + backlinks ----
  const reindex = async (file: TFile): Promise<void> => {
    if (!plugin.settings.enableMermaidLinks || !plugin.settings.mermaidLinksGraph) return;
    if (file.extension !== "md") return;
    try {
      const markdown = await plugin.app.vault.cachedRead(file);
      graph.update(file.path, diagramLinktexts(markdown));
    } catch {
      // A file that cannot be read simply contributes nothing.
    }
  };

  const reindexAll = debounce(
    () => {
      if (!plugin.settings.enableMermaidLinks || !plugin.settings.mermaidLinksGraph) {
        graph.clearAll();
        return;
      }
      for (const file of plugin.app.vault.getMarkdownFiles()) void reindex(file);
    },
    500,
    true
  );

  plugin.registerEvent(
    plugin.app.metadataCache.on("changed", (file: TFile) => void reindex(file))
  );
  plugin.registerEvent(
    plugin.app.vault.on("delete", (file) => graph.clearFor(file.path))
  );
  plugin.registerEvent(
    plugin.app.vault.on("rename", (file, oldPath) => {
      graph.clearFor(oldPath);
      if (file instanceof TFile) void reindex(file);
    })
  );

  plugin.app.workspace.onLayoutReady(() => reindexAll());

  // Obsidian does not unregister index entries for us.
  plugin.register(() => graph.clearAll());
}
