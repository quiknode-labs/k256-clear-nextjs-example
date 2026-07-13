import { NextResponse } from "next/server";

import type { ClearIntent } from "@/lib/clear";
import { clearApiKey, clearJson, readOrigin } from "@/lib/server";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^lc_[a-zA-Z0-9]+$/.test(id)) {
    return NextResponse.json({ error: "invalid intent id" }, { status: 400 });
  }
  const input = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  if (input.get("wait") === "true") query.set("wait", "true");
  const cursor = input.get("cursor");
  if (cursor && /^\d+$/.test(cursor)) query.set("cursor", cursor);
  query.set("timeout", "25");
  try {
    const response = await fetch(`${readOrigin}/v1/clear/intents/${encodeURIComponent(id)}?${query}`, {
      headers: { Authorization: `Bearer ${clearApiKey()}` },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    return NextResponse.json(await clearJson(response) as ClearIntent, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Status read failed" }, { status: 502 });
  }
}
