import {
  centroidsOf,
  cosineSimilarity,
  hashString,
  kmeansCosine,
  kmeansCosineAsync,
} from "../semantic-graph/cluster";
import { labelFor } from "../semantic-graph/logic";

/**
 * Grouping every note in the vault by topic.
 *
 * The neighbour graph clusters a dozen notes around one; this clusters all of
 * them with no centre at all. The steps are the same ones Smart Graph shows —
 * k-means over the embeddings, a name per group, and links between groups that
 * sit close together — but everything is computed here from the local index.
 *
 * No Obsidian imports, so it can be tested without a vault.
 */

export interface ClusterNote {
  path: string;
  vec: number[];
  /** Bounded snippet from the index, used to find a group's distinctive words. */
  text?: string;
}

export interface Cluster {
  /** 0 is the biggest group; ids follow size, so colours are stable by rank. */
  id: number;
  /** Paths, nearest the centre of the group first. */
  members: string[];
  /** Unit vector at the middle of the group. */
  centroid: Float64Array;
  /** Title of the note closest to the centre. */
  name: string;
  /** A few words that set this group apart from the rest. Empty without snippets. */
  subtitle: string;
}

export interface ClusterLink {
  a: number;
  b: number;
  /** Cosine similarity of the two centroids, 0-1. */
  strength: number;
}

export interface ClusterMap {
  clusters: Cluster[];
  links: ClusterLink[];
  /** Cluster id for each note path. */
  of: Map<string, number>;
  /** Notes with no usable vector, left out of every group. */
  unusable: number;
}

export interface ClusterOptions {
  /** How many groups to make. 0 or absent means choose from the vault's size. */
  k?: number;
  /** Groups smaller than this are folded into their nearest neighbour. */
  minSize?: number;
  /** Nearest groups each group links to. */
  linksPerCluster?: number;
}

const MIN_AUTO_K = 4;
const MAX_AUTO_K = 40;
const DEFAULT_MIN_SIZE = 3;
const DEFAULT_LINKS = 2;
const SUBTITLE_WORDS = 3;

/**
 * How many groups a vault of `noteCount` notes should split into.
 *
 * Roughly √(n/2): 500 notes give about 16 groups of 30, which is the grain
 * where a name still describes everyone in it. Clamped so a small vault is not
 * shredded and a huge one is not turned into confetti.
 */
export function autoClusterCount(noteCount: number): number {
  if (!Number.isFinite(noteCount) || noteCount <= 0) return 0;
  const guess = Math.round(Math.sqrt(noteCount / 2));
  const clamped = Math.min(MAX_AUTO_K, Math.max(MIN_AUTO_K, guess));
  return Math.min(clamped, Math.floor(noteCount));
}

/** Words too common to say anything about a topic, in English and Indonesian. */
const STOPWORDS = new Set(
  (
    "the and for are but not you all can was were with that this from have has had will would " +
    "there their what when which who how why your our out one two its into than then them they " +
    "been being also more some such only other about over just like very any each use used using " +
    "yang dan di ke dari untuk dengan pada ini itu atau juga akan sudah adalah dalam tidak bisa " +
    "ada oleh karena saya kita kami mereka anda sebagai lebih agar jika kalau saat para hanya " +
    "http https www com md png jpg"
  ).split(" "),
);

/** Lowercase words of three letters or more, with numbers and stopwords dropped. */
export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return words.filter((word) => !STOPWORDS.has(word) && !/^\p{N}+$/u.test(word));
}

/**
 * The words most particular to each group.
 *
 * A word scores by how often the group uses it, scaled down by how many other
 * groups use it too, so "meeting" in every group loses to "hvac" in one.
 */
