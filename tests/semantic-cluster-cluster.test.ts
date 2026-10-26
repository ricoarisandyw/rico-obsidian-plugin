import { describe, expect, it } from "vitest";
import {
  autoClusterCount,
  buildClusterMap,
  clusterVault,
  clusterVaultAsync,
  parseStopwords,
  tokenize,
  type ClusterNote,
} from "../src/modules/semantic-cluster/cluster-all";
import {
  centroidsOf,
  cosineSimilarity,
  kmeansCosine,
  kmeansCosineAsync,
} from "../src/modules/semantic-graph/cluster";

const TOPICS: Record<string, number[]> = {
  hvac: [1, 0, 0, 0],
  budget: [0, 1, 0, 0],
  design: [0, 0, 1, 0],
};

/** `count` notes about one topic, each nudged a little so none is identical. */
function topic(name: string, count: number, text = ""): ClusterNote[] {
  return Array.from({ length: count }, (_, i) => {
    const vec = [...TOPICS[name]];
    vec[3] = (i + 1) * 0.02;
    return { path: `${name}/note-${i}.md`, vec, text };
  });
}

const vault = (): ClusterNote[] => [
  ...topic("hvac", 5, "hvac compressor chiller"),
  ...topic("budget", 5, "budget invoice tax"),
  ...topic("design", 5, "design layout colour"),
];

describe("autoClusterCount", () => {
  it("grows with the square root of the vault", () => {
    expect(autoClusterCount(519)).toBe(16);
  });

  it("never goes below four groups for a vault big enough to split", () => {
    expect(autoClusterCount(10)).toBe(4);
  });

  it("never goes above forty", () => {
    expect(autoClusterCount(1_000_000)).toBe(40);
  });

  it("never asks for more groups than there are notes", () => {
    expect(autoClusterCount(3)).toBe(3);
    expect(autoClusterCount(1)).toBe(1);
  });

  it("is zero for nothing, and for rubbish", () => {
    expect(autoClusterCount(0)).toBe(0);
    expect(autoClusterCount(Number.NaN)).toBe(0);
    expect(autoClusterCount(-5)).toBe(0);
  });
});

