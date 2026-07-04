/**
 * Minimal in-memory sliding-window rate limiter (Phase 6).
 *
 * ponytail: in-process Map — correct for our single-node VPS deployment; swap
 * for a shared store (Redis) only if the app ever runs on >1 instance.
 */

const WINDOWS = new Map<string, number[]>();
const MAX_KEYS = 10_000; // memory backstop
// Longest window any caller uses — sweeping keys idle past this is always safe.
const MAX_WINDOW_MS = 10 * 60_000;

/** Returns true if the call is ALLOWED (and records it). */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  let hits = WINDOWS.get(key);
  if (!hits) {
    if (WINDOWS.size >= MAX_KEYS) {
      // Sweep only idle keys — a global clear() would let an attacker reset
      // their own brute-force bucket by spraying throwaway keys (Ph7 review).
      for (const [k, v] of WINDOWS) {
        if (v.length === 0 || v[v.length - 1] <= now - MAX_WINDOW_MS) {
          WINDOWS.delete(k);
        }
      }
      // ponytail: if 10k keys are all genuinely hot, refuse new ones instead
      // of wiping live counters; swap for LRU only if this ever bites.
      if (WINDOWS.size >= MAX_KEYS) return false;
    }
    hits = [];
    WINDOWS.set(key, hits);
  }
  // Drop timestamps outside the window (array stays tiny: ≤ max entries).
  while (hits.length > 0 && hits[0] <= cutoff) hits.shift();
  if (hits.length >= max) return false;
  hits.push(now);
  return true;
}
