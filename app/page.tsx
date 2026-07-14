"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CLUSTERS, type Cluster, type Gate } from "@/lib/clear";
import { actionHash, signAndSendMemo } from "@/lib/memo-client";

export default function Home() {
  const router = useRouter();
  const [cluster, setCluster] = useState<Cluster>("devnet");
  const [gate, setGate] = useState<Gate>("finalized");
  const [memo, setMemo] = useState("Hello from Clear");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signAndSend() {
    setBusy(true);
    setError(null);
    try {
      const action = { cluster, gate, memo };
      const receipt = await signAndSendMemo(action);
      router.push(`/intents/${receipt.intent_id}${actionHash(action)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The transaction could not be sent");
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <section className="panel">
        <header><p className="eyebrow">k256 Clear</p><h1>Sign and land a transaction</h1></header>
        <label>Cluster<select value={cluster} onChange={(event) => setCluster(event.target.value as Cluster)}>{CLUSTERS.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Wait for<select value={gate} onChange={(event) => setGate(event.target.value as Gate)}><option value="confirmed">Confirmed</option><option value="finalized">Finalized</option></select></label>
        <label>Memo<input value={memo} maxLength={160} onChange={(event) => setMemo(event.target.value)} /></label>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button type="button" onClick={signAndSend} disabled={busy || memo.length === 0}>{busy ? "Waiting for wallet…" : "Sign and send"}</button>
      </section>
    </main>
  );
}