function distinctiveWords(texts: string[][], perCluster: number): string[][] {
  const counts = texts.map((snippets) => {
    const tally = new Map<string, number>();
    for (const snippet of snippets) {
      for (const word of tokenize(snippet)) tally.set(word, (tally.get(word) ?? 0) + 1);
    }
    return tally;
  });

  const spread = new Map<string, number>();
  for (const tally of counts) {
    for (const word of tally.keys()) spread.set(word, (spread.get(word) ?? 0) + 1);
  }

  const total = Math.max(1, counts.length);
  return counts.map((tally) =>
    [...tally.entries()]
      // Words seen once are noise at this scale.
      .filter(([, count]) => count > 1)
      .map(([word, count]) => ({
        word,
        score: count * Math.log(1 + total / (spread.get(word) ?? 1)),
      }))
      .sort((a, b) => b.score - a.score || (a.word < b.word ? -1 : 1))
      .slice(0, perCluster)
      .map((entry) => entry.word),
  );
}

/**
 * Fold every group below `minSize` into the nearest group that remains.
 *
 * k-means will happily leave a stray handful of notes as their own group,
 * which on the map is a lonely blob with a name that fits three notes. The
 * smallest goes first so the notes land in the best of what is left.
 */
function mergeSmall(
  vectors: number[][],
  assign: number[],
  count: number,
  minSize: number,
): number[] {
  const next = [...assign];
  const alive = new Set<number>(Array.from({ length: count }, (_, i) => i));
  const sizeOf = (id: number) => next.reduce((n, c) => n + (c === id ? 1 : 0), 0);

  while (alive.size > 1) {
    let smallest = -1;
    let smallestSize = Infinity;
    for (const id of alive) {
      const size = sizeOf(id);
      if (size < smallestSize) {
        smallest = id;
        smallestSize = size;
      }
    }
    if (smallestSize >= minSize) break;

    alive.delete(smallest);
    const centres = centroidsOf(vectors, next, count);
    const own = centres[smallest];
    let target = -1;
    let best = -Infinity;
    for (const id of alive) {
      const centre = centres[id];
      if (!centre || !own) continue;
      const sim = cosineSimilarity(own, centre);
      if (sim > best) {
        best = sim;
        target = id;
      }
    }
    // An empty or unusable group has nothing to compare; any survivor will do.
    if (target < 0) target = alive.values().next().value as number;
    for (let i = 0; i < next.length; i++) if (next[i] === smallest) next[i] = target;
  }
  return next;
}

/**
 * Everything after the k-means step: merge strays, order, name and link.
 *
 * Split out from the clustering itself so the sync and async entry points
 * share it, and so it can be tested with hand-made assignments.
 */
export function buildClusterMap(
  notes: ClusterNote[],
  assign: number[],
  options: ClusterOptions = {},
): ClusterMap {
  const minSize = Math.max(1, options.minSize ?? DEFAULT_MIN_SIZE);
  const linksPer = Math.max(0, options.linksPerCluster ?? DEFAULT_LINKS);
  const vectors = notes.map((note) => note.vec);

  // Nothing could be separated (too few notes, or k below two): one group.
  const usable = assign.some((id) => id >= 0);
  const base = usable ? assign : notes.map(() => 0);
  const highest = Math.max(-1, ...base);
  const merged = highest >= 1 ? mergeSmall(vectors, base, highest + 1, minSize) : base;

  // Renumber by group size, biggest first, dropping ids that merging emptied.
  const sizes = new Map<number, number>();
  for (const id of merged) if (id >= 0) sizes.set(id, (sizes.get(id) ?? 0) + 1);
  const ranked = [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([id]) => id);
  const renumber = new Map(ranked.map((old, rank) => [old, rank]));
  const final = merged.map((id) => (id >= 0 ? renumber.get(id)! : -1));

  const centres = centroidsOf(vectors, final, ranked.length);
  const memberIdx: number[][] = ranked.map(() => []);
  final.forEach((id, i) => {
    if (id >= 0) memberIdx[id].push(i);
  });

  // Nearest the centre first: the layout puts those in the middle of the blob,
  // and the first one is what the group is named after.
  const ordered = memberIdx.map((indexes, id) => {
    const centre = centres[id];
    if (!centre) return indexes;
    return indexes
      .map((i) => ({ i, sim: cosineSimilarity(vectors[i], centre) }))
      .sort((a, b) => b.sim - a.sim || (notes[a.i].path < notes[b.i].path ? -1 : 1))
      .map((entry) => entry.i);
  });

  const words = distinctiveWords(
    ordered.map((indexes) => indexes.map((i) => notes[i].text ?? "")),
    SUBTITLE_WORDS,
  );

  const clusters: Cluster[] = ordered.map((indexes, id) => ({
    id,
    members: indexes.map((i) => notes[i].path),
    centroid: centres[id] ?? new Float64Array(0),
    name: indexes.length ? labelFor(notes[indexes[0]].path) : `Group ${id + 1}`,
    subtitle: words[id].join(" · "),
  }));

  const of = new Map<string, number>();
  final.forEach((id, i) => {
    if (id >= 0) of.set(notes[i].path, id);
  });

  return {
    clusters,
    links: nearestLinks(clusters, linksPer),
    of,
    unusable: final.filter((id) => id < 0).length,
  };
}

