"use client";

import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";

import { errorMessage, type ClearReceipt, type Cluster, type Gate } from "./clear";

interface SolanaProvider {
  connect(): Promise<{ publicKey: PublicKey }>;
  signTransaction(transaction: Transaction): Promise<Transaction>;
}

declare global {
  interface Window { phantom?: { solana?: SolanaProvider } }
}

export interface MemoAction {
  cluster: Cluster;
  gate: Gate;
  memo: string;
}

const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export function actionHash(action: MemoAction): string {
  return `#action=${encodeURIComponent(JSON.stringify(action))}`;
}

export function actionFromHash(hash: string): MemoAction | null {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get("action");
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<MemoAction>;
    if ((parsed.cluster === "mainnet" || parsed.cluster === "devnet" || parsed.cluster === "testnet")
      && (parsed.gate === "confirmed" || parsed.gate === "finalized")
      && typeof parsed.memo === "string" && parsed.memo.length > 0 && parsed.memo.length <= 160) {
      return parsed as MemoAction;
    }
  } catch {
    return null;
  }
  return null;
}

export async function signAndSendMemo(action: MemoAction, intentId?: string): Promise<ClearReceipt> {
  const wallet = window.phantom?.solana;
  if (!wallet) throw new Error("Install or open Phantom, then try again.");
  const readiness = await fetch("/api/ready", { cache: "no-store" });
  if (!readiness.ok) {
    throw new Error(errorMessage(await readiness.json().catch(() => null), "The Clear API key is not ready"));
  }
  const { publicKey } = await wallet.connect();
  const blockhashResponse = await fetch(`/api/rpc?cluster=${action.cluster}`, { cache: "no-store" });
  const blockhashBody = await blockhashResponse.json() as {
    blockhash?: string; lastValidBlockHeight?: number; error?: unknown;
  };
  if (!blockhashResponse.ok || !blockhashBody.blockhash || blockhashBody.lastValidBlockHeight == null) {
    throw new Error(errorMessage(blockhashBody, "Could not read a recent blockhash"));
  }

  const transaction = new Transaction({
    feePayer: publicKey,
    recentBlockhash: blockhashBody.blockhash,
  }).add(new TransactionInstruction({
    programId: MEMO_PROGRAM,
    keys: [],
    data: Buffer.from(action.memo, "utf8"),
  }));
  const signed = await wallet.signTransaction(transaction);
  const response = await fetch("/api/intents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cluster: action.cluster,
      commitment_target: action.gate,
      signed_tx_base64: Buffer.from(signed.serialize()).toString("base64"),
      blockhash: blockhashBody.blockhash,
      last_valid_block_height: blockhashBody.lastValidBlockHeight,
      ...(intentId ? { intent_id: intentId } : {}),
    }),
  });
  const receipt = await response.json() as ClearReceipt & { error?: unknown };
  if (!response.ok) throw new Error(errorMessage(receipt, "Clear rejected the send"));
  if (intentId && receipt.intent_id !== intentId) {
    throw new Error("Clear did not continue the intent that was re-signed");
  }
  return receipt;
}
