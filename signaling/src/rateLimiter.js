const WINDOW_MS = 60_000; // 60s window per TRD §2.1
const MAX_ATTEMPTS = 10; // 10 attempts / window per TRD §2.1

/**
 * In-memory sliding-window-ish (fixed-window) counter keyed by source IP,
 * matching Backend Schema §3.2's `ratelimit:join:{sourceIp}` shape.
 * Called out in the schema doc as single-instance-only — replace with
 * Redis INCR/EXPIRE before running more than one signaling instance.
 */
export class RateLimiter {
  constructor({ windowMs = WINDOW_MS, maxAttempts = MAX_ATTEMPTS } = {}) {
    this.windowMs = windowMs;
    this.maxAttempts = maxAttempts;
    /** @type {Map<string, { count: number, windowStartedAt: number }>} */
    this.counters = new Map();
  }

  /**
   * Records one attempt for `sourceIp` and returns whether it should be
   * allowed through. Never leaks whether the *code* was valid — this check
   * happens purely on IP + attempt count, independent of room lookups.
   */
  attempt(sourceIp) {
    const now = Date.now();
    const entry = this.counters.get(sourceIp);

    if (!entry || now - entry.windowStartedAt >= this.windowMs) {
      this.counters.set(sourceIp, { count: 1, windowStartedAt: now });
      return true;
    }

    if (entry.count >= this.maxAttempts) {
      return false;
    }

    entry.count += 1;
    return true;
  }

  /** Periodic sweep so the Map doesn't grow unbounded on a long-lived process. */
  sweep() {
    const now = Date.now();
    for (const [ip, entry] of this.counters.entries()) {
      if (now - entry.windowStartedAt >= this.windowMs) this.counters.delete(ip);
    }
  }
}
