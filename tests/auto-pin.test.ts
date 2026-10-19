import { describe, it, expect } from "vitest";
import { isExplicitNewLeaf, shouldReuseExisting, LeafRequest } from "../src/modules/auto-pin/logic";

describe("isExplicitNewLeaf", () => {
  it("treats new tab, split and window requests as explicit", () => {
    for (const arg of [true, "tab", "split", "window"]) expect(isExplicitNewLeaf(arg)).toBe(true);
  });

  it("treats a plain open as not explicit", () => {
    for (const arg of [false, undefined, null, "", 0]) expect(isExplicitNewLeaf(arg)).toBe(false);
  });
});

describe("shouldReuseExisting", () => {
  const leaf = { id: "A" };
  const other = { id: "B" };
  const req = (over: Partial<LeafRequest<object>> = {}): LeafRequest<object> => ({
    leaf,
    explicit: false,
    time: 1000,
    ...over,
  });

  it("reuses for a plain open of the same tab, right after the request", () => {
    expect(shouldReuseExisting(req(), leaf, 1500)).toBe(true);
  });

  it("keeps the copy for an explicit new tab, split or window", () => {
    expect(shouldReuseExisting(req({ explicit: true }), leaf, 1500)).toBe(false);
  });

  it("ignores tabs that were merely switched to (no matching request)", () => {
    expect(shouldReuseExisting(null, leaf, 1500)).toBe(false);
    expect(shouldReuseExisting(req(), other, 1500)).toBe(false);
  });

  it("ignores a request that is too old", () => {
    expect(shouldReuseExisting(req(), leaf, 1000 + 3001)).toBe(false);
    expect(shouldReuseExisting(req(), leaf, 1000 + 3000)).toBe(true);
  });
});
