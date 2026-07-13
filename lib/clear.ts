export const CLUSTERS = ["mainnet", "devnet", "testnet"] as const;
export type Cluster = (typeof CLUSTERS)[number];
export type Gate = "confirmed" | "finalized";

export type IntentStatus =
  | "building" | "collecting" | "scheduled" | "armed"
  | "submitted" | "processed" | "confirmed" | "finalized"
  | "needs_resign" | "invalid" | "failed" | "canceled";

export interface ClearReceipt {
  intent_id: string;
  signature: string | null;
  status: string;
  status_url: string;
}

export interface ClearIntent {
  intent_id: string;
  version: number;
  status: IntentStatus;
  cluster: string;
  commitment_target: Gate;
  signature: string | null;
  explorer_url: string | null;
  events: Array<{ at: number; status: string; reason?: string }>;
  result: { slot?: number | null; err?: unknown } | null;
  error: unknown;
}

const RANK: Partial<Record<IntentStatus, number>> = {
  processed: 1,
  confirmed: 2,
  finalized: 3,
};

export function reachedGate(status: IntentStatus, gate: Gate): boolean {
  return (RANK[status] ?? 0) >= (RANK[gate] ?? 0);
}

export function watcherDone(status: IntentStatus): boolean {
  return ["finalized", "needs_resign", "invalid", "failed", "canceled"].includes(status);
}

export function clearSendOrigin(cluster: Cluster): string {
  return `https://clear-${cluster}.k256.xyz`;
}
