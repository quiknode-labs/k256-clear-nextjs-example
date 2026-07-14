import { NextResponse } from "next/server";

import { CLUSTERS, clearSendOrigin, type Cluster, type Gate } from "@/lib/clear";
import { clearApiKey, projectReceipt, publicError, responseJson, routeFailureStatus } from "@/lib/server";

export const maxDuration = 15;

interface SendBody {
  cluster?: Cluster;
  signed_tx_base64?: string;
  blockhash?: string;
  last_valid_block_height?: number;
  commitment_target?: Gate;
  intent_id?: string;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as SendBody | null;
  if (!body?.cluster || !CLUSTERS.includes(body.cluster)
    || !body.signed_tx_base64
    || (body.commitment_target !== "confirmed" && body.commitment_target !== "finalized")) {
    return NextResponse.json({ error: "cluster, signed_tx_base64, and commitment_target are required" }, { status: 400 });
  }
  const bytes = /^[A-Za-z0-9+/]+={0,2}$/.test(body.signed_tx_base64)
    && body.signed_tx_base64.length % 4 === 0
    ? Buffer.from(body.signed_tx_base64, "base64") : null;
  if (!bytes || bytes.length === 0 || bytes.length > 1232 || bytes.toString("base64") !== body.signed_tx_base64) {
    return NextResponse.json({ error: "signed_tx_base64 must be canonical base64 containing a 1-1232 byte Solana transaction" }, { status: 400 });
  }
  if (body.intent_id && !/^[A-Za-z0-9_-]{1,128}$/.test(body.intent_id)) {
    return NextResponse.json({ error: "intent_id contains unsupported characters" }, { status: 400 });
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
        ...(body.intent_id
          ? { intent_id: body.intent_id }
          : { client_reference_id: `next-example-${crypto.randomUUID()}` }),
        origin: { label: "Clear Next.js example" },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const raw = await responseJson(response);
    if (!response.ok) return NextResponse.json(publicError(raw, `Clear rejected the send with HTTP ${response.status}`), { status: response.status });
    const receipt = projectReceipt(raw);
    return receipt
      ? NextResponse.json(receipt, { status: response.status })
      : NextResponse.json({ error: "Clear returned an invalid send receipt" }, { status: 502 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Send failed" }, { status: routeFailureStatus(error) });
  }
}
