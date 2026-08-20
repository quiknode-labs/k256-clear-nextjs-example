"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { cancelNotice, errorMessage, intentEverBroadcast, intentFailureReason, reachedGate, retryDelayMs, retryableStatus, statusLabel, watcherDone, type ClearIntent } from "@/lib/clear";
import { actionFromHash, signAndSendMemo, type MemoAction } from "@/lib/memo-client";

const MAX_CONSECUTIVE_FAILURES = 8;
const CANCELABLE = new Set(["building", "collecting", "scheduled", "armed", "submitted", "processed", "needs_resign"]);

export function IntentWatcher({ intentId }: { intentId: string }) {
  const [intent, setIntent] = useState<ClearIntent | null>(null);
  const [connected, setConnected] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelOutcome, setCancelOutcome] = useState<string | null>(null);
  const [willRetry, setWillRetry] = useState(false);
  const [canRetryStatus, setCanRetryStatus] = useState(false);
  const [terminalWatchComplete, setTerminalWatchComplete] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [action, setAction] = useState<MemoAction | null>(null);
  const [actionBusy, setActionBusy] = useState<"resign" | "cancel" | null>(null);

  useEffect(() => setAction(actionFromHash(window.location.hash)), []);

  useEffect(() => {
    let alive = true;
    let controller: AbortController | null = null;
    async function watch() {
      // Two clocks, deliberately distinct (the Clear contract): `seq` is the
      // DELIVERY cursor of the realtime stream (/v1/clear/events — resumes the
      // long-poll exactly where this page left off); `version` is the intent's
      // LIFECYCLE clock (guards against ever applying an older snapshot).
      let seq: number | null = null;
      let version: number | null = null;
      let consecutiveFailures = 0;
      let hasSnapshot = false;
      let terminalObservedAt: number | null = null;
      setTerminalWatchComplete(false);

      // One canonical snapshot per real transition: the stream is the change
      // signal, the snapshot read is the truth. Returns true to keep watching.
      async function readSnapshot(signal: AbortSignal): Promise<boolean> {
        const response = await fetch(`/api/intents/${encodeURIComponent(intentId)}`, {
          cache: "no-store",
          signal,
        });
        const body = await response.json() as ClearIntent & { error?: unknown };
        if (!response.ok) {
          const message = errorMessage(body, `Status read failed with HTTP ${response.status}`);
          if (!retryableStatus(response.status, hasSnapshot)) {
            setConnected(false);
            setWatchError(message);
            setWillRetry(false);
            setCanRetryStatus(true);
            return false;
          }
          throw new Error(message);
        }
        if (version != null && body.version < version) {
          throw new Error("Clear returned an older intent version");
        }
        version = body.version;
        setIntent(body);
        setConnected(true);
        setWatchError(null);
        setWillRetry(false);
        setCanRetryStatus(false);
        hasSnapshot = true;
        const everBroadcast = intentEverBroadcast(body);
        if (["invalid", "canceled"].includes(body.status) && everBroadcast) {
          terminalObservedAt ??= Date.now();
        }
        if (watcherDone(body.status, terminalObservedAt, Date.now(), everBroadcast)) {
          setTerminalWatchComplete(true);
          return false;
        }
        return true;
      }

      while (alive) {
        controller = new AbortController();
        try {
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(40_000)]);
          if (!hasSnapshot) {
            if (!(await readSnapshot(signal))) return;
            if (!alive) return;
          }
          // Long-poll the stream: with a cursor the gateway HOLDS the request
          // until the intent moves (or its wait budget elapses and returns []).
          // The first call has no cursor — it replays retained history and
          // closes with k256.ready, whose seq seeds the cursor.
          const query = seq == null ? "" : `?cursor=${seq}`;
          const response = await fetch(`/api/intents/${encodeURIComponent(intentId)}/events${query}`, {
            cache: "no-store",
            signal,
          });
          const body = await response.json() as { events?: Array<{ seq: number; event: string; payload: Record<string, unknown> }>; error?: unknown };
          if (!response.ok) {
            const message = errorMessage(body, `Events read failed with HTTP ${response.status}`);
            if (!retryableStatus(response.status, hasSnapshot)) {
              if (!alive) return;
              setConnected(false);
              setWatchError(message);
              setWillRetry(false);
              setCanRetryStatus(true);
              return;
            }
            throw new Error(message);
          }
          if (!alive) return;
          let transitioned = false;
          for (const frame of body.events ?? []) {
            if (frame.event === "k256.gap") {
              // History rotated out — the snapshot below is the truth; resume
              // from the retained head (0 on an expired stream: wait live).
              const head = frame.payload?.retained_head;
              seq = typeof head === "number" ? head : 0;
              transitioned = true;
              continue;
            }
            seq = frame.seq;
            if (frame.event.startsWith("intent.") && frame.payload?.id === intentId) transitioned = true;
          }
          setConnected(true);
          setWatchError(null);
          setWillRetry(false);
          consecutiveFailures = 0;
          if (transitioned && !(await readSnapshot(signal))) return;
        } catch (cause) {
          if (!alive || controller.signal.aborted) return;
          consecutiveFailures += 1;
          const message = cause instanceof Error ? cause.message : "Connection lost";
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            setConnected(false);
            setWatchError(`${message}. Status could not be refreshed after ${MAX_CONSECUTIVE_FAILURES} attempts.`);
            setWillRetry(false);
            setCanRetryStatus(true);
            return;
          }
          setConnected(false);
          setWatchError(message);
          setWillRetry(true);
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs(consecutiveFailures)));
        }
      }
    }
    void watch();
    return () => { alive = false; controller?.abort(); };
  }, [generation, intentId]);

  async function resign() {
    if (!action) return;
    setActionBusy("resign");
    setActionError(null);
    setCanRetryStatus(false);
    try {
      await signAndSendMemo(action, intentId);
      setGeneration((value) => value + 1);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "The transaction could not be re-signed");
    } finally {
      setActionBusy(null);
    }
  }

  async function cancel() {
    setActionBusy("cancel");
    setActionError(null);
    setCancelOutcome(null);
    setCanRetryStatus(false);
    try {
      const response = await fetch(`/api/intents/${encodeURIComponent(intentId)}`, { method: "POST" });
      const body = await response.json() as { outcome?: string; error?: unknown };
      if (!response.ok) throw new Error(errorMessage(body, "Clear could not stop further attempts"));
      setCancelOutcome(body.outcome ?? null);
      setGeneration((value) => value + 1);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Clear could not stop further attempts");
    } finally {
      setActionBusy(null);
    }
  }

  const everBroadcast = intent ? intentEverBroadcast(intent) : false;
  const stopPending = cancelOutcome != null && !["confirmed", "finalized", "failed"].includes(intent?.status ?? "");
  const stopNotice = intent?.status === "canceled" || stopPending ? cancelNotice(cancelOutcome, everBroadcast) : null;

  return (
    <main className="shell">
      <section className="panel">
        <header><p className="eyebrow">Intent</p><h1>{intent ? statusLabel(intent.status) : "Connecting…"}</h1></header>
        <dl><dt>ID</dt><dd>{intentId}</dd><dt>Connection</dt><dd>{intent?.status === "needs_resign" ? "Waiting for signature" : terminalWatchComplete ? "Settled" : connected ? "Watching" : watchError && !willRetry ? "Stopped" : watchError ? "Reconnecting" : "Connecting"}</dd>{intent ? <><dt>Gate</dt><dd>{intent.commitment_target}{reachedGate(intent.status, intent.commitment_target) ? " reached" : " pending"}</dd></> : null}{intent?.signature ? <><dt>Signature</dt><dd>{intent.signature}</dd></> : null}</dl>
        {watchError ? <p className="error" role="alert">{watchError}{willRetry ? ". Retrying from the last version…" : ""}</p> : null}
        {actionError ? <p className="error" role="alert">{actionError}</p> : null}
        {intent?.status === "needs_resign" ? <><p className="warning">{intent.resign_hint?.action ?? "These signed bytes expired. Sign the same action again with fresh validity."}</p>{action && action.cluster === intent.cluster && action.gate === intent.commitment_target ? <><dl><dt>Cluster</dt><dd>{action.cluster}</dd><dt>Memo</dt><dd>{action.memo}</dd></dl><button type="button" onClick={resign} disabled={actionBusy !== null}>{actionBusy === "resign" ? "Waiting for wallet…" : "Re-sign and continue"}</button></> : <p className="warning">The saved action is missing or does not match this intent. Open it from the original send page instead of signing from this link.</p>}</> : null}
        {intent && ["invalid", "failed"].includes(intent.status) ? <p className="error">Clear reached a terminal outcome: {intentFailureReason(intent)}.</p> : null}
        {stopNotice ? <p className={stopNotice.tone}>{stopNotice.message}</p> : null}
        {intent && CANCELABLE.has(intent.status) ? <button className="secondary" type="button" onClick={cancel} disabled={actionBusy !== null}>{actionBusy === "cancel" ? "Stopping…" : "Stop further attempts"}</button> : null}
        {canRetryStatus ? <button className="secondary" type="button" onClick={() => setGeneration((value) => value + 1)}>Retry status</button> : null}
        {intent?.explorer_url ? <a className="button secondary" href={intent.explorer_url} target="_blank" rel="noreferrer">Open explorer</a> : null}
        <Link className="button secondary" href="/">Send another</Link>
      </section>
    </main>
  );
}
