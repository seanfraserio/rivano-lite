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
  maxEntries?: number;
}

// Linked-list node for O(1) LRU eviction
class CacheNode {
  key: string;
  entry: CacheEntry;
  prev: CacheNode | null = null;
  next: CacheNode | null = null;

  constructor(key: string, entry: CacheEntry) {
    this.key = key;
    this.entry = entry;
  }
}

class LRUCache {
  private map = new Map<string, CacheNode>();
  private head: CacheNode | null = null; // most recent
  private tail: CacheNode | null = null; // least recent
  private _hits = 0;
  private _misses = 0;
  private maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  };

  get hits() { return this._hits; }
  get misses() { return this._misses; }
  get size() { return this.map.size; }

  get(key: string): CacheEntry | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;
    this.moveToHead(node);
    return node.entry;
  }

  set(key: string, entry: CacheEntry): void {
    const existing = this.map.get(key);
    if (existing) {
      existing.entry = entry;
      this.moveToHead(existing);
      return;
    }

    const node = new CacheNode(key, entry);
    this.map.set(key, node);
    this.addToHead(node);

    // Evict least recently used if over capacity
    while (this.map.size > this.maxEntries && this.tail) {
      const removed = this.evictTail();
      if (!removed) break;
    }
  }

  incrementMisses(): void { this._misses++; }
  incrementHits(): void { this._hits++; }

  private moveToHead(node: CacheNode): void {
    if (node === this.head) return;
    this.removeNode(node);
    this.addToHead(node);
  }

  private addToHead(node: CacheNode): void {
    node.prev = null;
    node.next = this.head;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  private removeNode(node: CacheNode): void {
    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;
    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;
    node.prev = null;
    node.next = null;
  }

  private evictTail(): CacheNode | null {
    if (!this.tail) return null;
    const node = this.tail;
    this.removeNode(node);
    this.map.delete(node.key);
    return node;
  }
}

export function createCacheMiddleware(config: CacheConfig): Middleware {
  const cache = new LRUCache(config.maxEntries);

  async function computeKey(
    provider: string,
    model: string,
    messages: unknown[],
    params?: unknown,
  ): Promise<string> {
    // Include messages + all request parameters that affect the response
    const raw = JSON.stringify({ provider, model, messages, params });
    const encoded = new TextEncoder().encode(raw);
    const hash = await crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  return {
    name: "cache",

    async execute(ctx: PipelineContext): Promise<PipelineResult> {
      if (!config.enabled) {
        return "continue";
      }

      const key = await computeKey(ctx.provider, ctx.model, ctx.messages, {
        temperature: (ctx.metadata as Record<string, unknown>).temperature,
        max_tokens: (ctx.metadata as Record<string, unknown>).max_tokens,
      });
      ctx.metadata.cacheKey = key;

      const isResponsePhase = ctx.metadata.providerResponse !== undefined;

      if (!isResponsePhase) {
        const entry = cache.get(key);
        if (entry && Date.now() - entry.createdAt < config.ttl * 1000) {
          cache.incrementHits();
          ctx.metadata.providerResponse = entry.response;
          ctx.metadata.cacheHit = true;
          ctx.metadata.cacheStats = { hits: cache.hits, misses: cache.misses, size: cache.size };
          return "short-circuit";
        }
        cache.incrementMisses();
        ctx.metadata.cacheHit = false;
        return "continue";
      }

      const entry: CacheEntry = {
        response: ctx.metadata.providerResponse,
        createdAt: Date.now(),
        key,
      };
      cache.set(key, entry);
      ctx.metadata.cacheStats = { hits: cache.hits, misses: cache.misses, size: cache.size };
      return "continue";
    },
  };
}
