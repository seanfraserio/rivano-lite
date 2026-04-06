import type { PipelineContext, PipelineResult } from "@rivano/core";
import type { Middleware } from "../pipeline.js";

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

interface RateLimitConfig {
  requests_per_minute: number;
  burst?: number;
}

export function createRateLimitMiddleware(config: RateLimitConfig): Middleware {
  const buckets = new Map<string, TokenBucket>();
  const maxTokens = config.burst ?? config.requests_per_minute;
  const refillRate = config.requests_per_minute / 60;

  function getKey(ctx: PipelineContext): string {
    return (ctx.metadata.apiKey as string) ?? (ctx.metadata.ip as string) ?? "global";
  }

  function refill(bucket: TokenBucket, now: number): void {
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(maxTokens, bucket.tokens + elapsed * refillRate);
    bucket.lastRefill = now;
  }

  return {
    name: "rate-limit",

    async execute(ctx: PipelineContext): Promise<PipelineResult> {
      const key = getKey(ctx);
      const now = Date.now();

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tokens: maxTokens, lastRefill: now };
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
  };
}
