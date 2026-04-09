import type { PipelineContext, PipelineResult } from "@rivano/core";
import type { Middleware } from "../pipeline.js";

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  createdAt: number;
}

interface RateLimitConfig {
  requests_per_minute: number;
  burst?: number;
  maxBuckets?: number;
}

const DEFAULT_MAX_BUCKETS = 10_000;
const STALE_MS = 300_000; // 5 minutes — remove buckets not used in this time
const CLEANUP_INTERVAL_MS = 60_000; // Run cleanup every 60 seconds

export function createRateLimitMiddleware(config: RateLimitConfig): Middleware & { destroy: () => void } {
  const buckets = new Map<string, TokenBucket>();
  const maxTokens = config.burst ?? config.requests_per_minute;
  const refillRate = config.requests_per_minute / 60;
  const maxBuckets = config.maxBuckets ?? DEFAULT_MAX_BUCKETS;

  function getKey(ctx: PipelineContext): string {
    return (ctx.metadata.ip as string) ?? "global";
  }

  function refill(bucket: TokenBucket, now: number): void {
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(maxTokens, bucket.tokens + elapsed * refillRate);
    bucket.lastRefill = now;
  }

  // Periodic cleanup of stale buckets
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.lastRefill > STALE_MS) {
        buckets.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  // Allow the process to exit even if the interval is running
  if (cleanup.unref) cleanup.unref();

  const middleware: Middleware & { destroy: () => void } = {
    name: "rate-limit",

    async execute(ctx: PipelineContext): Promise<PipelineResult> {
      const key = getKey(ctx);
      const now = Date.now();

      let bucket = buckets.get(key);

      if (!bucket) {
        // Evict stalest bucket if at capacity (found during cleanup)
        if (buckets.size >= maxBuckets) {
          let stalestKey: string | null = null;
          let stalestTime = Infinity;
          for (const [k, b] of buckets) {
            if (b.lastRefill < stalestTime) {
              stalestTime = b.lastRefill;
              stalestKey = k;
            }
          }
          if (stalestKey) buckets.delete(stalestKey);
        }

        bucket = { tokens: maxTokens, lastRefill: now, createdAt: now };
        buckets.set(key, bucket);
      }

      refill(bucket, now);

      if (bucket.tokens < 1) {
        ctx.metadata.rateLimitExceeded = true;
        ctx.metadata.statusCode = 429;
        ctx.metadata.errorMessage = "Rate limit exceeded";
        return "block";
      }

      bucket.tokens -= 1;
      return "continue";
    },

    destroy() {
      clearInterval(cleanup);
      buckets.clear();
    },
  };

  return middleware;
}