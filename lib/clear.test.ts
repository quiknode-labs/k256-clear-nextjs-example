import { describe, expect, it } from "vitest";

import { reachedGate, watcherDone } from "./clear";

describe("Clear watcher", () => {
  it("treats a later commitment as satisfying an earlier gate", () => {
    expect(reachedGate("finalized", "confirmed")).toBe(true);
    expect(reachedGate("processed", "confirmed")).toBe(false);
  });

  it("keeps watching confirmed until finalization", () => {
    expect(watcherDone("confirmed")).toBe(false);
    expect(watcherDone("finalized")).toBe(true);
  });

  it.each(["needs_resign", "invalid", "failed", "canceled"] as const)("stops at %s", (status) => {
    expect(watcherDone(status)).toBe(true);
  });
});
