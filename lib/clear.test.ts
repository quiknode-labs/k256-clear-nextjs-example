import { describe, expect, it } from "vitest";

import { cancelNotice, errorMessage, intentEverBroadcast, intentFailureReason, reachedGate, retryDelayMs, retryableStatus, statusLabel, watcherDone, type ClearIntent } from "./clear";

describe("Clear watcher", () => {
  it("treats a later commitment as satisfying an earlier gate", () => {
    expect(reachedGate("finalized", "confirmed")).toBe(true);
    expect(reachedGate("processed", "confirmed")).toBe(false);
  });

  it("keeps watching confirmed until finalization", () => {
    expect(watcherDone("confirmed")).toBe(false);
    expect(watcherDone("finalized")).toBe(true);
  });

  it.each(["needs_resign", "failed"] as const)("stops at %s", (status) => {
    expect(watcherDone(status)).toBe(true);
  });

  it.each(["invalid", "canceled"] as const)("watches %s for a landing-wins supersede", (status) => {
    expect(watcherDone(status, 10_000, 50_000, true)).toBe(false);
    expect(watcherDone(status, 10_000, 100_001, true)).toBe(true);
    expect(watcherDone(status, 10_000, 50_000, false)).toBe(true);
  });

  it("derives broadcast history from the public snapshot", () => {
    expect(intentEverBroadcast({ signature: null, events: [{ at: 1, status: "canceled" }] })).toBe(false);
    expect(intentEverBroadcast({ signature: "signature", events: [] })).toBe(true);
    expect(intentEverBroadcast({ signature: null, events: [{ at: 1, status: "submitted" }] })).toBe(true);
  });

  it("retries only transient HTTP failures", () => {
    expect(retryableStatus(408, true)).toBe(true);
    expect(retryableStatus(429, true)).toBe(true);
    expect(retryableStatus(503, true)).toBe(true);
    expect(retryableStatus(403, false)).toBe(false);
    expect(retryableStatus(404, false)).toBe(true);
    expect(retryableStatus(404, true)).toBe(false);
  });

  it("backs off with a bounded jittered delay", () => {
    expect(retryDelayMs(1, 0)).toBe(375);
    expect(retryDelayMs(5, 0.5)).toBe(8_000);
    expect(retryDelayMs(20, 1)).toBe(10_000);
  });

  it("renders recoverable state as an action instead of an internal identifier", () => {
    expect(statusLabel("needs_resign")).toBe("Needs signature");
    expect(statusLabel("finalized")).toBe("Finalized");
    expect(statusLabel("future_holding_state")).toBe("Future holding state");
  });

  it("never implies already-sent bytes were revoked", () => {
    expect(cancelNotice("stopped_before_submit")).toEqual({
      tone: "success",
      message: "Clear stopped before these bytes could land.",
    });
    expect(cancelNotice("stopped_further_attempts")).toEqual({
      tone: "warning",
      message: "Clear stopped future attempts. Bytes already sent may still land.",
    });
    expect(cancelNotice(null, false)?.tone).toBe("success");
    expect(cancelNotice(null, true)?.tone).toBe("warning");
    expect(cancelNotice("already_canceled", false)?.tone).toBe("success");
    expect(cancelNotice("dropped_after_cancel_request")?.message).toContain("expired bytes");
    expect(cancelNotice("future_outcome")?.tone).toBe("warning");
  });

  it("extracts nested API errors without hiding the upstream reason", () => {
    expect(errorMessage({ error: { message: "intent not found" } }, "fallback")).toBe("intent not found");
    expect(errorMessage(null, "fallback")).toBe("fallback");
  });

  it("uses lifecycle evidence when a terminal intent has no structured error", () => {
    const intent = {
      status: "failed",
      error: null,
      events: [{ at: 1, status: "failed", reason: "insufficient funds" }],
    } as ClearIntent;
    expect(intentFailureReason(intent)).toBe("insufficient funds");
  });
});
