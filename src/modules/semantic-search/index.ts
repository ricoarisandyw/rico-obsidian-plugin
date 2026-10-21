import { Notice, TFile, WorkspaceLeaf, type Plugin } from "obsidian";
import { Embedder, MissingModelError } from "./embedder";
import { MODELS, REQUIRED_MODEL_FILES, formatBytes, getModel } from "./model-registry";
import { ModelManager } from "./model-manager";
import { VectorStore } from "./store";
import { IndexSync } from "./sync";
import { SEMANTIC_SEARCH_VIEW_TYPE, SemanticSearchView } from "./view";
import type { RicoPluginSettings } from "../../types";

interface PluginWithSettings extends Plugin {
  settings: RicoPluginSettings;
  savePluginSettings: () => Promise<void>;
}

/** Show the panel in the right sidebar, reusing the tab if it is already open. */
async function openView(plugin: Plugin): Promise<void> {
  const { workspace } = plugin.app;
  let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(SEMANTIC_SEARCH_VIEW_TYPE)[0] ?? null;
  if (!leaf) {
    leaf = workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: SEMANTIC_SEARCH_VIEW_TYPE, active: true });
  }
  await workspace.revealLeaf(leaf);
}

/**
 * Semantic search: find related notes by meaning rather than keywords.
 *
 * Everything runs locally against a model you download into the vault, so no
 * note content leaves the machine. Obsidian cannot un-register a view at
 * runtime, so the enable toggle applies after a reload.
 */
