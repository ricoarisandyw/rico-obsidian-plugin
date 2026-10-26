import { hashString } from "../semantic-graph/cluster";
import {
  clusterVaultAsync,
  type ClusterMap,
  type ClusterNote,
  type ClusterOptions,
} from "./cluster-all";

/**
 * Going inside a cluster and splitting it again.
 *
 * A level is one view of the map: some set of notes, split into some number of
 * groups. The top level covers the whole vault; entering a group makes a new
 * level covering only that group's notes, split however many ways the user
 * picks. The stack of levels is also what the breadcrumb shows.
 *
 * No Obsidian imports, so it can be tested without a vault.
 */

/** A group with fewer notes than this is not worth splitting any further. */
export const MIN_DRILL_SIZE = 8;

export interface Level {
  /** Name of the group this level was entered from; "All notes" at the top. */
  name: string;
  /** The notes this level covers. */
  notes: ClusterNote[];
  /** How many groups the user asked for. 0 means "choose for me". */
  requested: number;
  map: ClusterMap;
}

export interface Crumb {
  label: string;
  /** Index of the level a click goes back to, or null for the current view. */
  level: number | null;
}

/** Whether a group is big enough to be split again. */
export function canDrill(size: number, minimum = MIN_DRILL_SIZE): boolean {
  return size >= minimum;
}

/**
 * Identity of "these notes, split this way".
 *
 * Used as the cache key, so coming back to a level is instant and the same
 * request never reclusters. Sorted so the order the notes arrive in does not
 * matter.
 */
export function scopeKey(notes: ClusterNote[], requested: number, minSize: number): string {
  const paths = notes.map((note) => note.path).sort();
  return `${paths.length}:${hashString(paths.join("|"))}:${requested}:${minSize}`;
}

/**
 * Cluster `notes` into `requested` groups, or a sensible number when 0.
 *
 * A request for one group is allowed and means "do not split": it produces a
 * single cloud holding every note, which is the notes level of the breadcrumb.
 * A request for more groups than notes is quietly capped by the clustering.
 */
export async function buildLevel(
  name: string,
  notes: ClusterNote[],
  requested: number,
  options: Pick<ClusterOptions, "minSize" | "stopwords"> = {},
  cache?: Map<string, ClusterMap>,
): Promise<Level> {
  const wanted = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 0;
  const key = scopeKey(notes, wanted, options.minSize ?? 0);

  let map = cache?.get(key);
  if (!map) {
    map = await clusterVaultAsync(notes, {
      k: wanted,
      minSize: options.minSize,
      stopwords: options.stopwords,
    });
    cache?.set(key, map);
  }
  return { name, notes, requested: wanted, map };
}

/** The notes inside one group of a level, in the group's own order. */
export function notesOf(level: Level, clusterId: number): ClusterNote[] {
  const group = level.map.clusters[clusterId];
  if (!group) return [];
  const byPath = new Map(level.notes.map((note) => [note.path, note]));
  return group.members.flatMap((path) => {
    const note = byPath.get(path);
    return note ? [note] : [];
  });
}

/** Keep the stack down to and including `index`. */
export function truncateTo(levels: Level[], index: number): Level[] {
  if (index < 0) return levels.slice(0, 1);
  return levels.slice(0, index + 1);
}

function count(n: number): string {
  return `${n} ${n === 1 ? "cluster" : "clusters"}`;
}

/**
 * The breadcrumb trail for a stack of levels.
 *
 * Each crumb is a group that was entered, with how many groups it is split into
 * right now. When the current level is one single group there is nothing left
 * to split, so the trail ends in "notes": the individual notes are what is on
 * screen.
 */
export function levelCrumbs(levels: Level[]): Crumb[] {
  if (!levels.length) return [];
  const crumbs: Crumb[] = levels.map((level, index) => ({
    label: `${level.name} (${count(level.map.clusters.length)})`,
    level: index === levels.length - 1 ? null : index,
  }));
  const current = levels[levels.length - 1];
  if (current.map.clusters.length === 1) crumbs.push({ label: "notes", level: null });
  return crumbs;
}

/** The trail as plain text, for tests and for the tab's tooltip. */
export function formatCrumbs(levels: Level[]): string {
  return levelCrumbs(levels)
    .map((crumb) => crumb.label)
    .join(" › ");
}