/** Link each group to the few groups whose centres are most alike, once per pair. */
function nearestLinks(clusters: Cluster[], perCluster: number): ClusterLink[] {
  if (perCluster <= 0) return [];
  const seen = new Set<string>();
  const links: ClusterLink[] = [];

  for (const from of clusters) {
    if (!from.centroid.length) continue;
    const nearest = clusters
      .filter((other) => other.id !== from.id && other.centroid.length)
      .map((other) => ({
        other,
        sim: Math.min(1, Math.max(0, cosineSimilarity(from.centroid, other.centroid))),
      }))
      .sort((a, b) => b.sim - a.sim || a.other.id - b.other.id)
      .slice(0, perCluster);

    for (const { other, sim } of nearest) {
      const key = from.id < other.id ? `${from.id}-${other.id}` : `${other.id}-${from.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ a: Math.min(from.id, other.id), b: Math.max(from.id, other.id), strength: sim });
    }
  }
  return links;
}

/** Notes with a usable vector, in a stable order so the same vault always clusters the same way. */
function usableNotes(notes: ClusterNote[]): { kept: ClusterNote[]; unusable: number } {
  const kept = notes
    .filter((note) => note.vec?.length > 0 && note.vec.some((v) => v !== 0))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { kept, unusable: notes.length - kept.length };
}

function plan(notes: ClusterNote[], options: ClusterOptions) {
  const { kept, unusable } = usableNotes(notes);
  const k = options.k && options.k > 0 ? Math.floor(options.k) : autoClusterCount(kept.length);
  const seed = hashString(`${kept.length}|${k}|${kept[0]?.path ?? ""}`);
  return { kept, unusable, k, seed };
}

function finish(kept: ClusterNote[], unusable: number, assign: number[], options: ClusterOptions) {
  const map = buildClusterMap(kept, assign, options);
  return { ...map, unusable: map.unusable + unusable };
}

/** Cluster the whole vault, start to finish, in one go. */
export function clusterVault(notes: ClusterNote[], options: ClusterOptions = {}): ClusterMap {
  const { kept, unusable, k, seed } = plan(notes, options);
  const assign = kmeansCosine(
    kept.map((note) => note.vec),
    k,
    seed,
  );
  return finish(kept, unusable, assign, options);
}

/** Same result as `clusterVault`, pausing between iterations so the UI stays alive. */
export async function clusterVaultAsync(
  notes: ClusterNote[],
  options: ClusterOptions = {},
): Promise<ClusterMap> {
  const { kept, unusable, k, seed } = plan(notes, options);
  const assign = await kmeansCosineAsync(
    kept.map((note) => note.vec),
    k,
    seed,
  );
  return finish(kept, unusable, assign, options);
}
