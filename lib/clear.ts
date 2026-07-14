export const CLUSTERS = ["mainnet", "devnet", "testnet"] as const;
export type Cluster = (typeof CLUSTERS)[number];
export type Gate = "confirmed" | "finalized";

export type IntentStatus =
  | "building" | "collecting" | "scheduled" | "armed"
  | "submitted" | "processed" | "confirmed" | "finalized"
  | "needs_resign" | "invalid" | "failed" | "canceled";

export interface ClearReceipt {
  intent_id: string;
}

export interface ClearIntent {
  intent_id: string;
  version: number;
  status: string;
  cluster: string;
  commitment_target: Gate;
  signature: string | null;
  explorer_url: string | null;
  events: Array<{ at: number; status: string; reason?: string }>;
  error: unknown;
  resign_hint?: { reason: string; action: string };
}

export interface CancelNotice {
  tone: "success" | "warning";
  message: string;
}

const RANK: Partial<Record<IntentStatus, number>> = {
  processed: 1,
  confirmed: 2,
  finalized: 3,
};

export function reachedGate(status: string, gate: Gate): boolean {
  return (RANK[status as IntentStatus] ?? 0) >= (RANK[gate] ?? 0);
}

const LANDING_WINS_WATCH_MS = 90_000;

export function watcherDone(
  status: string,
  terminalObservedAt: number | null = null,
  now = Date.now(),
  everBroadcast = false,
): boolean {
  if (["finalized", "needs_resign", "failed"].includes(status)) return true;
  if (["invalid", "canceled"].includes(status)) {
    if (!everBroadcast) return true;
    return terminalObservedAt != null && now - terminalObservedAt > LANDING_WINS_WATCH_MS;
  }
  return false;
}

export function intentEverBroadcast(intent: Pick<ClearIntent, "signature" | "events">): boolean {
  return intent.signature != null
    || intent.events.some((event) => ["submitted", "processed", "confirmed", "finalized", "failed"].includes(event.status));
}

export function retryableStatus(status: number, hasSnapshot: boolean): boolean {
  return (!hasSnapshot && status === 404) || status === 408 || status === 429 || status >= 500;
}

export function retryDelayMs(consecutiveFailures: number, random = Math.random()): number {
  const base = Math.min(8_000, 500 * (2 ** Math.max(0, consecutiveFailures - 1)));
  return Math.round(base * (0.75 + Math.min(1, Math.max(0, random)) * 0.5));
}

export function errorMessage(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["message", "reason", "code"] as const) {
      if (typeof record[key] === "string" && record[key].length > 0) {
        return key === "code" ? record[key].replaceAll("_", " ") : record[key];
      }
    }
    if (record.error !== value) return errorMessage(record.error, fallback);
  }
  return fallback;
}

export function intentFailureReason(intent: ClearIntent): string | null {
  if (!["needs_resign", "invalid", "failed", "canceled"].includes(intent.status)) return null;
  const latestReason = [...intent.events].reverse().find((event) => event.reason)?.reason;
  return errorMessage(intent.error, latestReason ?? intent.status);
}

export function clearSendOrigin(cluster: Cluster): string {
  return `https://clear-${cluster}.k256.xyz`;
}

export function statusLabel(status: string): string {
  if (status === "needs_resign") return "Needs signature";
  const words = status.replaceAll("_", " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export function cancelNotice(outcome: string | null, everBroadcast = false): CancelNotice | null {
  if (outcome === "stopped_before_submit" || ((outcome == null || outcome === "already_canceled") && !everBroadcast)) {
    return { tone: "success", message: "Clear stopped before these bytes could land." };
  }
  if (outcome === "dropped_after_cancel_request") {
    return { tone: "success", message: "The expired bytes can no longer land, and Clear will not send them again." };
  }
  if (outcome === "already_invalid") {
    return { tone: "success", message: "Clear had already rejected these bytes before broadcast." };
  }
  if (outcome === "landed_after_cancel_request" || outcome === "already_submitted_cannot_revoke") {
    return { tone: "warning", message: "The transaction was already on chain or past the point where it could be stopped." };
  }
  if (outcome === "stopped_further_attempts" || outcome === "already_canceled" || outcome == null) {
    return { tone: "warning", message: "Clear stopped future attempts. Bytes already sent may still land." };
  }
  return { tone: "warning", message: "Clear returned a stop outcome this example does not recognize. Check the current chain status before acting again." };
}
