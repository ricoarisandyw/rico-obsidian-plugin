import { Notice, WorkspaceLeaf, type Plugin } from "obsidian";
import { getModel } from "../semantic-search/model-registry";
import { VectorStore } from "../semantic-search/store";
import {
  SEMANTIC_CLUSTER_VIEW_TYPE,
  SemanticClusterView,
  type ClusterCache,
} from "./view";
import type { RicoPluginSettings } from "../../types";

interface PluginWithSettings extends Plugin {
  settings: RicoPluginSettings;
  savePluginSettings: () => Promise<void>;
}

/** True when a view's DOM is actually in the document, not just created. */
function isMounted(leaf: WorkspaceLeaf): boolean {
  return leaf.view instanceof SemanticClusterView && leaf.view.containerEl.isConnected;
}

/**
 * Open the cluster map in a tab of the main area, reusing it if it is open.
 *
 * Every step here exists because of how the graph panel misbehaved: a leaf
 * restored from a saved workspace can hold a view that was created but never
 * attached, and Obsidian's own open can fail quietly. Each is checked and said
 * out loud rather than left to produce a blank tab.
 */
async function openView(plugin: Plugin): Promise<SemanticClusterView | null> {
  const { workspace } = plugin.app;

  for (const stale of workspace.getLeavesOfType(SEMANTIC_CLUSTER_VIEW_TYPE)) {
    if (!isMounted(stale)) stale.detach();
  }

  let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(SEMANTIC_CLUSTER_VIEW_TYPE)[0] ?? null;
  if (!leaf) {
    leaf = workspace.getLeaf("tab");
    try {
      await leaf.setViewState({ type: SEMANTIC_CLUSTER_VIEW_TYPE, active: true });
    } catch (err) {
      console.error(">>> semantic-cluster: setViewState failed", err);
      new Notice("Semantic cluster: Obsidian could not open the tab. See the console.", 8000);
      leaf.detach();
      return null;
    }
  }

  await workspace.revealLeaf(leaf);

  const view = leaf.view;
  if (!(view instanceof SemanticClusterView)) return null;
  if (!view.containerEl.isConnected && !view.attachToLeaf()) {
    console.error(">>> semantic-cluster: view was created but never attached to its leaf", {
      onOpenCalls: view.debug.onOpenCalls,
    });
    new Notice("Semantic cluster: the tab was created but Obsidian did not attach it. See the console.", 8000);
    return null;
  }
  await view.ensureBuilt();
  return view;
}

/**
 * Semantic cluster: every note in the vault, grouped by topic.
 *
 * Reads the vector index the semantic search module builds — it never embeds
 * anything itself. Obsidian cannot un-register a view at runtime, so the
 * enable toggle applies after a reload.
 */
export function registerSemanticCluster(plugin: PluginWithSettings): void {
  const settings = () => plugin.settings;

  // Its own store, pointed at the same file on disk, so the map keeps working
  // when semantic search or the graph are switched off.
  const store = new VectorStore(plugin);
  let loadedKey = "";
  let loading: Promise<void> = Promise.resolve();

  const loadIndexForCurrentModel = (): Promise<void> => {
    const current = getModel(settings().semanticSearchModelKey);
    if (current.key === loadedKey) return loading;
    loadedKey = current.key;
    loading = store.load(current.key, current.dims);
    return loading;
  };

  // Loaded when the map is first opened, not at startup: this is a whole-vault
  // read and most sessions never open the map.
  const cache: ClusterCache = { signature: "", maps: new Map(), excluded: 0, total: 0 };

  plugin.registerView(
    SEMANTIC_CLUSTER_VIEW_TYPE,
    (leaf) =>
      new SemanticClusterView(leaf, {
        store,
        settings,
        ready: (fresh) => {
          // Another module may have re-indexed since this store was read.
          if (fresh) loadedKey = "";
          return loadIndexForCurrentModel();
        },
        save: () => plugin.savePluginSettings(),
        cache,
      }),
  );

  plugin.addRibbonIcon("network", "Open semantic cluster", () => void openView(plugin));

  plugin.addCommand({
    id: "open-semantic-cluster",
    name: "Semantic cluster: open",
    callback: () => void openView(plugin),
  });

  plugin.addCommand({
    id: "semantic-cluster-recompute",
    name: "Semantic cluster: recompute",
    callback: () => {
      void (async () => {
        const view = await openView(plugin);
        if (view) await view.run(true);
      })();
    },
  });

  // Tabs saved in the workspace are restored without being mounted. The map
  // keeps no state worth restoring, so drop them; the ribbon icon makes a fresh one.
  plugin.app.workspace.onLayoutReady(() => {
    for (const leaf of plugin.app.workspace.getLeavesOfType(SEMANTIC_CLUSTER_VIEW_TYPE)) {
      if (!isMounted(leaf)) leaf.detach();
    }
  });

  plugin.addCommand({
    id: "semantic-cluster-diagnose",
    name: "Semantic cluster: diagnose",
    callback: () => {
      const leaves = plugin.app.workspace.getLeavesOfType(SEMANTIC_CLUSTER_VIEW_TYPE);
      const view = leaves[0]?.view;
      const ours = view instanceof SemanticClusterView ? view : null;
      const el = ours?.contentEl;
      const stage = el?.querySelector(".rico-sc-stage") as HTMLElement | null;
      const size = (node: HTMLElement | null | undefined) =>
        node ? `${Math.round(node.getBoundingClientRect().width)} x ${Math.round(node.getBoundingClientRect().height)}` : "(none)";
      const report: Record<string, string> = {
        leaves: String(leaves.length),
        isOurView: String(!!ours),
        mounted: leaves[0] ? String(isMounted(leaves[0])) : "(none)",
        onOpenCalls: String(ours?.debug.onOpenCalls ?? "n/a"),
        buildCalls: String(ours?.debug.buildCalls ?? "n/a"),
        lastError: ours?.debug.lastError || "(none)",
        indexedVectors: String(store.size),
        cachedLevels: String(cache.maps.size),
        excluded: String(cache.excluded),
        contentElSize: size(el),
        stageSize: size(stage),
        dots: String(el?.querySelectorAll(".rico-sc-dot").length ?? 0),
        blobs: String(el?.querySelectorAll(".rico-sc-blob").length ?? 0),
      };
      const lines = Object.entries(report).map(([k, v]) => `${k}: ${v}`);
      console.log(">>> semantic-cluster diagnose >>>\n" + lines.join("\n"));
      void navigator.clipboard?.writeText(lines.join("\n")).catch(() => undefined);
      new Notice(lines.join("\n") + "\n\n(copied to clipboard)", 15000);
    },
  });
}
