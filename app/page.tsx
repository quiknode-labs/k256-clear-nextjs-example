"use client";

import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CLUSTERS, type ClearReceipt, type Cluster, type Gate } from "@/lib/clear";

interface SolanaProvider {
  isPhantom?: boolean;
  connect(): Promise<{ publicKey: PublicKey }>;
  signTransaction(transaction: Transaction): Promise<Transaction>;
}

declare global {
  interface Window { phantom?: { solana?: SolanaProvider } }
}

const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

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
      const wallet = window.phantom?.solana;
      if (!wallet) throw new Error("Install or open Phantom, then try again.");
      const { publicKey } = await wallet.connect();
      const blockhashResponse = await fetch(`/api/rpc?cluster=${cluster}`, { cache: "no-store" });
      const blockhashBody = await blockhashResponse.json() as {
        blockhash?: string; lastValidBlockHeight?: number; error?: string;
      };
      if (!blockhashResponse.ok || !blockhashBody.blockhash || blockhashBody.lastValidBlockHeight == null) {
        throw new Error(blockhashBody.error ?? "Could not read a recent blockhash");
      }
      const transaction = new Transaction({
        feePayer: publicKey,
        recentBlockhash: blockhashBody.blockhash,
      }).add(new TransactionInstruction({
        programId: MEMO_PROGRAM,
        keys: [],
        data: Buffer.from(memo, "utf8"),
      }));
      const signed = await wallet.signTransaction(transaction);
      const signedBytes = signed.serialize();
      let binary = "";
      for (const byte of signedBytes) binary += String.fromCharCode(byte);
      const response = await fetch("/api/intents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cluster,
          commitment_target: gate,
          signed_tx_base64: btoa(binary),
          blockhash: blockhashBody.blockhash,
          last_valid_block_height: blockhashBody.lastValidBlockHeight,
        }),
      });
      const receipt = await response.json() as ClearReceipt & { error?: string };
      if (!response.ok) throw new Error(receipt.error ?? "Clear rejected the send");
      localStorage.setItem("last-clear-intent", receipt.intent_id);
      router.push(`/intents/${receipt.intent_id}?gate=${gate}`);
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
