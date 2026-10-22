import { describe, expect, it } from "vitest";
import {
  MIN_DRILL_SIZE,
  buildLevel,
  canDrill,
  formatCrumbs,
  levelCrumbs,
  notesOf,
  scopeKey,
  truncateTo,
} from "../src/modules/semantic-cluster/drill";
import { autoClusterCount, type ClusterMap, type ClusterNote } from "../src/modules/semantic-cluster/cluster-all";

const TOPICS = [
  [1, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 1, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 1, 0, 0, 0, 0, 0, 0],
];

/**
 * `count` notes around one topic. Each topic has two sub-topics of its own,
 * on dimensions no other topic uses, so a split inside it is a real one.
 */
function topic(t: number, count: number): ClusterNote[] {
  return Array.from({ length: count }, (_, i) => {
    const vec = [...TOPICS[t]];
    vec[3 + 2 * t + (i % 2)] = 0.8 + i * 0.001;
    return { path: `t${t}/n${i}.md`, vec };
  });
}

const vault = (): ClusterNote[] => [...topic(0, 12), ...topic(1, 12), ...topic(2, 12)];

describe("canDrill", () => {
  it("allows a group at or above the minimum", () => {
    expect(canDrill(MIN_DRILL_SIZE)).toBe(true);
    expect(canDrill(MIN_DRILL_SIZE + 20)).toBe(true);
  });

  it("refuses a group below it", () => {
    expect(canDrill(MIN_DRILL_SIZE - 1)).toBe(false);
    expect(canDrill(0)).toBe(false);
  });

  it("takes a different minimum when given one", () => {
    expect(canDrill(4, 4)).toBe(true);
    expect(canDrill(3, 4)).toBe(false);
  });
});

describe("scopeKey", () => {
  const notes = vault();

  it("ignores the order of the notes", () => {
    expect(scopeKey(notes, 3, 1)).toBe(scopeKey([...notes].reverse(), 3, 1));
  });

  it("differs when the request, the minimum or the notes differ", () => {
    const base = scopeKey(notes, 3, 1);
    expect(scopeKey(notes, 4, 1)).not.toBe(base);
    expect(scopeKey(notes, 3, 2)).not.toBe(base);
    expect(scopeKey(notes.slice(1), 3, 1)).not.toBe(base);
  });
});

describe("buildLevel", () => {
  it("splits the notes into the number of groups asked for", async () => {
    const level = await buildLevel("All notes", vault(), 3, { minSize: 1 });
    expect(level.map.clusters).toHaveLength(3);
    expect(level.requested).toBe(3);
    expect(level.name).toBe("All notes");
  });

  it("treats a request for one group as 'do not split'", async () => {
    const level = await buildLevel("All notes", vault(), 1, { minSize: 1 });
    expect(level.map.clusters).toHaveLength(1);
    expect(level.map.clusters[0].members).toHaveLength(36);
  });

  it("chooses a number itself for 0, and records that nothing was requested", async () => {
    const level = await buildLevel("All notes", vault(), 0, { minSize: 1 });
    expect(level.requested).toBe(0);
    expect(level.map.clusters.length).toBeLessThanOrEqual(autoClusterCount(36));
  });

  it("treats rubbish requests as automatic", async () => {
    for (const bad of [Number.NaN, -3, Number.POSITIVE_INFINITY]) {
      const level = await buildLevel("x", vault(), bad, { minSize: 1 });
      expect(level.requested).toBe(0);
      expect(level.map.clusters.length).toBeGreaterThan(0);
    }
  });

  it("never makes more groups than there are notes", async () => {
    const level = await buildLevel("x", topic(0, 5), 10, { minSize: 1 });
    expect(level.map.clusters.length).toBeLessThanOrEqual(5);
  });

  it("returns the cached map without reclustering", async () => {
    const cache = new Map<string, ClusterMap>();
    const first = await buildLevel("All notes", vault(), 3, { minSize: 1 }, cache);
    const second = await buildLevel("All notes", vault(), 3, { minSize: 1 }, cache);
    expect(second.map).toBe(first.map);
    expect(cache.size).toBe(1);
  });

  it("caches a different request separately", async () => {
    const cache = new Map<string, ClusterMap>();
    await buildLevel("All notes", vault(), 3, { minSize: 1 }, cache);
    await buildLevel("All notes", vault(), 2, { minSize: 1 }, cache);
    expect(cache.size).toBe(2);
  });
});

