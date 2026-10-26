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
  /** Title of the note that best represents the group; see `pickName`. */
  name: string;
  /** Path of the note the name came from; null when it came from a folder or a placeholder. */
  namePath: string | null;
  /** The words that set this group apart from the rest. Empty without snippets. */
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
  /** Words dropped as keywords because most groups use them; commonest first. */
  autoStopwords: string[];
}

export interface ClusterOptions {
  /** How many groups to make. 0 or absent means choose from the vault's size. */
  k?: number;
  /** Groups smaller than this are folded into their nearest neighbour. */
  minSize?: number;
  /** Nearest groups each group links to. */
  linksPerCluster?: number;
  /** Extra words to ignore when naming groups, on top of the built-in and detected ones. */
  stopwords?: string[];
}

const MIN_AUTO_K = 4;
const MAX_AUTO_K = 40;
const DEFAULT_MIN_SIZE = 3;
const DEFAULT_LINKS = 2;
const SUBTITLE_WORDS = 5;
/** A word used in at least this share of the groups says nothing about any one of them. */
const COMMON_SHARE = 0.5;
/** Fewer groups than this and a share of them means too little to act on. */
const MIN_GROUPS_FOR_COMMON = 4;
/** Detected words listed for the user to review. */
const MAX_AUTO_STOPWORDS = 40;
/** How many of the notes nearest the centre compete to name the group. */
const NAME_CANDIDATES = 5;

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
    "aku kamu dia banyak tentang cara should could might must shall may " +
    "readme index untitled notes note todo draft home catatan judul " +
    "http https www com md png jpg"
  ).split(" "),
);

/** Lowercase words of three letters or more, with numbers and stopwords dropped. */
export function tokenize(text: string, extra?: ReadonlySet<string>): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return words.filter(
    (word) => !STOPWORDS.has(word) && !extra?.has(word) && !/^\p{N}+$/u.test(word),
  );
}

/** Split a comma, space or line separated list into lowercase, de-duplicated words. */
export function parseStopwords(raw: string | undefined): string[] {
  const words = (raw ?? "").toLowerCase().split(/[\s,;]+/).filter(Boolean);
  return [...new Set(words)];
}

/**
 * The words most particular to each group, and the words dropped for being everywhere.
 *
 * A word scores by how often the group uses it, scaled down by how many other
 * groups use it too, so "meeting" in every group loses to "hvac" in one. That
 * only turns the volume down: a filler word a group repeats a lot can still win.
 * So a word that most groups use repeatedly is treated as a stopword outright.
 * It holds in any language, because it is judged on how the words are spread,
 * not on a list.
 */
function distinctiveWords(
  texts: string[][],
  perCluster: number,
  extra: ReadonlySet<string>,
): { words: string[][]; common: string[] } {
  const counts = texts.map((snippets) => {
    const tally = new Map<string, number>();
    for (const snippet of snippets) {
      for (const word of tokenize(snippet, extra)) tally.set(word, (tally.get(word) ?? 0) + 1);
    }
    return tally;
  });

  const spread = new Map<string, number>();
  const repeated = new Map<string, number>();
  const uses = new Map<string, number>();
  for (const tally of counts) {
    for (const [word, count] of tally) {
      spread.set(word, (spread.get(word) ?? 0) + 1);
      uses.set(word, (uses.get(word) ?? 0) + count);
      if (count > 1) repeated.set(word, (repeated.get(word) ?? 0) + 1);
    }
  }

  const total = Math.max(1, counts.length);
  const common = new Set<string>();
  if (total >= MIN_GROUPS_FOR_COMMON) {
    for (const [word, groups] of repeated) if (groups / total >= COMMON_SHARE) common.add(word);
  }

  const words = counts.map((tally) =>
    [...tally.entries()]
      // Words seen once are noise at this scale.
      .filter(([word, count]) => count > 1 && !common.has(word))
      .map(([word, count]) => ({
        word,
        score: count * Math.log(1 + total / (spread.get(word) ?? 1)),
      }))
      .sort((a, b) => b.score - a.score || (a.word < b.word ? -1 : 1))
      .slice(0, perCluster)
      .map((entry) => entry.word),
  );

  const dropped = [...common]
    .sort((a, b) => (uses.get(b) ?? 0) - (uses.get(a) ?? 0) || (a < b ? -1 : 1))
    .slice(0, MAX_AUTO_STOPWORDS);
  return { words, common: dropped };
}

/** Name of the folder a note sits in, or "" at the vault root. */
function folderOf(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts[parts.length - 2] : "";
}

/**
 * The name a group is shown under.
 *
 * The note nearest the centre is often a bad pick: a README or an index says
 * little about any topic, so it sits near every centre. Instead the few notes
 * nearest the centre compete on how many of the group's own keywords appear in
 * their title or folder name, and the best match wins. A tie goes to the note
 * nearer the centre, so the answer depends only on the data.
 *
 * When nothing matches and the nearest note's title is generic (README, a bare
 * date), its folder names the group instead. Failing that, the nearest note.
 *
 * `paths` is ordered nearest the centre first.
 */
function pickName(
  paths: string[],
  keywords: string[],
  id: number,
  extra: ReadonlySet<string>,
): { name: string; path: string | null } {
  if (!paths.length) return { name: `Group ${id + 1}`, path: null };

  const wanted = new Set(keywords);
  let best = 0;
  let bestScore = 0;
  paths.slice(0, NAME_CANDIDATES).forEach((path, i) => {
    const hits = new Set(
      [...tokenize(labelFor(path), extra), ...tokenize(folderOf(path), extra)].filter((word) =>
        wanted.has(word),
      ),
    );
    if (hits.size > bestScore) {
      best = i;
      bestScore = hits.size;
    }
  });
  if (bestScore > 0) return { name: labelFor(paths[best]), path: paths[best] };

  const nearest = paths[0];
  if (tokenize(labelFor(nearest), extra).length === 0) {
    const folder = folderOf(nearest);
    if (tokenize(folder, extra).length > 0) return { name: folder, path: null };
  }
  return { name: labelFor(nearest), path: nearest };
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

  const extra = new Set((options.stopwords ?? []).map((word) => word.toLowerCase()));
  const { words, common } = distinctiveWords(
    ordered.map((indexes) => indexes.map((i) => notes[i].text ?? "")),
    SUBTITLE_WORDS,
    extra,
  );

  const clusters: Cluster[] = ordered.map((indexes, id) => {
    const members = indexes.map((i) => notes[i].path);
    const named = pickName(members, words[id], id, extra);
    return {
      id,
      members,
      centroid: centres[id] ?? new Float64Array(0),
      name: named.name,
      namePath: named.path,
      subtitle: words[id].join(" · "),
    };
  });

  const of = new Map<string, number>();
  final.forEach((id, i) => {
    if (id >= 0) of.set(notes[i].path, id);
  });

  return {
    clusters,
    links: nearestLinks(clusters, linksPer),
    of,
    unusable: final.filter((id) => id < 0).length,
    autoStopwords: common,
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
