import { NextResponse } from "next/server";

import { CLUSTERS, clearSendOrigin, type Cluster } from "@/lib/clear";
import { clearApiKey, clearJson } from "@/lib/server";

export async function GET(request: Request) {
  const cluster = new URL(request.url).searchParams.get("cluster") as Cluster | null;
  if (!cluster || !CLUSTERS.includes(cluster)) {
    return NextResponse.json({ error: "cluster must be mainnet, devnet, or testnet" }, { status: 400 });
  }
  try {
    const response = await fetch(clearSendOrigin(cluster), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clearApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getLatestBlockhash",
        params: [{ commitment: "confirmed" }],
      }),
      cache: "no-store",
    });
    const body = await clearJson(response) as {
      result?: { value?: { blockhash?: string; lastValidBlockHeight?: number } };
      error?: { message?: string };
    };
    if (body.error?.message) throw new Error(body.error.message);
    const value = body.result?.value;
    if (!value?.blockhash || typeof value.lastValidBlockHeight !== "number") {
      throw new Error("RPC response did not contain a blockhash");
    }
    return NextResponse.json(value);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "RPC request failed" }, { status: 502 });
  }
}
