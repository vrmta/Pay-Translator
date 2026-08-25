/**
 * Deterministic JSON serialization: top-level keys sorted, compact separators.
 * Used as the Ed25519 message so signatures are stable across runtimes.
 */
export function canonicalJson(value: Record<string, unknown>): string {
  return JSON.stringify(value, Object.keys(value).sort());
}

/**
 * Convert USD to integer cents for budget arithmetic (avoids float drift).
 */
export function usdToCents(usd: number): number {
  return Math.round(usd * 100);
}

export function centsToUsd(cents: number): number {
  return cents / 100;
}
