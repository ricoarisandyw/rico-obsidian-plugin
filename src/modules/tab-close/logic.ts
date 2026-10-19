export type CloseMode = "all" | "others";

/**
 * Which tabs a force-close removes. Pinned tabs are included on purpose.
 * `tabs` are the main-area tabs in on-screen order.
 * - all:    every tab in the main area
 * - others: every tab in the main area except `target`
 */
export function pickTabsToClose<T>(mode: CloseMode, tabs: T[], target: T | null): T[] {
  if (mode === "all") return [...tabs];
  if (target === null) return [];
  return tabs.filter((tab) => tab !== target);
}
