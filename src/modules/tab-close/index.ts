import { EventRef, Menu, Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { CloseMode, pickTabsToClose } from "./logic";

const TITLES: Record<CloseMode, string> = {
  all: "Force close all tabs (pinned included)",
  others: "Force close other tabs (pinned included)",
};
const MODES: CloseMode[] = ["all", "others"];

type TabClosePlugin = Plugin & { settings: { enableForceClose: boolean } };

/** A node in Obsidian's workspace tree: a split, a tab group, or a leaf. */
interface SplitNode {
  type?: string;
  children?: SplitNode[];
}

/**
 * Main-area tabs in on-screen order.
 *
 * Walks the root split tree instead of using `iterateRootLeaves`. Since Obsidian 1.7 a tab
 * restored from the last session stays *deferred* until you click it: it is a real leaf in the
 * tab group, but its view is not loaded, and the iterate* helpers skip it. Those are exactly the
 * tabs a force-close is for, so we read the tree directly and every tab shows up, loaded or not.
 */
function listTabs(plugin: TabClosePlugin): WorkspaceLeaf[] {
  const tabs: WorkspaceLeaf[] = [];
  const visit = (node: SplitNode | undefined): void => {
    if (!node) return;
    if (node.type === "leaf") {
      tabs.push(node as unknown as WorkspaceLeaf);
      return;
    }
    node.children?.forEach(visit);
  };
  visit(plugin.app.workspace.rootSplit as unknown as SplitNode);
  return tabs;
}

/**
 * Close tabs even when they are pinned. Pinning only stops Obsidian from reusing a tab for
 * another file; it never stops `detach()`. Both calls are synchronous, so the whole batch runs
 * in one go: no "file-open" can land in between for auto-pin to react to, and the snapshot
 * taken up front stays valid while we work through it.
 */
function forceClose(plugin: TabClosePlugin, mode: CloseMode, target: WorkspaceLeaf | null): void {
  const doomed = pickTabsToClose(mode, listTabs(plugin), target);
  if (doomed.length === 0) {
    new Notice("No tabs to close");
    return;
  }

  for (const leaf of doomed) {
    leaf.setPinned(false);
    leaf.detach();
  }

  new Notice(doomed.length === 1 ? "Closed 1 tab" : `Closed ${doomed.length} tabs`);
}

/** Commands and tab right-click items that close tabs even when they are pinned. */
export function registerTabClose(plugin: TabClosePlugin): void {
  const { workspace } = plugin.app;
  const currentTab = (): WorkspaceLeaf | null => workspace.getMostRecentLeaf(workspace.rootSplit);

  for (const mode of MODES) {
    plugin.addCommand({
      id: `force-close-${mode}`,
      name: TITLES[mode],
      checkCallback: (checking: boolean) => {
        if (!plugin.settings.enableForceClose) return false;
        const target = currentTab();
        if (mode !== "all" && !target) return false;
        if (!checking) forceClose(plugin, mode, target);
        return true;
      },
    });
  }

  // Obsidian fires "leaf-menu" for every tab header right-click (file tabs and others).
  const on = workspace as unknown as {
    on: (name: string, callback: (...args: unknown[]) => void) => EventRef;
  };
  plugin.registerEvent(
    on.on("leaf-menu", (...args: unknown[]) => {
      if (!plugin.settings.enableForceClose) return;
      const [menu, leaf] = args as [Menu, WorkspaceLeaf];
      if (!menu || !leaf || leaf.getRoot() !== workspace.rootSplit) return;

      for (const mode of MODES) {
        menu.addItem((item) =>
          item
            .setTitle(TITLES[mode])
            .setIcon("x-circle")
            .setSection("close")
            .onClick(() => forceClose(plugin, mode, leaf))
        );
      }
    })
  );
}
