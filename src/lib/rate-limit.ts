// In-memory sliding-window rate limiter for AI endpoints (README §8: 15/min/user).
// Sufficient for a single-node deployment; swap for Redis if scaled out.

const hits = new Map<string, number[]>();

export function rateLimit(key: string, max = 15, windowMs = 60_000): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const windowStart = now - windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);
  if (recent.length >= max) {
    const retryAfterSec = Math.ceil((recent[0] + windowMs - now) / 1000);
    hits.set(key, recent);
    return { ok: false, retryAfterSec };
  }
  recent.push(now);
  hits.set(key, recent);
  // Opportunistic cleanup so the map doesn't grow unbounded.
  if (hits.size > 5_000) {
    for (const [k, v] of hits) if (v.every((t) => t <= windowStart)) hits.delete(k);
  }
  return { ok: true, retryAfterSec: 0 };
}
