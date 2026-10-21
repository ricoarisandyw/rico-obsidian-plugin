/** Marker stored on the canvas node so we can tell our cards from plain text cards. */
export const ROADMAP_NODE_TYPE = "roadmap-node";

/** Default size of a freshly created card, in canvas pixels. */
export const ROADMAP_NODE_SIZE = { width: 320, height: 120 };

/**
 * Progress on a topic, mirroring roadmap.sh. "none" is the implicit state of a
 * card nobody has touched yet; it is never written to disk.
 */
export type RoadmapStatus = "none" | "learning" | "done" | "skip";

/** The four states in the order the dot cycles through them. */
export const STATUS_ORDER: RoadmapStatus[] = ["none", "learning", "done", "skip"];

/** The three states offered as explicit menu/button choices ("none" is the reset). */
export const PICKABLE_STATUSES: RoadmapStatus[] = ["learning", "done", "skip"];

export interface StatusMeta {
  /** Shown on buttons and in menus. */
  label: string;
  /** Lucide icon name, used by Obsidian's setIcon(). */
  icon: string;
  /** CSS class suffix: .is-learning, .is-done, … */
  cls: string;
}

export const STATUS_META: Record<RoadmapStatus, StatusMeta> = {
  none: { label: "Not started", icon: "circle", cls: "is-none" },
  learning: { label: "Learning", icon: "book-open", cls: "is-learning" },
  done: { label: "Done", icon: "check", cls: "is-done" },
  skip: { label: "Skip", icon: "x", cls: "is-skip" },
};

/** An extra resource shown under the article in the panel. */
export interface RoadmapLink {
  label: string;
  url: string;
}

/** Our payload inside the canvas node's data blob. */
export interface RoadmapNodeData {
  title: string;
  status: RoadmapStatus;
  /** Vault-relative path of the linked note, or "" when nothing is linked. */
  articlePath: string;
  links: RoadmapLink[];
}
