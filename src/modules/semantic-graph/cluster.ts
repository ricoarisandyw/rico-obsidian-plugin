import type { SemanticGraph } from "./logic";

/**
 * Grouping neighbours by topic.
 *
 * Distance from the centre says how related a note is to the one being read;
 * it says nothing about how related the neighbours are to *each other*. A
 * quick k-means over their vectors fills that gap, so the layout can put notes
 * about the same thing on the same side. Same idea as the Smart Connections
 * similarity map, minus its fixed four quadrants.
 *
 * No Obsidian imports, so it can be tested without a vault.
 */

export type Vector = ArrayLike<number>;

/** Small fixed-seed generator: the same notes must always cluster the same way. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a, enough to turn a list of paths into a seed. */
export function hashString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Scale to length 1, or null for an empty or all-zero vector. */
function toUnit(vec: Vector): Float64Array | null {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const length = Math.sqrt(sum);
  if (!Number.isFinite(length) || length === 0) return null;
  const out = new Float64Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / length;
  return out;
}

/** Cosine similarity of two unit vectors is just their dot product. */
function dot(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += a[i] * b[i];
  return sum;
}

const MAX_ITERATIONS = 50;

/**
 * Cluster id per vector, or -1 where the vector is missing or unusable.
 *
 * Clusters are numbered by first appearance, so with results sorted by score
 * the nearest neighbour is always in cluster 0. With fewer than two clusters'
 * worth of vectors there is nothing to separate, and everything comes back -1.
 */
export function kmeansCosine(
  vectors: (Vector | null | undefined)[],
  k: number,
  seed = 1,
): number[] {
  const units = vectors.map((vec) => (vec ? toUnit(vec) : null));
  const valid = units.flatMap((unit, i) => (unit ? [i] : []));
  const count = Math.min(Math.floor(k), valid.length);
  const none = vectors.map(() => -1);
  if (!Number.isFinite(count) || count < 2) return none;

  const rand = mulberry32(seed);

  // k-means++: each new centre is picked far from the ones already chosen,
  // which stops two centres landing in the same blob.
  const centres: Float64Array[] = [units[valid[Math.floor(rand() * valid.length)]!]!];
  while (centres.length < count) {
    const weights = valid.map((i) => {
      let best = -Infinity;
      for (const centre of centres) best = Math.max(best, dot(units[i]!, centre));
      const gap = 1 - Math.min(1, Math.max(0, best));
      return gap * gap;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let pick = valid.length - 1;
    if (total > 0) {
      let target = rand() * total;
      for (let j = 0; j < weights.length; j++) {
        target -= weights[j];
        if (target <= 0) {
          pick = j;
          break;
        }
      }
    } else {
      // Every remaining vector sits on an existing centre; any one will do.
      pick = Math.floor(rand() * valid.length);
    }
    centres.push(units[valid[pick]]!);
  }

  const assign = new Array<number>(valid.length).fill(-1);
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let changed = false;
    valid.forEach((i, j) => {
      let best = 0;
      let bestSim = -Infinity;
      centres.forEach((centre, c) => {
        const sim = dot(units[i]!, centre);
        if (sim > bestSim) {
          bestSim = sim;
          best = c;
        }
      });
      if (assign[j] !== best) {
        assign[j] = best;
        changed = true;
      }
    });
    if (!changed) break;

    // Move each centre to the mean of its members. An emptied cluster keeps its
    // old centre rather than collapsing to nothing.
    centres.forEach((centre, c) => {
      const mean = new Float64Array(centre.length);
      let members = 0;
      valid.forEach((i, j) => {
        if (assign[j] !== c) return;
        members++;
        const unit = units[i]!;
        for (let d = 0; d < mean.length; d++) mean[d] += unit[d] ?? 0;
      });
      if (!members) return;
      const next = toUnit(mean);
      if (next) centres[c] = next;
    });
  }

  // Renumber by first appearance so ids are stable for a given ordering.
  const renumber = new Map<number, number>();
  const result = none;
  valid.forEach((i, j) => {
    if (!renumber.has(assign[j])) renumber.set(assign[j], renumber.size);
    result[i] = renumber.get(assign[j])!;
  });
  return result;
}

/**
 * Stamp a cluster onto every neighbour in the graph.
 *
 * The centre is left out: it belongs to no group, it is what the groups are
 * measured against. Neighbours with no vector get no cluster, so the layout and
 * renderer treat them as ungrouped rather than guessing.
 */
export function assignClusters(
  graph: SemanticGraph,
  vectorOf: (path: string) => Vector | null | undefined,
  k: number,
): SemanticGraph {
  const neighbours = graph.nodes.filter((node) => node.hop > 0);
  const assign = kmeansCosine(
    neighbours.map((node) => vectorOf(node.path)),
    k,
    hashString(neighbours.map((node) => node.path).join("|")),
  );
  const byPath = new Map(neighbours.map((node, i) => [node.path, assign[i]]));

  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const { cluster: _old, ...rest } = node;
      const cluster = byPath.get(node.path);
      return cluster !== undefined && cluster >= 0 ? { ...rest, cluster } : rest;
    }),
  };
}

/** How many clusters the graph holds, from the highest id present. */
export function clusterCount(graph: SemanticGraph): number {
  let highest = -1;
  for (const node of graph.nodes) {
    if (node.cluster !== undefined && node.cluster > highest) highest = node.cluster;
  }
  return highest + 1;
}

/** Hue in degrees for a cluster, spread evenly round the wheel. */
export function clusterHue(cluster: number, count: number): number {
  if (count <= 0 || cluster < 0) return 0;
  return (210 + (360 * cluster) / count) % 360;
}
