import { NextResponse } from "next/server";

import { clearApiKey, publicError, readOrigin, responseJson, routeFailureStatus } from "@/lib/server";

// The realtime lifecycle stream, JSON long-poll rendering (one of three: SSE
// and WebSocket carry the same frames and the same `seq` cursor). The proxy
// keeps the API key server-side; the gateway holds the request until events
// arrive past ?cursor or its wait budget elapses, so one round trip per
// lifecycle transition replaces any fixed-interval polling.
export const maxDuration = 40;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    return NextResponse.json({ error: "invalid intent id" }, { status: 400 });
  }
  const cursor = new URL(request.url).searchParams.get("cursor");
  const query = new URLSearchParams({ id });
  if (cursor && /^\d+$/.test(cursor)) query.set("cursor", cursor);
  try {
    const response = await fetch(`${readOrigin}/v1/clear/events?${query}`, {
      headers: { Authorization: `Bearer ${clearApiKey()}` },
      cache: "no-store",
      signal: AbortSignal.timeout(35_000),
    });
    const raw = await responseJson(response);
    if (!response.ok) return NextResponse.json(publicError(raw, `Events read failed with HTTP ${response.status}`), { status: response.status });
    return NextResponse.json(raw);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Events read failed" }, { status: routeFailureStatus(error) });
  }
}
