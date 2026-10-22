import { Notice, WorkspaceLeaf, type Plugin } from "obsidian";
import { Embedder } from "../semantic-search/embedder";
import { getModel } from "../semantic-search/model-registry";
import { VectorStore } from "../semantic-search/store";
import { SEMANTIC_GRAPH_VIEW_TYPE, SemanticGraphView } from "./view";
import type { RicoPluginSettings } from "../../types";

interface PluginWithSettings extends Plugin {
  settings: RicoPluginSettings;
  savePluginSettings: () => Promise<void>;
}

/** Show the graph in the right sidebar, reusing the tab if it is already open. */
async function openView(plugin: Plugin): Promise<void> {
  const { workspace } = plugin.app;

  // Open the sidebar before touching the leaf: Obsidian only mounts a view
  // once its leaf is on screen, so a leaf set up while the dock is collapsed
  // ends up with no content element at all.
  if (workspace.rightSplit?.collapsed) workspace.rightSplit.expand();

  // Drop a leaf that was restored without ever being mounted, and one still
  // sitting in the left sidebar from when the graph lived there. Its view has
  // no container to draw into or is in the wrong place; a fresh leaf fixes both.
  for (const stale of workspace.getLeavesOfType(SEMANTIC_GRAPH_VIEW_TYPE)) {
    const el = (stale.view as { containerEl?: HTMLElement } | undefined)?.containerEl;
    const inRightSidebar = stale.getRoot() === workspace.rightSplit;
    if (!el?.isConnected || !inRightSidebar) stale.detach();
  }

  let leaf: WorkspaceLeaf | null =
    workspace.getLeavesOfType(SEMANTIC_GRAPH_VIEW_TYPE)[0] ?? null;
  if (!leaf) {
    leaf = workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice("Semantic graph: Obsidian gave no room in the right sidebar.", 6000);
      return;
    }
    try {
      await leaf.setViewState({ type: SEMANTIC_GRAPH_VIEW_TYPE, active: true });
    } catch (err) {
      // Obsidian's own open pipeline failed (another plugin patching it can do
      // this). Say so instead of leaving a leaf that quietly never mounts.
      console.error(">>> semantic-graph: setViewState failed", err);
      new Notice("Semantic graph: Obsidian could not open the panel. See the console.", 8000);
      leaf.detach();
      return;
    }
  }

  // A leaf restored into a collapsed sidebar is never shown, and Obsidian only
  // calls onOpen once a view is actually on screen. Expanding the sidebar first,
  // then making this the active tab, is what gets the view built.
  const right = workspace.rightSplit;
  if (right?.collapsed) right.expand();

  await workspace.revealLeaf(leaf);

  // Do not wait for Obsidian to call onOpen: it has been seen not to, which
  // leaves a mounted view with nothing in it. Asking directly is harmless when
  // the panel is already built.
  await buildAll(plugin);

  // The view can exist without ever having been attached to its leaf. Building
  // into that draws nothing anyone can see, so this is worth saying out loud.
  const view = leaf.view;
  if (view instanceof SemanticGraphView && !view.containerEl.isConnected) {
    const attached = view.attachToLeaf();
    if (attached) {
      await view.ensureBuilt();
      new Notice("Semantic graph: Obsidian did not attach the panel, so it was attached by hand.", 6000);
      return;
    }
    console.error(">>> semantic-graph: view was created but never attached to its leaf", {
      onOpenCalls: view.debug.onOpenCalls,
      inRightSidebar: leaf.getRoot() === workspace.rightSplit,
    });
    new Notice("Semantic graph: the panel was created but Obsidian did not attach it. See the console.", 8000);
  }
}

/** True when a view's DOM is actually in the document, not just created. */
function isMounted(leaf: WorkspaceLeaf): boolean {
  return leaf.view instanceof SemanticGraphView && leaf.view.containerEl.isConnected;
}

/** Where a leaf lives, for the diagnose report. */
function whereIs(plugin: Plugin, leaf: WorkspaceLeaf | undefined): string {
  if (!leaf) return "(none)";
  const { workspace } = plugin.app;
  const root = leaf.getRoot();
  if (root === workspace.leftSplit) return "left sidebar";
  if (root === workspace.rightSplit) return "right sidebar";
  if (root === workspace.rootSplit) return "main area";
  return "somewhere else (floating or detached)";
}

/**
 * Make sure every mounted graph view has its panel.
 *
 * A leaf restored from a saved workspace may be deferred, with a placeholder
 * view standing in until it is shown; loading it swaps in the real one.
 */
