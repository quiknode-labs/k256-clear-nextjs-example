import "server-only";

import { type ClearIntent, type ClearReceipt, type Gate } from "./clear";

export class ClearConfigurationError extends Error {}

export function clearApiKey(): string {
  const value = process.env.K256_CLEAR_API_KEY;
  if (!value) throw new ClearConfigurationError("K256_CLEAR_API_KEY is not configured");
  if (!/^k256_live_[A-Za-z0-9]{32}$/.test(value)) {
    throw new ClearConfigurationError("K256_CLEAR_API_KEY must be k256_live_ followed by 32 letters or digits");
  }
  return value;
}

export function routeFailureStatus(error: unknown): 500 | 502 {
  return error instanceof ClearConfigurationError ? 500 : 502;
}

export const readOrigin = (process.env.K256_CLEAR_READ_ORIGIN ?? "https://api.k256.xyz")
  .replace(/\/$/, "");

export async function responseJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null) as Promise<unknown>;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function publicError(value: unknown, fallback: string): { error: { code?: string; message: string } } {
  const outer = recordOf(value);
  const nested = recordOf(outer?.error);
  const source = nested ?? outer;
  const code = typeof source?.code === "string" ? source.code : undefined;
  const chainDetail = source?.err === undefined ? null : JSON.stringify(source.err);
  const message = typeof source?.message === "string"
    ? source.message
    : typeof outer?.error === "string" ? outer.error
      : code ? `${code.replaceAll("_", " ")}${chainDetail ? `: ${chainDetail}` : ""}` : fallback;
  return { error: { ...(code ? { code } : {}), message } };
}

export function projectReceipt(value: unknown): ClearReceipt | null {
  const input = recordOf(value);
  return input && typeof input.intent_id === "string" ? { intent_id: input.intent_id } : null;
}

export function projectIntent(value: unknown): ClearIntent | null {
  const input = recordOf(value);
  if (!input || typeof input.intent_id !== "string" || typeof input.version !== "number"
    || typeof input.status !== "string" || input.status.length === 0 || input.status.length > 64
    || typeof input.cluster !== "string" || input.cluster.length === 0 || input.cluster.length > 64
    || (input.commitment_target !== "confirmed" && input.commitment_target !== "finalized")
    || (input.signature != null && typeof input.signature !== "string")) return null;

  const events = Array.isArray(input.events) ? input.events.flatMap((value) => {
    const event = recordOf(value);
    if (!event || typeof event.at !== "number" || typeof event.status !== "string") return [];
    return [{
      at: event.at,
      status: event.status,
      ...(typeof event.reason === "string" ? { reason: event.reason } : {}),
    }];
  }) : [];
  const hint = recordOf(input.resign_hint);

  return {
    intent_id: input.intent_id,
    version: input.version,
    status: input.status,
    cluster: input.cluster,
    commitment_target: input.commitment_target as Gate,
    signature: typeof input.signature === "string" ? input.signature : null,
    explorer_url: typeof input.explorer_url === "string" && input.explorer_url.startsWith("https://")
      ? input.explorer_url : null,
    events,
    error: input.error == null ? null : publicError(input.error, "Clear could not land this transaction").error,
    ...(hint && typeof hint.reason === "string" && typeof hint.action === "string"
      ? { resign_hint: { reason: hint.reason, action: hint.action } } : {}),
  };
}
