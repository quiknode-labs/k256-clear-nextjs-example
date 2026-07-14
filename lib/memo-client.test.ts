import { describe, expect, it } from "vitest";

import { actionFromHash, actionHash } from "./memo-client";

describe("memo action recovery", () => {
  it("round-trips the exact action needed for a re-sign after reload", () => {
    const action = { cluster: "devnet", gate: "finalized", memo: "same action + symbols" } as const;
    expect(actionFromHash(actionHash(action))).toEqual(action);
  });

  it("rejects malformed or unsupported action context", () => {
    expect(actionFromHash("#action=not-json")).toBeNull();
    expect(actionFromHash(`#action=${encodeURIComponent(JSON.stringify({
      cluster: "localnet", gate: "finalized", memo: "memo",
    }))}`)).toBeNull();
  });
});