export function registerSemanticSearch(plugin: PluginWithSettings): void {
  const settings = () => plugin.settings;
  const spec = getModel(settings().semanticSearchModelKey);

  console.log(">>> semantic-search: registering", {
    model: spec.key,
    modelPath: settings().semanticSearchModelPath,
  });

  // Ribbon and view go up before anything that touches disk or settings, so a
  // failure further down cannot leave the user with no way in.
  // "search-code" is a newer Lucide name and renders as an empty element on
  // Obsidian builds that ship an older icon set. "search" has been there since
  // the beginning, so it is the safe choice.
  const ribbonEl = plugin.addRibbonIcon("search", "Open semantic relation notes", () => void openView(plugin));
  console.log(">>> semantic-search: ribbon icon added", {
    hasSvg: !!ribbonEl?.querySelector("svg"),
    el: ribbonEl,
  });

  const store = new VectorStore(plugin);
  const embedder = new Embedder(
    plugin,
    () => settings().semanticSearchModelKey,
    () => settings().semanticSearchModelPath,
  );
  const sync = new IndexSync(plugin, store, embedder, settings);
  const models = new ModelManager(plugin, () => settings().semanticSearchModelPath);

  /**
   * Load the index for whichever model is selected now.
   * Vectors from another model are not comparable, so the store drops them.
   */
  let loadedKey = "";
  const loadIndexForCurrentModel = async () => {
    const current = getModel(settings().semanticSearchModelKey);
    if (current.key === loadedKey) return;
    loadedKey = current.key;
    await store.load(current.key, current.dims);
    console.log(">>> semantic-search: index loaded", {
      model: current.key,
      vectors: store.size,
      modelReady: await embedder.isReady(),
      modelFolder: embedder.folder,
    });
  };

  plugin.app.workspace.onLayoutReady(() => void loadIndexForCurrentModel());

  // Checking for a model change on every note switch was wasteful for something
  // that happens a handful of times ever. The settings panel calls this instead.
  plugin.registerEvent(
    plugin.app.workspace.on("layout-change", () => void loadIndexForCurrentModel()),
  );

  sync.registerEvents();

  plugin.registerView(
    SEMANTIC_SEARCH_VIEW_TYPE,
    (leaf) =>
      new SemanticSearchView(leaf, {
        store,
        embedder,
        sync,
        settings,
        save: () => plugin.savePluginSettings(),
      }),
  );

  plugin.addCommand({
    id: "open-semantic-search",
    name: "Open semantic relation notes (right sidebar)",
    callback: () => void openView(plugin),
  });

  plugin.addCommand({
    id: "semantic-search-check-model",
    name: "Semantic search: check model",
    callback: () => {
      void (async () => {
        const missing = await embedder.missingFiles();
        if (!missing.length) {
          new Notice(`Model ready: ${spec.name}\nFolder: ${embedder.folder}`, 6000);
          return;
        }
        new Notice(
          `Model not ready (${missing.length}/${REQUIRED_MODEL_FILES.length} files missing).\n` +
            `Expected in: ${embedder.folder}\n` +
            `Missing: ${missing.join(", ")}\n` +
            `See docs/semantic-search-model-setup.md`,
          12000,
        );
      })();
    },
  });

  plugin.addCommand({
    id: "semantic-search-model-status",
    name: "Semantic search: model status",
    callback: () => {
      void (async () => {
        const statuses = await models.allStatuses();
        const lines = statuses.map((status) => {
          const spec = MODELS.find((m) => m.key === status.key);
          const label =
            status.state === "ready"
              ? `ready (${formatBytes(status.bytes)})`
              : status.state === "partial"
                ? `incomplete ${status.presentCount}/${status.files.length}`
                : "not downloaded";
          return `${spec?.name ?? status.key}: ${label}`;
        });
        new Notice(`Models\n${lines.join("\n")}`, 12000);
      })();
    },
  });

  plugin.addCommand({
    id: "semantic-search-embed-current",
    name: "Semantic search: embed current note",
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (!file || file.extension !== "md") return false;
      if (checking) return true;
      void (async () => {
        try {
          if (!(await embedder.isReady())) {
            new Notice("Semantic search: download a model first (Settings -> Semantic Search).", 8000);
            return;
          }
          const changed = await sync.indexFile(file as TFile, true);
          await store.flush();
          const entry = store.get(file.path);
          new Notice(
            changed && entry
              ? `Embedded "${file.basename}" (${entry.vec.length} dimensions).`
              : `Nothing to embed for "${file.basename}".`,
          );
        } catch (err) {
          const message =
            err instanceof MissingModelError ? err.message : "Embedding failed. See the console.";
          new Notice(message, 8000);
          console.error("[semantic-search] embed failed", err);
        }
      })();
      return true;
    },
  });

  plugin.addCommand({
    id: "semantic-search-index-vault",
    name: "Semantic search: index vault",
    callback: () => {
      void (async () => {
        const notice = new Notice("Semantic search: indexing…", 0);
        try {
          const result = await sync.indexVault((done, total) => {
            notice.setMessage(`Semantic search: indexing ${done}/${total}`);
          });
          notice.hide();
          if (result.total === 0) {
            new Notice("Semantic search: no markdown notes to index (check your exclude filter).", 8000);
          } else if (result.failed > 0) {
            console.error("[semantic-search] first indexing error", result.firstError);
            new Notice(
              `Semantic search: ${result.indexed} indexed, ${result.failed} failed. ` +
                `See the developer console for the cause.`,
              10000,
            );
          } else {
            new Notice(
              `Semantic search: indexed ${result.indexed}, already current ${result.skipped}.`,
            );
          }
        } catch (err) {
          notice.hide();
          const message =
            err instanceof MissingModelError ? err.message : "Indexing failed. See the console.";
          new Notice(message, 10000);
          console.error("[semantic-search] indexing failed", err);
        }
      })();
    },
  });

  plugin.addCommand({
    id: "semantic-search-clear-index",
    name: "Semantic search: clear index",
    callback: () => {
      void (async () => {
        store.clear();
        await store.flush();
        new Notice("Semantic search: index cleared.");
      })();
    },
  });

  // Let settings tell us a model changed, rather than polling for it.
  (plugin as unknown as { reloadSemanticIndex?: () => void }).reloadSemanticIndex = () => {
    embedder.refreshReady();
    void loadIndexForCurrentModel();
  };

  plugin.register(() => {
    void store.flush();
    embedder.unload();
  });
}
