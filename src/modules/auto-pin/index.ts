import { FileView, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { LeafRequest, isExplicitNewLeaf, shouldReuseExisting } from "./logic";

type GetLeaf = (...args: unknown[]) => WorkspaceLeaf;

/**
 * Pin every tab a file is opened in, so it is never replaced by the next file.
 * Only tabs in the main editor area are pinned (not sidebars), and each leaf is
 * pinned once per file, so a tab you unpin yourself stays unpinned until it shows
 * a different file.
 *
 * Opening a file that is already open in another main-area tab reuses that tab
 * (and pins it) instead of making a second one. Explicit "open in new tab",
 * "open to the right" and "open in new window" still make a copy on purpose.
 *
 * Why this is needed: Obsidian never replaces a pinned tab, so a plain open of a
 * file always lands in a fresh tab, even if the same file is already open and pinned.
 * To tell a plain open from an explicit one, we watch workspace.getLeaf(): it is
 * called with "tab" / "split" / "window" / true for explicit opens.
 */
export function registerAutoPin(plugin: Plugin & { settings: { enableAutoPin: boolean } }): void {
  const workspace = plugin.app.workspace;
  const pinnedPath = new WeakMap<WorkspaceLeaf, string>();
  let lastRequest: LeafRequest<WorkspaceLeaf> | null = null;

  // ---- Remember which tab each open was routed to, and whether it was explicit ----
  const patched = workspace as unknown as { getLeaf?: GetLeaf };
  const original = patched.getLeaf as GetLeaf;
  const hadOwn = Object.prototype.hasOwnProperty.call(patched, "getLeaf");
  let installed = true;

  const wrapper: GetLeaf = function (this: unknown, ...args: unknown[]) {
    const leaf = original.apply(this, args);
    if (installed && plugin.settings.enableAutoPin) {
      lastRequest = { leaf, explicit: isExplicitNewLeaf(args[0]), time: Date.now() };
    }
    return leaf;
  };
  patched.getLeaf = wrapper;

  plugin.register(() => {
    installed = false;
    // Only undo our patch if nobody patched on top of it; otherwise we just stop recording.
    if (patched.getLeaf === wrapper) {
      if (hadOwn) patched.getLeaf = original;
      else delete patched.getLeaf;
    }
  });

  /** Another main-area tab that already shows this file. */
  function findOpenLeaf(file: TFile, except: WorkspaceLeaf): WorkspaceLeaf | null {
    let found: WorkspaceLeaf | null = null;
    workspace.iterateRootLeaves((candidate) => {
      if (found || candidate === except) return;
      const view = candidate.view;
      if (view instanceof FileView && view.file?.path === file.path) found = candidate;
    });
    return found;
  }

  /** Show the existing tab (pinned) and close the duplicate that was just opened. */
  function reuse(existing: WorkspaceLeaf, duplicate: WorkspaceLeaf, file: TFile): void {
    // Carry over a heading/block target from a link like [[note#heading]], if there is one.
    let subpath: string | undefined;
    try {
      subpath = (duplicate.getEphemeralState() as { subpath?: string } | undefined)?.subpath;
    } catch {
      subpath = undefined;
    }

    pinnedPath.set(existing, file.path);
    existing.setPinned(true);
    workspace.setActiveLeaf(existing, { focus: true });
    if (subpath) existing.setEphemeralState({ subpath });
    duplicate.detach();
  }

  plugin.registerEvent(
    workspace.on("file-open", (file) => {
      if (!plugin.settings.enableAutoPin || !file) return;

      const leaf = workspace.getActiveViewOfType(FileView)?.leaf;
      if (!leaf || leaf.getRoot() !== workspace.rootSplit) return;
      if (pinnedPath.get(leaf) === file.path) return;

      if (lastRequest && lastRequest.leaf === leaf) {
        const request = lastRequest;
        lastRequest = null;
        if (shouldReuseExisting(request, leaf, Date.now())) {
          const existing = findOpenLeaf(file, leaf);
          if (existing) {
            reuse(existing, leaf, file);
            return;
          }
        }
      }

      pinnedPath.set(leaf, file.path);
      leaf.setPinned(true);
    })
  );
}
