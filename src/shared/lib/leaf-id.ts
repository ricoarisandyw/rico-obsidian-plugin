import type { WorkspaceLeaf } from "obsidian";

/**
 * A leaf's id.
 *
 * Obsidian sets `id` on every leaf at runtime, but its typings do not declare
 * it, so reading `leaf.id` directly fails the typecheck. One cast here keeps
 * that out of every caller.
 */
export function leafId(leaf: WorkspaceLeaf): string {
  return (leaf as WorkspaceLeaf & { id: string }).id;
}
