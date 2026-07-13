import { NextResponse } from "next/server";

import { CLUSTERS, clearSendOrigin, type ClearReceipt, type Cluster, type Gate } from "@/lib/clear";
import { clearApiKey, clearJson } from "@/lib/server";

interface SendBody {
  cluster?: Cluster;
  signed_tx_base64?: string;
  blockhash?: string;
  last_valid_block_height?: number;
  commitment_target?: Gate;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as SendBody | null;
  if (!body?.cluster || !CLUSTERS.includes(body.cluster)
    || !body.signed_tx_base64 || body.signed_tx_base64.length > 4096
    || (body.commitment_target !== "confirmed" && body.commitment_target !== "finalized")) {
    return NextResponse.json({ error: "cluster, signed_tx_base64, and commitment_target are required" }, { status: 400 });
  }
  try {
    const response = await fetch(`${clearSendOrigin(body.cluster)}/v1/clear/intents/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clearApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        signed_tx_base64: body.signed_tx_base64,
        blockhash: body.blockhash,
        last_valid_block_height: body.last_valid_block_height,
        commitment_target: body.commitment_target,
        client_reference_id: `next-example-${crypto.randomUUID()}`,
        origin: { label: "Clear Next.js example" },
      }),
      cache: "no-store",
    });
    return NextResponse.json(await clearJson(response) as ClearReceipt, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Send failed" }, { status: 502 });
  }
}