async function buildAll(plugin: Plugin): Promise<void> {
  for (const leaf of plugin.app.workspace.getLeavesOfType(SEMANTIC_GRAPH_VIEW_TYPE)) {
    try {
      await (leaf as { loadIfDeferred?: () => Promise<void> }).loadIfDeferred?.();
      // Skip a view that was never attached: building into it only runs a
      // ranking and shows a notice for a panel nobody can see.
      if (isMounted(leaf) && leaf.view instanceof SemanticGraphView) await leaf.view.ensureBuilt();
    } catch (err) {
      console.error(">>> semantic-graph: could not build view", err);
    }
  }
}

/**
 * Semantic graph: the nearest connections of the active note, as a node graph.
 *
 * Reads the same index the semantic search panel builds — it never embeds a
 * vault of its own — but keeps its own scoring weights, so tuning the graph
 * does not change the search results and vice versa. Obsidian cannot
 * un-register a view at runtime, so the enable toggle applies after a reload.
 */
export function registerSemanticGraph(plugin: PluginWithSettings): void {
  const settings = () => plugin.settings;

  // Its own store and embedder instance, pointed at the same files on disk.
  // Sharing the search module's objects would mean the graph silently breaking
  // whenever semantic search is disabled, which is a surprising coupling.
  const store = new VectorStore(plugin);
  const embedder = new Embedder(
    plugin,
    () => settings().semanticSearchModelKey,
    () => settings().semanticSearchModelPath,
  );

  let loadedKey = "";
  /**
   * The load in flight, so the view can wait for it.
   *
   * Reading an 8MB index is not instant, and a view opened during that window
   * would otherwise search an empty store and report "nothing indexed".
   */
  let loading: Promise<void> = Promise.resolve();

  const loadIndexForCurrentModel = (): Promise<void> => {
    const current = getModel(settings().semanticSearchModelKey);
    if (current.key === loadedKey) return loading;
    loadedKey = current.key;
    loading = store.load(current.key, current.dims).then(() => {
      console.log(">>> semantic-graph: index loaded", {
        model: current.key,
        vectors: store.size,
      });
    });
    return loading;
  };

  // Start immediately rather than waiting for layout: the index is needed as
  // soon as the view opens, which may be before any layout event fires.
  void loadIndexForCurrentModel();
  plugin.registerEvent(
    plugin.app.workspace.on("layout-change", () => void loadIndexForCurrentModel()),
  );

  plugin.registerView(
    SEMANTIC_GRAPH_VIEW_TYPE,
    (leaf) =>
      new SemanticGraphView(leaf, {
        store,
        embedder,
        settings,
        save: () => plugin.savePluginSettings(),
        ready: () => loadIndexForCurrentModel(),
      }),
  );

  // Lets hovering a node preview the note, behind Obsidian's usual modifier key.
  plugin.registerHoverLinkSource(SEMANTIC_GRAPH_VIEW_TYPE, {
    display: "Semantic graph",
    defaultMod: true,
  });

  // A view restored at startup, or moved between sidebars, is not always given
  // an onOpen. These cover it from the outside.
  // Graph leaves saved in the workspace are restored without being mounted: the
  // view is created but its panel never opens. The graph keeps no state worth
  // restoring, so drop them; the ribbon icon makes a fresh one that does mount.
  plugin.app.workspace.onLayoutReady(() => {
    for (const leaf of plugin.app.workspace.getLeavesOfType(SEMANTIC_GRAPH_VIEW_TYPE)) {
      if (!isMounted(leaf)) leaf.detach();
    }
  });
  plugin.registerEvent(plugin.app.workspace.on("layout-change", () => void buildAll(plugin)));

  plugin.addRibbonIcon("git-fork", "Open semantic graph", () => void openView(plugin));

  plugin.addCommand({
    id: "open-semantic-graph",
    name: "Open semantic graph (right sidebar)",
    callback: () => void openView(plugin),
  });

  // Reachable even when the panel drew nothing, which is exactly when the raw
  // rows are worth looking at.
  plugin.addCommand({
    id: "semantic-graph-toggle-list",
    name: "Semantic graph: show the raw ranked list",
    callback: () => {
      void (async () => {
        await openView(plugin);
        const leaf = plugin.app.workspace.getLeavesOfType(SEMANTIC_GRAPH_VIEW_TYPE)[0];
        const view = leaf?.view;
        if (view instanceof SemanticGraphView) view.toggleList();
        else new Notice("Semantic graph: the panel is not open.", 5000);
      })();
    },
  });

  // Dump the same numbers to the console, for when the panel itself is blank.
  plugin.addCommand({
    id: "semantic-graph-diagnose",
    name: "Semantic graph: diagnose",
    callback: async () => {
      const leaves = plugin.app.workspace.getLeavesOfType(SEMANTIC_GRAPH_VIEW_TYPE);
      const viewBefore = leaves[0]?.view;
      // Capture the state as Obsidian left it, before anything here repairs it.
      const before = {
        panelBuilt: String((viewBefore as { contentEl?: HTMLElement } | undefined)?.contentEl?.hasClass("rico-sg")),
        contentElConnected: String((viewBefore as { contentEl?: HTMLElement } | undefined)?.contentEl?.isConnected),
        deferred: String((leaves[0] as { isDeferred?: boolean } | undefined)?.isDeferred),
        onOpenCalls: String(viewBefore instanceof SemanticGraphView ? viewBefore.debug.onOpenCalls : "n/a"),
        buildCalls: String(viewBefore instanceof SemanticGraphView ? viewBefore.debug.buildCalls : "n/a"),
      };
      await buildAll(plugin);
      // A deferred leaf is replaced by a real view while loading, so look again.
      const view = leaves[0]?.view;
      const report: Record<string, string> = {
        ...Object.fromEntries(Object.entries(before).map(([k, v]) => [`before.${k}`, v])),
        lastError: view instanceof SemanticGraphView ? view.debug.lastError || "(none)" : "n/a",
        leaves: String(leaves.length),
        viewClass: view?.constructor?.name ?? "(none)",
        isOurView: String(view instanceof SemanticGraphView),
        indexedVectors: String(store.size),
        activeFile: plugin.app.workspace.getActiveFile()?.path ?? "(none)",
      };
      const el = (view as { contentEl?: HTMLElement } | undefined)?.contentEl;
      report.contentElClasses = el?.className ?? "(none)";
      report.contentElChildren = String(el?.childElementCount ?? 0);
      report.contentElSize = el
        ? `${Math.round(el.getBoundingClientRect().width)} x ${Math.round(el.getBoundingClientRect().height)}`
        : "(none)";
      // The stage is what the graph is drawn into; a zero height here means the
      // SVG has nowhere to appear even though everything else worked.
      const stage = el?.querySelector(".rico-sg-stage") as HTMLElement | null;
      report.stageFound = stage ? "yes" : "NO";
      report.stageSize = stage
        ? `${Math.round(stage.getBoundingClientRect().width)} x ${Math.round(stage.getBoundingClientRect().height)}`
        : "(none)";
      const svg = el?.querySelector(".rico-sg-svg") as SVGSVGElement | null;
      report.svgFound = svg ? "yes" : "NO";
      report.svgNodes = String(el?.querySelectorAll(".rico-sg-node").length ?? 0);
      report.headerFound = el?.querySelector(".rico-sg-header") ? "yes" : "NO";
      // Where the leaf sits, and whether the sidebar holding it is open. A
      // 0x0 container with a collapsed sidebar is a very different problem
      // from a 0x0 container in a sidebar that is open.
      const ws = plugin.app.workspace;
      report.rightSidebarCollapsed = String(ws.rightSplit?.collapsed);
      report.leafLivesIn = whereIs(plugin, leaves[0]);
      report.viewMounted = leaves[0] ? String(isMounted(leaves[0])) : "(none)";
      report.leafIsActive = String(leaves[0] === ws.getMostRecentLeaf());
      const container = leaves[0]?.getContainer?.();
      report.leafContainer = container ? "found" : "(none)";
      const parentEl = (leaves[0] as unknown as { containerEl?: HTMLElement })?.containerEl;
      report.leafElSize = parentEl
        ? `${Math.round(parentEl.getBoundingClientRect().width)} x ${Math.round(parentEl.getBoundingClientRect().height)}`
        : "(none)";
      report.leafElDisplay = parentEl ? getComputedStyle(parentEl).display : "(none)";
      report.statusText = (el?.querySelector(".rico-sg-status") as HTMLElement | null)?.textContent ?? "(none)";
      // console.log collapses objects and hides the fields that matter, so
      // print the lines individually and copy the text onto the clipboard.
      const lines = Object.entries(report).map(([k, v]) => `${k}: ${String(v)}`);
      console.log(">>> semantic-graph diagnose >>>\n" + lines.join("\n"));

      console.log(">>> contentEl outerHTML (first 2000 chars):");
      console.log(el ? el.outerHTML.slice(0, 2000) : "(no contentEl)");

      void navigator.clipboard?.writeText(lines.join("\n")).catch(() => undefined);
      new Notice(lines.join("\n") + "\n\n(copied to clipboard)", 15000);
    },
  });

  plugin.register(() => embedder.unload());
}
