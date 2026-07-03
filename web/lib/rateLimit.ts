/**
 * Minimal in-memory sliding-window rate limiter (Phase 6).
 *
 * ponytail: in-process Map — correct for our single-node VPS deployment; swap
 * for a shared store (Redis) only if the app ever runs on >1 instance.
 */

const WINDOWS = new Map<string, number[]>();
const MAX_KEYS = 10_000; // memory backstop

/** Returns true if the call is ALLOWED (and records it). */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  let hits = WINDOWS.get(key);
  if (!hits) {
    if (WINDOWS.size >= MAX_KEYS) WINDOWS.clear(); // crude but bounded
    hits = [];
    WINDOWS.set(key, hits);
  }
  // Drop timestamps outside the window (array stays tiny: ≤ max entries).
  while (hits.length > 0 && hits[0] <= cutoff) hits.shift();
  if (hits.length >= max) return false;
  hits.push(now);
  return true;
}
