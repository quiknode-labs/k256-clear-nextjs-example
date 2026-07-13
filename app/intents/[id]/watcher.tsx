"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { reachedGate, watcherDone, type ClearIntent, type Gate } from "@/lib/clear";

export function IntentWatcher({ intentId, gate }: { intentId: string; gate: Gate }) {
  const [intent, setIntent] = useState<ClearIntent | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let controller: AbortController | null = null;
    async function watch() {
      let cursor: number | null = null;
      while (alive) {
        controller = new AbortController();
        const query = cursor == null ? "" : `?wait=true&cursor=${cursor}`;
        try {
          const response = await fetch(`/api/intents/${encodeURIComponent(intentId)}${query}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          const body = await response.json() as ClearIntent & { error?: string };
          if (!response.ok) throw new Error(body.error ?? `Status read failed with HTTP ${response.status}`);
          if (!alive) return;
          setIntent(body);
          setConnected(true);
          setError(null);
          cursor = body.version;
          if (watcherDone(body.status)) return;
        } catch (cause) {
          if (!alive || controller.signal.aborted) return;
          setConnected(false);
          setError(cause instanceof Error ? cause.message : "Connection lost");
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
      }
    }
    void watch();
    return () => { alive = false; controller?.abort(); };
  }, [intentId]);

  return (
    <main className="shell">
      <section className="panel">
        <header><p className="eyebrow">Intent</p><h1>{intent?.status ?? "Connecting…"}</h1></header>
        <dl><dt>ID</dt><dd>{intentId}</dd><dt>Connection</dt><dd>{connected ? "Watching" : "Reconnecting"}</dd><dt>Gate</dt><dd>{gate}{intent && reachedGate(intent.status, gate) ? " reached" : " pending"}</dd>{intent?.signature ? <><dt>Signature</dt><dd>{intent.signature}</dd></> : null}</dl>
        {error ? <p className="error" role="status">{error}. Retrying from the last version…</p> : null}
        {intent?.status === "needs_resign" ? <p className="warning">These signed bytes expired. Build and sign the same action with a fresh blockhash, then send it with this intent ID.</p> : null}
        {intent && ["invalid", "failed", "canceled"].includes(intent.status) ? <p className="error">Clear reached a terminal outcome: {intent.status}.</p> : null}
        {intent?.explorer_url ? <a className="button secondary" href={intent.explorer_url} target="_blank" rel="noreferrer">Open explorer</a> : null}
        <Link className="button secondary" href="/">Send another</Link>
      </section>
    </main>
  );
}
