import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as readEvents } from "@/app/api/intents/[id]/events/route";
import { GET as readIntent, POST as cancelIntent } from "./intents/[id]/route";
import { POST as sendIntent } from "./intents/route";
import { GET as readiness } from "./ready/route";
import { GET as readBlockhash } from "./rpc/route";

const API_KEY = `k256_live_${"A".repeat(32)}`;

describe.sequential("Clear API routes", () => {
  beforeEach(() => {
    process.env.K256_CLEAR_API_KEY = API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.K256_CLEAR_API_KEY;
  });

  it("projects an intent to the fields the browser actually uses", async () => {
    const upstream = {
      intent_id: "lc_example",
      version: 4,
      status: "confirmed",
      cluster: "devnet",
      commitment_target: "finalized",
      signature: "signature",
      explorer_url: "https://explorer.solana.com/tx/signature",
      events: [{ at: 10, status: "confirmed" }],
      error: null,
      origin_geo: { ip: "203.0.113.1" },
      idempotency_key: "private-key",
      delivery: [{ target: "private-validator" }],
    };
    const fetchMock = vi.fn(async (_url: string | URL | Request) => Response.json(upstream));
    vi.stubGlobal("fetch", fetchMock);

    const response = await readIntent(
      new Request("http://localhost/api/intents/lc_example"),
      { params: Promise.resolve({ id: "lc_example" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      intent_id: "lc_example",
      version: 4,
      status: "confirmed",
      cluster: "devnet",
      commitment_target: "finalized",
      signature: "signature",
      explorer_url: "https://explorer.solana.com/tx/signature",
      events: [{ at: 10, status: "confirmed" }],
      error: null,
    });
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain("timeout=");
  });

  it("accepts early snapshots without a signature and forward-compatible statuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      intent_id: "lc_example", version: 1, status: "future_holding_state", cluster: "devnet",
      commitment_target: "finalized", explorer_url: null, events: [], error: null,
    })));
    const response = await readIntent(
      new Request("http://localhost/api/intents/lc_example"),
      { params: Promise.resolve({ id: "lc_example" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "future_holding_state", signature: null });
  });

  it("keeps the exact public chain failure without forwarding the full snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      intent_id: "lc_failed", version: 3, status: "failed", cluster: "mainnet",
      commitment_target: "confirmed", signature: "signature", explorer_url: null,
      events: [{ at: 3, status: "failed" }],
      error: { code: "on_chain_error", err: { InstructionError: [0, "Custom"] } },
      origin_geo: { ip: "203.0.113.1" },
    })));

    const response = await readIntent(
      new Request("http://localhost/api/intents/lc_failed"),
      { params: Promise.resolve({ id: "lc_failed" }) },
    );
    const body = await response.json();

    expect(body.error).toEqual({
      code: "on_chain_error",
      message: 'on chain error: {"InstructionError":[0,"Custom"]}',
    });
    expect(body.origin_geo).toBeUndefined();
  });

  it("proxies the events long-poll with the seq cursor", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request) => Response.json({
      events: [{ seq: 7, event: "intent.confirmed", payload: { id: "lc_example" } }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await readEvents(
      new Request("http://localhost/api/intents/lc_example/events?cursor=6"),
      { params: Promise.resolve({ id: "lc_example" }) },
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/clear/events?id=lc_example&cursor=6");
    const body = await response.json() as { events: Array<{ seq: number }> };
    expect(body.events[0]?.seq).toBe(7);
  });

  it("never forwards the retired ?wait long-poll params on the snapshot read", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request) => Response.json({
      intent_id: "lc_example", version: 1, status: "submitted", cluster: "mainnet",
      commitment_target: "confirmed", signature: "signature", explorer_url: null,
      events: [], error: null,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await readIntent(
      new Request("http://localhost/api/intents/lc_example?wait=true&cursor=1"),
      { params: Promise.resolve({ id: "lc_example" }) },
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("wait");
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("cursor");
  });

  it("preserves an immediate status 404 for the watcher retry policy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      error: { code: "not_found", message: "Intent is not visible yet" },
    }, { status: 404 })));
    const response = await readIntent(
      new Request("http://localhost/api/intents/lc_example"),
      { params: Promise.resolve({ id: "lc_example" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "not_found", message: "Intent is not visible yet" },
    });
  });

  it("preserves a send rejection status while removing undeclared details", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      error: { code: "rate_limited", message: "Try again shortly", internal: "hidden" },
    }, { status: 429 })));
    const response = await sendIntent(new Request("http://localhost/api/intents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cluster: "devnet",
        signed_tx_base64: Buffer.from([1]).toString("base64"),
        commitment_target: "finalized",
      }),
    }));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: { code: "rate_limited", message: "Try again shortly" } });
  });

  it("continues a re-sign under the same intent id", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => Response.json({
      intent_id: "lc_example", signature: "signature", status: "submitted", status_url: "https://api.k256.xyz/v1/clear/intents/lc_example",
    }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await sendIntent(new Request("http://localhost/api/intents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cluster: "devnet",
        signed_tx_base64: Buffer.from([1]).toString("base64"),
        commitment_target: "finalized",
        intent_id: "lc_example",
      }),
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ intent_id: "lc_example" });
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({ intent_id: "lc_example" });
  });

  it("rejects oversized signed transactions before calling Clear", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await sendIntent(new Request("http://localhost/api/intents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cluster: "devnet",
        signed_tx_base64: Buffer.alloc(1233).toString("base64"),
        commitment_target: "finalized",
      }),
    }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates the API key before making an RPC call", async () => {
    process.env.K256_CLEAR_API_KEY = "k256_live_replace_me";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await readBlockhash(new Request("http://localhost/api/rpc?cluster=devnet"));

    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      error: "K256_CLEAR_API_KEY must be k256_live_ followed by 32 letters or digits",
    });
  });

  it("returns a valid blockhash and turns a JSON-RPC error into a gateway failure", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        jsonrpc: "2.0", id: 1,
        result: { value: { blockhash: "blockhash", lastValidBlockHeight: 123 } },
      }))
      .mockResolvedValueOnce(Response.json({
        jsonrpc: "2.0", id: 1, error: { code: -32000, message: "RPC unavailable" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const success = await readBlockhash(new Request("http://localhost/api/rpc?cluster=devnet"));
    expect(success.status).toBe(200);
    expect(await success.json()).toEqual({ blockhash: "blockhash", lastValidBlockHeight: 123 });
    const failure = await readBlockhash(new Request("http://localhost/api/rpc?cluster=devnet"));
    expect(failure.status).toBe(502);
    expect(await failure.json()).toEqual({ error: "RPC unavailable" });
  });

  it("reports server readiness without spending an upstream request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await readiness()).status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies cancel and returns only its public outcome", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      intent_id: "lc_example", outcome: "stopped_further_attempts", internal: "hidden",
    })));
    const response = await cancelIntent(
      new Request("http://localhost/api/intents/lc_example", { method: "POST" }),
      { params: Promise.resolve({ id: "lc_example" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      intent_id: "lc_example", outcome: "stopped_further_attempts",
    });
  });
});