describe("tokenize", () => {
  it("drops short words, numbers and stopwords", () => {
    expect(tokenize("The HVAC 2024 compressor of AC")).toEqual(["hvac", "compressor"]);
  });

  it("keeps non-English words that are not stopwords", () => {
    expect(tokenize("kompresor pendingin yang dan")).toEqual(["kompresor", "pendingin"]);
  });

  it("copes with empty text", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("kmeansCosine, async and centroids", () => {
  const vectors = vault().map((n) => n.vec);

  it("gives the async version the same answer as the plain one", async () => {
    const sync = kmeansCosine(vectors, 3, 5);
    const viaAsync = await kmeansCosineAsync(vectors, 3, 5, () => Promise.resolve());
    expect(viaAsync).toEqual(sync);
  });

  it("pauses between iterations", async () => {
    let pauses = 0;
    await kmeansCosineAsync(vectors, 3, 5, async () => {
      pauses++;
    });
    expect(pauses).toBeGreaterThan(0);
  });

  it("returns unit-length centroids, and null for a cluster with no members", () => {
    const centres = centroidsOf(vectors, kmeansCosine(vectors, 3, 5), 4);
    for (const centre of centres.slice(0, 3)) {
      const length = Math.sqrt([...centre!].reduce((s, v) => s + v * v, 0));
      expect(length).toBeCloseTo(1, 10);
    }
    expect(centres[3]).toBeNull();
  });

  it("compares vectors of any scale", () => {
    expect(cosineSimilarity([2, 0], [5, 0])).toBeCloseTo(1, 10);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });
});

describe("clusterVault", () => {
  it("separates three obvious topics into three groups", () => {
    const map = clusterVault(vault(), { k: 3, minSize: 1 });
    expect(map.clusters).toHaveLength(3);
    for (const name of Object.keys(TOPICS)) {
      const ids = new Set(
        [...map.of.entries()].filter(([path]) => path.startsWith(`${name}/`)).map(([, id]) => id),
      );
      expect(ids.size).toBe(1);
    }
  });

  it("lists every note exactly once", () => {
    const map = clusterVault(vault(), { k: 3, minSize: 1 });
    const all = map.clusters.flatMap((c) => c.members);
    expect(all).toHaveLength(15);
    expect(new Set(all).size).toBe(15);
    expect(map.of.size).toBe(15);
  });

  it("numbers groups by size, biggest first", () => {
    const notes = [...topic("hvac", 8), ...topic("budget", 4), ...topic("design", 2)];
    const map = clusterVault(notes, { k: 3, minSize: 1 });
    const sizes = map.clusters.map((c) => c.members.length);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(map.clusters.map((c) => c.id)).toEqual([0, 1, 2]);
  });

  it("gives the same answer for the same vault", () => {
    const a = clusterVault(vault(), { k: 3, minSize: 1 });
    const b = clusterVault(vault(), { k: 3, minSize: 1 });
    expect(a.clusters.map((c) => c.members)).toEqual(b.clusters.map((c) => c.members));
  });

  it("gives the same answer whatever order the notes arrive in", () => {
    const a = clusterVault(vault(), { k: 3, minSize: 1 });
    const b = clusterVault([...vault()].reverse(), { k: 3, minSize: 1 });
    expect(a.clusters.map((c) => c.members)).toEqual(b.clusters.map((c) => c.members));
  });

  it("chooses the number of groups itself when not told", () => {
    const map = clusterVault(vault());
    expect(map.clusters.length).toBeGreaterThan(0);
    expect(map.clusters.length).toBeLessThanOrEqual(autoClusterCount(15));
  });

  it("counts notes with no usable vector instead of grouping them", () => {
    const notes = [
      ...vault(),
      { path: "empty.md", vec: [] },
      { path: "zero.md", vec: [0, 0, 0, 0] },
    ];
    const map = clusterVault(notes, { k: 3, minSize: 1 });
    expect(map.unusable).toBe(2);
    expect(map.of.has("empty.md")).toBe(false);
    expect(map.of.has("zero.md")).toBe(false);
  });

  it("makes one group of a single note", () => {
    const map = clusterVault(topic("hvac", 1));
    expect(map.clusters).toHaveLength(1);
    expect(map.clusters[0].members).toHaveLength(1);
  });

  it("makes nothing from an empty vault", () => {
    const map = clusterVault([]);
    expect(map.clusters).toEqual([]);
    expect(map.links).toEqual([]);
    expect(map.of.size).toBe(0);
  });

  it("matches the async version", async () => {
    const sync = clusterVault(vault(), { k: 3, minSize: 1 });
    const viaAsync = await clusterVaultAsync(vault(), { k: 3, minSize: 1 });
    expect(viaAsync.clusters.map((c) => c.members)).toEqual(sync.clusters.map((c) => c.members));
  });
});

describe("naming", () => {
  it("names a group after the note nearest its centre", () => {
    const notes: ClusterNote[] = [
      { path: "work/central.md", vec: [1, 0, 0] },
      { path: "work/left.md", vec: [1, 0.3, 0] },
      { path: "work/right.md", vec: [1, -0.3, 0] },
      { path: "other/a.md", vec: [0, 0, 1] },
      { path: "other/b.md", vec: [0, 0.1, 1] },
      { path: "other/c.md", vec: [0, -0.1, 1] },
    ];
    const map = clusterVault(notes, { k: 2, minSize: 1 });
    const work = map.clusters.find((c) => c.members.includes("work/central.md"))!;
    expect(work.name).toBe("central");
    expect(work.members[0]).toBe("work/central.md");
  });

  describe("when the nearest note is generic", () => {
    const group = (readmePath: string, otherText: string): ClusterNote[] => [
      { path: readmePath, vec: [1, 0, 0], text: "README" },
      { path: "billing/Invoice bulanan.md", vec: [1, 0.3, 0], text: "Invoice bulanan\n\ninvoice pelanggan invoice" },
      { path: "billing/Pajak invoice.md", vec: [1, -0.3, 0], text: "Pajak invoice\n\ninvoice pajak invoice" },
      { path: "other/a.md", vec: [0, 0, 1], text: otherText },
      { path: "other/b.md", vec: [0, 0.1, 1], text: otherText },
      { path: "other/c.md", vec: [0, -0.1, 1], text: otherText },
    ];

    it("prefers a candidate whose title carries the group's keywords over README", () => {
      const map = clusterVault(group("billing/README.md", "design layout design layout"), { k: 2, minSize: 1 });
      const billing = map.clusters.find((c) => c.members.includes("billing/README.md"))!;
      expect(billing.members[0]).toBe("billing/README.md");
      expect(billing.name).not.toBe("README");
      expect(billing.name).toMatch(/invoice/i);
      expect(billing.namePath).toBe("billing/Pajak invoice.md");
    });

    it("falls back to the folder name when no title says anything", () => {
      const notes: ClusterNote[] = [
        { path: "billing/README.md", vec: [1, 0, 0] },
        { path: "billing/index.md", vec: [1, 0.3, 0] },
        { path: "billing/2024-01-05.md", vec: [1, -0.3, 0] },
        { path: "other/a.md", vec: [0, 0, 1] },
        { path: "other/b.md", vec: [0, 0.1, 1] },
        { path: "other/c.md", vec: [0, -0.1, 1] },
      ];
      const map = clusterVault(notes, { k: 2, minSize: 1 });
      const billing = map.clusters.find((c) => c.members.includes("billing/README.md"))!;
      expect(billing.name).toBe("billing");
      expect(billing.namePath).toBeNull();
    });

    it("keeps the generic title when it sits at the vault root", () => {
      const notes: ClusterNote[] = [
        { path: "README.md", vec: [1, 0, 0] },
        { path: "a.md", vec: [1, 0.3, 0] },
        { path: "b.md", vec: [1, -0.3, 0] },
        { path: "other/a.md", vec: [0, 0, 1] },
        { path: "other/b.md", vec: [0, 0.1, 1] },
        { path: "other/c.md", vec: [0, -0.1, 1] },
      ];
      const map = clusterVault(notes, { k: 2, minSize: 1 });
      expect(map.clusters.find((c) => c.members.includes("README.md"))!.name).toBe("README");
    });
  });

  it("gives each group up to five keywords", () => {
    const text = "alpha beta gamma delta epsilon zeta alpha beta gamma delta epsilon zeta";
    const notes = [...topic("hvac", 5, text), ...topic("budget", 5, "invoice tax")];
    const map = clusterVault(notes, { k: 2, minSize: 1 });
    const group = map.clusters.find((c) => c.members.some((m) => m.startsWith("hvac/")))!;
    expect(group.subtitle.split(" · ")).toHaveLength(5);
  });

  it("sums up a group by the words only it uses", () => {
    const map = clusterVault(vault(), { k: 3, minSize: 1 });
    const hvac = map.clusters.find((c) => c.members.some((m) => m.startsWith("hvac/")))!;
    expect(hvac.subtitle).toContain("hvac");
    expect(hvac.subtitle).not.toContain("budget");
  });

  it("leaves the subtitle empty when there is no text to learn from", () => {
    const notes = [...topic("hvac", 3), ...topic("budget", 3)];
    const map = clusterVault(notes, { k: 2, minSize: 1 });
    for (const cluster of map.clusters) expect(cluster.subtitle).toBe("");
  });
});

describe("stopwords", () => {
  /** Four groups on separate axes; every one repeats "shared" next to its own word. */
  const spread = (): ClusterNote[] =>
    ["alphaword", "betaword", "gammaword", "deltaword"].flatMap((own, g) =>
      Array.from({ length: 4 }, (_, i) => {
        const vec = [0, 0, 0, 0, 0.01 * (i + 1)];
        vec[g] = 1;
        return {
          path: `${own}/n${i}.md`,
          vec,
          text: `${own} ${own} shared shared`,
        };
      }),
    );

  it("drops a word that most groups repeat, and lists it", () => {
    const map = clusterVault(spread(), { k: 4, minSize: 1 });
    expect(map.autoStopwords).toContain("shared");
    for (const cluster of map.clusters) {
      expect(cluster.subtitle).not.toContain("shared");
      expect(cluster.subtitle).toMatch(/word/);
    }
  });

  it("does not guess with fewer than four groups", () => {
    const map = clusterVault(vault(), { k: 3, minSize: 1 });
    expect(map.autoStopwords).toEqual([]);
  });

  it("ignores the words the user adds", () => {
    const map = clusterVault(spread(), { k: 4, minSize: 1, stopwords: ["ALPHAWORD"] });
    for (const cluster of map.clusters) expect(cluster.subtitle).not.toContain("alphaword");
  });

  it("parses a mixed list into lowercase unique words", () => {
    expect(parseStopwords("Aku, should\nbanyak;  aku")).toEqual(["aku", "should", "banyak"]);
    expect(parseStopwords(undefined)).toEqual([]);
  });

  it("skips the common filler words in either language", () => {
    expect(tokenize("aku should banyak invoice")).toEqual(["invoice"]);
  });
});

describe("merging small groups", () => {
  const notes = [...topic("hvac", 5), { path: "budget/lonely.md", vec: [0.1, 1, 0, 0.02] }];

  it("folds a group below the minimum into its nearest neighbour", () => {
    const hvacIds = [0, 0, 0, 0, 0];
    const map = buildClusterMap(notes, [...hvacIds, 1], { minSize: 2 });
    expect(map.clusters).toHaveLength(1);
    expect(map.clusters[0].members).toHaveLength(6);
  });

  it("keeps a group that meets the minimum", () => {
    const map = buildClusterMap(notes, [0, 0, 0, 0, 0, 1], { minSize: 1 });
    expect(map.clusters).toHaveLength(2);
  });

  it("never merges down to nothing", () => {
    const map = buildClusterMap(notes, [0, 0, 0, 1, 1, 1], { minSize: 100 });
    expect(map.clusters).toHaveLength(1);
    expect(map.of.size).toBe(6);
  });
});

describe("links between groups", () => {
  it("links each pair at most once, with the lower id first", () => {
    const map = clusterVault(vault(), { k: 3, minSize: 1, linksPerCluster: 2 });
    const keys = map.links.map((l) => `${l.a}-${l.b}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(map.links.every((l) => l.a < l.b)).toBe(true);
  });

  it("never links a group to itself", () => {
    const map = clusterVault(vault(), { k: 3, minSize: 1 });
    expect(map.links.every((l) => l.a !== l.b)).toBe(true);
  });

  it("keeps strengths between 0 and 1", () => {
    const map = clusterVault(vault(), { k: 3, minSize: 1 });
    for (const link of map.links) {
      expect(link.strength).toBeGreaterThanOrEqual(0);
      expect(link.strength).toBeLessThanOrEqual(1);
    }
  });

  it("makes no links when asked for none", () => {
    expect(clusterVault(vault(), { k: 3, minSize: 1, linksPerCluster: 0 }).links).toEqual([]);
  });

  it("makes no links with only one group", () => {
    expect(clusterVault(topic("hvac", 5), { k: 1 }).links).toEqual([]);
  });
});
