/** The last tab Obsidian handed out through workspace.getLeaf(), and whether it was asked for explicitly. */
export interface LeafRequest<L> {
  leaf: L;
  /** True for "open in new tab", "open to the right" (split) and "open in new window". */
  explicit: boolean;
  time: number;
}

/**
 * getLeaf(arg): `true`, "tab", "split" and "window" mean the user asked for a new tab / split / window.
 * `false` or nothing means a plain open, which Obsidian answers with an unpinned tab (a brand-new
 * one when every tab is pinned).
 */
export function isExplicitNewLeaf(arg: unknown): boolean {
  return arg === true || arg === "tab" || arg === "split" || arg === "window";
}

/**
 * Reuse an already open tab only when this tab came from a plain open (not an explicit new tab,
 * split or window) a moment ago. Tabs that are merely switched to never match.
 */
export function shouldReuseExisting<L>(
  request: LeafRequest<L> | null,
  leaf: L,
  now: number,
  windowMs = 3000
): boolean {
  return !!request && request.leaf === leaf && !request.explicit && now - request.time <= windowMs;
}
