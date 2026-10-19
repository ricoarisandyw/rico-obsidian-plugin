import { describe, it, expect } from "vitest";
import { CloseMode, pickTabsToClose } from "../src/modules/tab-close/logic";
import { registerTabClose } from "../src/modules/tab-close";

const tabs = ["a", "b", "c", "d", "e"];

describe("pickTabsToClose", () => {
  it("all: every tab in the main area", () => {
    expect(pickTabsToClose("all", tabs, "b")).toEqual(["a", "b", "c", "d", "e"]);
    expect(pickTabsToClose("all", tabs, null)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("others: everything except the target", () => {
    expect(pickTabsToClose("others", tabs, "b")).toEqual(["a", "c", "d", "e"]);
  });

  it("others needs a target", () => {
    expect(pickTabsToClose("others", tabs, null)).toEqual([]);
  });

  it("works with no tabs open", () => {
    expect(pickTabsToClose("all", [], null)).toEqual([]);
  });
});

// --- registerTabClose: what the commands actually do to the tabs ---

interface FakeLeaf {
  name: string;
  pinned: boolean;
  detached: number;
  setPinned(value: boolean): void;
  detach(): void;
  getRoot(): unknown;
}

const ROOT = { root: true };

function makeLeaf(name: string, pinned = true): FakeLeaf {
  return {
    name,
    pinned,
    detached: 0,
    setPinned(value: boolean) {
      this.pinned = value;
    },
    detach() {
      this.detached += 1;
    },
    getRoot: () => ROOT,
  };
}

/**
 * A plugin whose workspace tree is `split -> tabs -> leaf*`, the shape Obsidian really uses.
 * `deferred` tabs are left out of iterateRootLeaves on purpose: that is what Obsidian does to
 * a tab restored from the last session until you click it, and it is the bug this module hit.
 */
function makePlugin(leaves: FakeLeaf[], mostRecent: FakeLeaf | null, deferred: FakeLeaf[] = []) {
  const commands = new Map<string, (checking: boolean) => boolean>();
  const loaded = leaves.filter((leaf) => !deferred.includes(leaf));
  const tabGroup = { type: "tabs", children: leaves.map((leaf) => ({ ...leaf, type: "leaf" })) };
  // Keep the identity of each fake leaf: the tree must hand back the same objects.
  tabGroup.children = leaves.map((leaf) => Object.assign(leaf, { type: "leaf" }));
  const rootSplit = Object.assign(ROOT, { type: "split", children: [tabGroup] });

  const plugin = {
    settings: { enableForceClose: true },
    app: {
      workspace: {
        rootSplit,
        getMostRecentLeaf: () => mostRecent,
        iterateRootLeaves: (cb: (leaf: FakeLeaf) => void) => loaded.forEach(cb),
        on: () => ({}),
      },
    },
    addCommand: (cmd: { id: string; checkCallback: (checking: boolean) => boolean }) => {
      commands.set(cmd.id, cmd.checkCallback);
    },
    registerEvent: () => {},
  };
  return { plugin, commands };
}

const run = (
  leaves: FakeLeaf[],
  mostRecent: FakeLeaf | null,
  mode: CloseMode,
  deferred: FakeLeaf[] = []
) => {
  const { plugin, commands } = makePlugin(leaves, mostRecent, deferred);
  registerTabClose(plugin as never);
  return commands.get(`force-close-${mode}`)!(false);
};

describe("registerTabClose", () => {
  it("all: detaches every tab exactly once", () => {
    const leaves = [makeLeaf("a"), makeLeaf("b"), makeLeaf("c")];
    run(leaves, leaves[1], "all");
    expect(leaves.map((l) => l.detached)).toEqual([1, 1, 1]);
  });

  it("others: leaves the target open and detaches the rest once each", () => {
    const leaves = [makeLeaf("a"), makeLeaf("b"), makeLeaf("c")];
    run(leaves, leaves[1], "others");
    expect(leaves.map((l) => l.detached)).toEqual([1, 0, 1]);
  });

  it("unpins each tab before detaching it", () => {
    const leaves = [makeLeaf("a", true), makeLeaf("b", true)];
    run(leaves, leaves[0], "all");
    expect(leaves.every((l) => l.pinned === false)).toBe(true);
  });

  it("does nothing when there is nothing to close", () => {
    const only = makeLeaf("a");
    run([only], only, "others");
    expect(only.detached).toBe(0);
  });

  it("registers no working command while the feature is off", () => {
    const leaves = [makeLeaf("a")];
    const { plugin, commands } = makePlugin(leaves, leaves[0]);
    plugin.settings.enableForceClose = false;
    registerTabClose(plugin as never);
    expect(commands.get("force-close-all")!(false)).toBe(false);
    expect(leaves[0].detached).toBe(0);
  });
  // Obsidian 1.7+ keeps a tab from the last session "deferred" until it is clicked: it is in the
  // tab group but iterateRootLeaves skips it. Force-close exists precisely for those tabs.
  it("closes deferred tabs that iterateRootLeaves cannot see", () => {
    const leaves = [makeLeaf("active"), makeLeaf("deferred-1"), makeLeaf("deferred-2")];
    const deferred = [leaves[1], leaves[2]];
    run(leaves, leaves[0], "others", deferred);
    expect(leaves.map((l) => l.detached)).toEqual([0, 1, 1]);
  });

  it("closes every tab in 'all' mode even when most are deferred", () => {
    const leaves = [makeLeaf("a"), makeLeaf("b"), makeLeaf("c"), makeLeaf("d")];
    run(leaves, leaves[0], "all", [leaves[1], leaves[2], leaves[3]]);
    expect(leaves.map((l) => l.detached)).toEqual([1, 1, 1, 1]);
  });
});
