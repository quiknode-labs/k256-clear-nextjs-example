import { NextResponse } from "next/server";

import { clearApiKey } from "@/lib/server";

export function GET() {
  try {
    clearApiKey();
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The Clear API key is not configured" }, { status: 500 });
  }
}
