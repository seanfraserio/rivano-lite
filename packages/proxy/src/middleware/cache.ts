import type { PipelineContext, PipelineResult } from "@rivano/core";
import type { Middleware } from "../pipeline.js";

interface CacheEntry {
  response: unknown;
  createdAt: number;
  key: string;
}

interface CacheConfig {
  enabled: boolean;
  ttl: number;
}

const MAX_ENTRIES = 1000;

export function createCacheMiddleware(config: CacheConfig): Middleware {
  const cache = new Map<string, CacheEntry>();
  const accessOrder: string[] = [];
  let hits = 0;
  let misses = 0;

  async function computeKey(
    provider: string,
    model: string,
    messages: unknown[],
  ): Promise<string> {
    const raw = JSON.stringify({ provider, model, messages });
    const encoded = new TextEncoder().encode(raw);
    const hash = await crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function evict(): void {
    while (cache.size >= MAX_ENTRIES && accessOrder.length > 0) {
      const oldest = accessOrder.shift()!;
      cache.delete(oldest);
    }
  }

  function touch(key: string): void {
    const idx = accessOrder.indexOf(key);
    if (idx !== -1) {
      accessOrder.splice(idx, 1);
    }
    accessOrder.push(key);
  }

  return {
    name: "cache",

    async execute(ctx: PipelineContext): Promise<PipelineResult> {
      if (!config.enabled) {
        return "continue";
      }

      const key = await computeKey(ctx.provider, ctx.model, ctx.messages);
      ctx.metadata.cacheKey = key;

      const isResponsePhase = ctx.metadata.providerResponse !== undefined;

      if (!isResponsePhase) {
        const entry = cache.get(key);
        if (entry && Date.now() - entry.createdAt < config.ttl * 1000) {
          hits++;
          touch(key);
          ctx.metadata.providerResponse = entry.response;
          ctx.metadata.cacheHit = true;
          ctx.metadata.cacheStats = { hits, misses, size: cache.size };
          return "short-circuit";
        }
        misses++;
        ctx.metadata.cacheHit = false;
        return "continue";
      }

      evict();
      const entry: CacheEntry = {
        response: ctx.metadata.providerResponse,
        createdAt: Date.now(),
        key,
      };
      cache.set(key, entry);
      touch(key);
      ctx.metadata.cacheStats = { hits, misses, size: cache.size };
      return "continue";
    },
  };
}
