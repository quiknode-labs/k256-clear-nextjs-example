import { NextResponse } from "next/server";

import { clearApiKey, projectIntent, publicError, readOrigin, responseJson, routeFailureStatus } from "@/lib/server";

export const maxDuration = 30;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    return NextResponse.json({ error: "invalid intent id" }, { status: 400 });
  }
  const input = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  const wait = input.get("wait") === "true";
  if (wait) query.set("wait", "true");
  const cursor = input.get("cursor");
  if (cursor && /^\d+$/.test(cursor)) query.set("cursor", cursor);
  if (wait) query.set("timeout", "20");
  try {
    const suffix = query.size > 0 ? `?${query}` : "";
    const response = await fetch(`${readOrigin}/v1/clear/intents/${encodeURIComponent(id)}${suffix}`, {
      headers: { Authorization: `Bearer ${clearApiKey()}` },
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    const raw = await responseJson(response);
    if (!response.ok) return NextResponse.json(publicError(raw, `Status read failed with HTTP ${response.status}`), { status: response.status });
    const intent = projectIntent(raw);
    return intent
      ? NextResponse.json(intent)
      : NextResponse.json({ error: "Clear returned an invalid intent snapshot" }, { status: 502 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Status read failed" }, { status: routeFailureStatus(error) });
  }
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    return NextResponse.json({ error: "invalid intent id" }, { status: 400 });
  }
  try {
    const response = await fetch(`${readOrigin}/v1/clear/intents/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${clearApiKey()}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const raw = await responseJson(response);
    if (!response.ok) return NextResponse.json(publicError(raw, `Cancel failed with HTTP ${response.status}`), { status: response.status });
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
    return value && typeof value.intent_id === "string" && typeof value.outcome === "string"
      ? NextResponse.json({ intent_id: value.intent_id, outcome: value.outcome })
      : NextResponse.json({ error: "Clear returned an invalid cancel outcome" }, { status: 502 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Cancel failed" }, { status: routeFailureStatus(error) });
  }
}
