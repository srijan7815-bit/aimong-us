/**
 * Tiny in-memory sliding-window rate limiter (INSTRUCTIONS §8): guards join
 * attempts and chat against spam. Single instance => no shared store needed.
 */
export interface RateLimitOptions {
  /** Max events allowed inside the window. */
  max: number;
  /** Window length in ms. */
  windowMs: number;
}

export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private readonly opts: RateLimitOptions) {}

  /** Returns true when the event is allowed, false when the caller is over budget. */
  take(key: string, now = Date.now()): boolean {
    const cutoff = now - this.opts.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length >= this.opts.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }

  /** Drop stale keys so a long-lived process does not leak memory. */
  sweep(now = Date.now()): void {
    const cutoff = now - this.opts.windowMs;
    for (const [key, list] of this.hits) {
      const kept = list.filter((t) => t > cutoff);
      if (kept.length === 0) this.hits.delete(key);
      else this.hits.set(key, kept);
    }
  }
}
