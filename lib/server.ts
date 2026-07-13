import "server-only";

export function clearApiKey(): string {
  const value = process.env.K256_CLEAR_API_KEY;
  if (!value) throw new Error("K256_CLEAR_API_KEY is not configured");
  return value;
}

export const readOrigin = (process.env.K256_CLEAR_READ_ORIGIN ?? "https://api.k256.xyz")
  .replace(/\/$/, "");

export async function clearJson(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => null) as unknown;
  if (response.ok) return body;
  const record = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const error = record?.error && typeof record.error === "object"
    ? record.error as Record<string, unknown>
    : record;
  const message = typeof error?.message === "string"
    ? error.message
    : `Clear request failed with HTTP ${response.status}`;
  throw new Error(message);
}
