import { describe, expect, it } from "vitest";
import {
  combineScores,
  exactScore,
  fuzzyScore,
  normalizeWeights,
  rebalanceWeights,
  type ScorerToggles,
  type ScorerWeights,
} from "../src/modules/semantic-search/scoring";

const ALL_ON: ScorerToggles = { vector: true, exact: true, fuzzy: true };
const EVEN: ScorerWeights = { vector: 0.5, exact: 0.3, fuzzy: 0.2 };

describe("exactScore", () => {
  it("scores a whole-phrase hit as 1", () => {
    expect(exactScore("kontrak HVAC", "Ini kontrak HVAC tahun 2026")).toBe(1);
  });

  it("ignores capitals", () => {
    expect(exactScore("KONTRAK", "ini kontrak")).toBe(1);
  });

  it("scores partial word hits as a fraction", () => {
    expect(exactScore("kontrak invoice", "hanya kontrak di sini")).toBeCloseTo(0.5, 10);
  });

  it("scores a complete miss as 0", () => {
    expect(exactScore("zebra", "kontrak HVAC")).toBe(0);
  });

  it("handles empty input", () => {
    expect(exactScore("", "teks")).toBe(0);
    expect(exactScore("teks", "")).toBe(0);
  });
});

describe("fuzzyScore", () => {
  it("scores an exact word as 1", () => {
    expect(fuzzyScore("kontrak", "ini kontrak hvac")).toBe(1);
  });

  it("tolerates a missing letter", () => {
    expect(fuzzyScore("kontak", "ini kontrak")).toBeGreaterThan(0.5);
  });

  it("scores unrelated words low", () => {
    expect(fuzzyScore("zebra", "kontrak hvac")).toBeLessThan(0.5);
  });

  it("handles empty input", () => {
    expect(fuzzyScore("", "teks")).toBe(0);
    expect(fuzzyScore("teks", "")).toBe(0);
  });
});

describe("normalizeWeights", () => {
  it("sums to 1 when everything is enabled", () => {
    const w = normalizeWeights(EVEN, ALL_ON);
    expect(w.vector + w.exact + w.fuzzy).toBeCloseTo(1, 10);
  });

  it("redistributes a disabled scorer's weight", () => {
    const w = normalizeWeights(EVEN, { vector: true, exact: true, fuzzy: false });
    expect(w.fuzzy).toBe(0);
    expect(w.vector + w.exact).toBeCloseTo(1, 10);
    // 0.5 : 0.3 keeps its ratio after renormalizing.
    expect(w.vector / w.exact).toBeCloseTo(0.5 / 0.3, 8);
  });

  it("returns zeros when nothing is enabled", () => {
    const w = normalizeWeights(EVEN, { vector: false, exact: false, fuzzy: false });
    expect(w).toEqual({ vector: 0, exact: 0, fuzzy: 0 });
  });

  it("falls back to an even split when all weights are zero", () => {
    const w = normalizeWeights({ vector: 0, exact: 0, fuzzy: 0 }, ALL_ON);
    expect(w.vector).toBeCloseTo(1 / 3, 10);
  });
});

describe("rebalanceWeights", () => {
  it("keeps the total at 1 after a slider moves", () => {
    const w = rebalanceWeights(EVEN, "vector", 0.8);
    expect(w.vector).toBe(0.8);
    expect(w.vector + w.exact + w.fuzzy).toBeCloseTo(1, 10);
  });

  it("keeps the other two in proportion", () => {
    const w = rebalanceWeights(EVEN, "vector", 0.5);
    // exact:fuzzy was 0.3:0.2, so it stays 3:2.
    expect(w.exact / w.fuzzy).toBeCloseTo(1.5, 8);
  });

  it("clamps above 1 and below 0", () => {
    expect(rebalanceWeights(EVEN, "vector", 5).vector).toBe(1);
    expect(rebalanceWeights(EVEN, "vector", -5).vector).toBe(0);
  });

  it("splits the remainder evenly when the others are zero", () => {
    const w = rebalanceWeights({ vector: 1, exact: 0, fuzzy: 0 }, "vector", 0.5);
    expect(w.exact).toBeCloseTo(0.25, 10);
    expect(w.fuzzy).toBeCloseTo(0.25, 10);
  });
});

describe("combineScores", () => {
  it("weights each part and totals them", () => {
    const result = combineScores({ vector: 1, exact: 1, fuzzy: 1 }, EVEN, ALL_ON);
    expect(result.total).toBeCloseTo(1, 10);
  });

  it("excludes a disabled scorer from the total", () => {
    const result = combineScores(
      { vector: 1, exact: 0, fuzzy: 0 },
      EVEN,
      { vector: true, exact: false, fuzzy: false },
    );
    expect(result.total).toBeCloseTo(1, 10);
    expect(result.parts.find((p) => p.key === "exact")?.weight).toBe(0);
  });

  it("treats a null score as not applicable, not as zero", () => {
    // Vector alone should score 1, not 0.5, when there is no exact query.
    const result = combineScores({ vector: 1, exact: null, fuzzy: null }, EVEN, ALL_ON);
    expect(result.total).toBeCloseTo(1, 10);
  });

  it("reports the contribution of each part", () => {
    const result = combineScores({ vector: 0.6, exact: 1, fuzzy: null }, EVEN, ALL_ON);
    const vector = result.parts.find((p) => p.key === "vector");
    expect(vector?.contribution).toBeCloseTo((vector?.score ?? 0) * (vector?.weight ?? 0), 10);
  });

  it("totals zero when nothing applies", () => {
    const result = combineScores({ vector: null, exact: null, fuzzy: null }, EVEN, ALL_ON);
    expect(result.total).toBe(0);
    expect(result.parts.every((p) => p.score === null)).toBe(true);
  });

  it("never exceeds 1 for in-range scores", () => {
    const result = combineScores({ vector: 1, exact: 1, fuzzy: 1 }, { vector: 5, exact: 5, fuzzy: 5 }, ALL_ON);
    expect(result.total).toBeLessThanOrEqual(1.0000001);
  });
});
