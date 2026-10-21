import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Debouncer,
  RunGuard,
  normalizeQuery,
  resolveMode,
} from "../src/modules/semantic-search/query-state";

describe("resolveMode", () => {
  it("follows the note when the box is empty", () => {
    expect(resolveMode("")).toBe("follow-note");
  });

  it("treats whitespace as empty", () => {
    expect(resolveMode("   ")).toBe("follow-note");
  });

  it("handles null and undefined", () => {
    expect(resolveMode(null)).toBe("follow-note");
    expect(resolveMode(undefined)).toBe("follow-note");
  });

  it("switches to query mode when the box has text", () => {
    expect(resolveMode("kontrak HVAC")).toBe("query");
  });
});

describe("normalizeQuery", () => {
  it("trims surrounding space", () => {
    expect(normalizeQuery("  halo  ")).toBe("halo");
  });

  it("returns null for an empty or blank box", () => {
    expect(normalizeQuery("")).toBeNull();
    expect(normalizeQuery("   ")).toBeNull();
    expect(normalizeQuery(undefined)).toBeNull();
  });
});

describe("Debouncer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("runs the callback after the delay", () => {
    const debouncer = new Debouncer(() => 400);
    const fn = vi.fn();
    debouncer.schedule(fn);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("only runs the last of several rapid calls", () => {
    const debouncer = new Debouncer(() => 400);
    const first = vi.fn();
    const second = vi.fn();
    const third = vi.fn();
    debouncer.schedule(first);
    vi.advanceTimersByTime(100);
    debouncer.schedule(second);
    vi.advanceTimersByTime(100);
    debouncer.schedule(third);
    vi.advanceTimersByTime(400);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(third).toHaveBeenCalledTimes(1);
  });

  it("honours a changed delay", () => {
    let delay = 1000;
    const debouncer = new Debouncer(() => delay);
    const fn = vi.fn();
    delay = 100;
    debouncer.schedule(fn);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("flush runs immediately and cancels the pending call", () => {
    const debouncer = new Debouncer(() => 400);
    const pending = vi.fn();
    const now = vi.fn();
    debouncer.schedule(pending);
    debouncer.flush(now);
    expect(now).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(pending).not.toHaveBeenCalled();
  });

  it("cancel stops a pending call", () => {
    const debouncer = new Debouncer(() => 400);
    const fn = vi.fn();
    debouncer.schedule(fn);
    debouncer.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("reports whether a call is pending", () => {
    const debouncer = new Debouncer(() => 400);
    expect(debouncer.isPending).toBe(false);
    debouncer.schedule(vi.fn());
    expect(debouncer.isPending).toBe(true);
    vi.advanceTimersByTime(400);
    expect(debouncer.isPending).toBe(false);
  });
});

describe("RunGuard", () => {
  it("treats the newest token as current", () => {
    const guard = new RunGuard();
    const token = guard.begin();
    expect(guard.isCurrent(token)).toBe(true);
  });

  it("invalidates an older token when a newer run starts", () => {
    const guard = new RunGuard();
    const older = guard.begin();
    const newer = guard.begin();
    expect(guard.isCurrent(older)).toBe(false);
    expect(guard.isCurrent(newer)).toBe(true);
  });

  it("invalidate cancels everything in flight", () => {
    const guard = new RunGuard();
    const token = guard.begin();
    guard.invalidate();
    expect(guard.isCurrent(token)).toBe(false);
  });
});
