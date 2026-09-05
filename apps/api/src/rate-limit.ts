/**
 * Fixed-window rate limiter: at most `max` hits per `key` within `windowMs`.
 *
 * ponytail: in-process Map, so the limit is per API instance, and Open WebUI's
 * backend (a single IP) shares one bucket. Swap the Map for Redis
 * (e.g. @upstash/ratelimit) keyed by user when running several replicas.
 */
export function createRateLimiter(max: number, windowMs = 60_000) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (key: string, now = Date.now()) => {
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;

    // Keep memory bounded: sweep expired windows once the map grows large.
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }

    return {
      allowed: entry.count <= max,
      remaining: Math.max(0, max - entry.count),
      retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
    };
  };
}