describe("going inside a group", () => {
  it("covers only that group's notes, each exactly once", async () => {
    const top = await buildLevel("All notes", vault(), 3, { minSize: 1 });
    const group = top.map.clusters[0];
    const inside = await buildLevel(group.name, notesOf(top, group.id), 2, { minSize: 1 });

    const all = inside.map.clusters.flatMap((c) => c.members);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...group.members].sort());
  });

  it("can be split again, and again", async () => {
    const top = await buildLevel("All notes", vault(), 3, { minSize: 1 });
    const second = await buildLevel("A", notesOf(top, 0), 2, { minSize: 1 });
    const third = await buildLevel("A.A", notesOf(second, 0), 1, { minSize: 1 });
    expect(third.map.clusters).toHaveLength(1);
    expect(third.notes.length).toBe(second.map.clusters[0].members.length);
  });

  it("names the groups from the notes inside, not from the whole vault", async () => {
    const top = await buildLevel("All notes", vault(), 3, { minSize: 1 });
    const inside = await buildLevel("A", notesOf(top, 0), 2, { minSize: 1 });
    const parentMembers = new Set(top.map.clusters[0].members);
    for (const group of inside.map.clusters) {
      expect(parentMembers.has(group.members[0])).toBe(true);
    }
  });

  it("gives the same split twice", async () => {
    const top = await buildLevel("All notes", vault(), 3, { minSize: 1 });
    const a = await buildLevel("A", notesOf(top, 0), 2, { minSize: 1 });
    const b = await buildLevel("A", notesOf(top, 0), 2, { minSize: 1 });
    expect(a.map.clusters.map((c) => c.members)).toEqual(b.map.clusters.map((c) => c.members));
  });
});

describe("notesOf", () => {
  it("returns nothing for a group that does not exist", async () => {
    const top = await buildLevel("All notes", vault(), 3, { minSize: 1 });
    expect(notesOf(top, 99)).toEqual([]);
  });

  it("returns notes with their vectors, so they can be clustered again", async () => {
    const top = await buildLevel("All notes", vault(), 3, { minSize: 1 });
    for (const note of notesOf(top, 0)) expect(note.vec.length).toBeGreaterThan(0);
  });
});

describe("truncateTo", () => {
  it("keeps the levels down to and including the one asked for", async () => {
    const top = await buildLevel("All notes", vault(), 3, { minSize: 1 });
    const second = await buildLevel("A", notesOf(top, 0), 2, { minSize: 1 });
    const third = await buildLevel("A.A", notesOf(second, 0), 2, { minSize: 1 });
    expect(truncateTo([top, second, third], 1)).toEqual([top, second]);
    expect(truncateTo([top, second, third], 0)).toEqual([top]);
  });

  it("never empties the stack", async () => {
    const top = await buildLevel("All notes", vault(), 3, { minSize: 1 });
    expect(truncateTo([top], -1)).toEqual([top]);
  });

  it("leaves the stack alone when the index is past the end", async () => {
    const top = await buildLevel("All notes", vault(), 3, { minSize: 1 });
    expect(truncateTo([top], 5)).toEqual([top]);
  });
});

describe("breadcrumbs", () => {
  it("shows the top level with its number of clusters", async () => {
    const top = await buildLevel("All notes", vault(), 3, { minSize: 1 });
    expect(formatCrumbs([top])).toBe("All notes (3 clusters)");
  });

  it("adds each group that was entered, with its own count", async () => {
    const top = await buildLevel("All notes", vault(), 3, { minSize: 1 });
    const second = await buildLevel("hvac", notesOf(top, 0), 2, { minSize: 1 });
    expect(formatCrumbs([top, second])).toBe("All notes (3 clusters) › hvac (2 clusters)");
  });

  it("says 'cluster' for exactly one, and ends in notes", async () => {
    const top = await buildLevel("All notes", vault(), 3, { minSize: 1 });
    const second = await buildLevel("hvac", notesOf(top, 0), 1, { minSize: 1 });
    expect(formatCrumbs([top, second])).toBe("All notes (3 clusters) › hvac (1 cluster) › notes");
  });

  it("does not end in notes while the level is still split", async () => {
    const top = await buildLevel("All notes", vault(), 3, { minSize: 1 });
    expect(levelCrumbs([top]).some((c) => c.label === "notes")).toBe(false);
  });

  it("makes every crumb but the last a way back", async () => {
    const top = await buildLevel("All notes", vault(), 3, { minSize: 1 });
    const second = await buildLevel("A", notesOf(top, 0), 2, { minSize: 1 });
    const crumbs = levelCrumbs([top, second]);
    expect(crumbs[0].level).toBe(0);
    expect(crumbs[1].level).toBeNull();
  });

  it("makes the notes crumb a non-link", async () => {
    const top = await buildLevel("All notes", vault(), 1, { minSize: 1 });
    const crumbs = levelCrumbs([top]);
    expect(crumbs[crumbs.length - 1]).toEqual({ label: "notes", level: null });
  });

  it("is empty for no levels", () => {
    expect(levelCrumbs([])).toEqual([]);
    expect(formatCrumbs([])).toBe("");
  });
});
