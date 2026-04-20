import { afterEach, describe, expect, test } from "bun:test";
import type { Trace } from "@rivano/core";
import { createProxyServer, type ProxyOptions } from "../src/index.js";

// ── Helpers ──────────────────────────────────────────────────

interface TestServer {
  app: ReturnType<typeof createProxyServer>;
  providerCalls: Array<{ path: string; body: unknown; headers: Record<string, string> }>;
  traces: Trace[];
}

function createTestServer(
  configOverrides: Record<string, unknown> = {},
  providerOverrides: Record<string, unknown> = {},
): TestServer {
  const providerCalls: TestServer["providerCalls"] = [];
  const traces: TestServer["traces"] = [];

  const config = {
    default_provider: "openai",
    policies: [],
    rate_limit: { requests_per_minute: 1000, burst: 1000 },
    cache: { enabled: false, ttl: 60, maxEntries: 100 },
    ...configOverrides,
  };

  const providers = {
    openai: {
      base_url: "http://localhost:9999",
      api_key: "test-key",
      ...providerOverrides,
    },
  };

  const options: ProxyOptions = {
    onTrace: (trace: Trace) => {
      traces.push(trace);
    },
  };

  const app = createProxyServer(config, providers, options);

  // Intercept the provider call by monkey-patching the internal provider function
  // The server creates providers via createProvider(), which calls fetch() to the base_url.
  // We mock fetch to capture calls.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
    const path = new URL(url).pathname + new URL(url).search;
    const body = init?.body ? JSON.parse(init.body as string) : {};
    const headers: Record<string, string> = {};
    if (init?.headers) {
      if (typeof init.headers === "string") {
        headers["content-type"] = init.headers;
      } else if (Array.isArray(init.headers)) {
        for (const [k, v] of init.headers as [string, string][]) {
          headers[k] = v;
        }
      } else if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => {
          headers[k] = v;
        });
      } else if (typeof init.headers === "object") {
        Object.assign(headers, init.headers);
      }
    }

    providerCalls.push({ path, body, headers });

    return new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "test response" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  // Restore fetch after each test
  const afterEachRestore = () => {
    globalThis.fetch = originalFetch;
  };

  return {
    app,
    providerCalls,
    traces,
    _afterEach: afterEachRestore,
  };
}

afterEach(() => {
  // Always restore fetch even if test fails
  globalThis.fetch = originalGlobalFetch;
});

const originalGlobalFetch = globalThis.fetch;

// ── Request Validation ───────────────────────────────────────

describe("Request validation", () => {
  test("accepts request without messages (schema allows optional)", async () => {
    const { app, _afterEach: _cleanup } = createTestServer();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "gpt-4" },
    });
    // Zod schema has messages: .optional() — missing messages is valid
    expect(res.statusCode).toBe(200);
    _cleanup();
  });

  test("accepts valid request body", async () => {
    const { app, providerCalls, _afterEach: _cleanup } = createTestServer();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "hello" }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(providerCalls).toHaveLength(1);
    _cleanup();
  });

  test("accepts stream request", async () => {
    const { app, providerCalls, _afterEach: _cleanup } = createTestServer();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(providerCalls).toHaveLength(1);
    _cleanup();
  });

  test("rejects invalid temperature (out of range)", async () => {
    const { app, _afterEach: _cleanup } = createTestServer();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "hello" }],
        temperature: 5,
      },
    });
    expect(res.statusCode).toBe(400);
    _cleanup();
  });
});

// ── Full Request Lifecycle ───────────────────────────────────

describe("Full request lifecycle", () => {
  test("propagates provider response through the server", async () => {
    const { app, providerCalls, traces, _afterEach: _cleanup } = createTestServer();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "hello" }],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { choices: unknown[] };
    expect(body.choices).toHaveLength(1);

    // Provider was called with correct path and body
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0].path).toBe("/v1/chat/completions");
    expect((providerCalls[0].body as { messages: unknown[] }).messages).toHaveLength(1);

    // Trace emitted to observer callback
    expect(traces).toHaveLength(1);
    expect(traces[0].source).toBe("proxy");
    expect(traces[0].spans).toHaveLength(1);
    expect(traces[0].spans[0].type).toBe("llm_call");

    _cleanup();
  });

  test("extracts tokens from provider response", async () => {
    const { app, traces, _afterEach: _cleanup } = createTestServer();
    await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "hello" }],
      },
    });

    expect(traces).toHaveLength(1);
    const span = traces[0].spans[0];
    expect(span.estimatedCostUsd).toBeGreaterThan(0);
    _cleanup();
  });

  test("passes custom headers to provider", async () => {
    const { app, providerCalls, _afterEach: _cleanup } = createTestServer();
    await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "hello" }],
      },
      headers: {
        "x-custom-header": "custom-value",
      },
    });

    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0].headers["x-custom-header"]).toBe("custom-value");
    _cleanup();
  });

  test("detects provider from path when no header set", async () => {
    // /v1/messages maps to anthropic provider, which is NOT in our test providers
    // So it should return 400 "Provider not configured"
    const { app, _afterEach: _cleanup } = createTestServer();
    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      payload: {
        model: "claude-3",
        messages: [{ role: "user", content: "hello" }],
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload) as { error: string };
    expect(body.error).toBe("Provider not configured: anthropic");
    _cleanup();
  });
});

// ── Health & Stats ───────────────────────────────────────────

describe("Health & Stats", () => {
  test("health endpoint returns ok", async () => {
    const { app, _afterEach: _cleanup } = createTestServer();
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { status: string };
    expect(body.status).toBe("ok");
    _cleanup();
  });

  test("stats track request count", async () => {
    const { app, _afterEach: _cleanup } = createTestServer();

    // Make a request
    await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "hello" }],
      },
    });

    // Check stats
    const res = await app.inject({
      method: "GET",
      url: "/stats",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { requests: number };
    expect(body.requests).toBe(1);
    _cleanup();
  });

  test("stats tracks block count", async () => {
    const { app, _afterEach: _cleanup } = createTestServer({
      policies: [
        {
          name: "block-hello",
          on: "request",
          condition: { contains: "blockthis" },
          action: "block",
        },
      ],
    });

    // Make a blocked request
    await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "blockthis" }],
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/stats",
    });
    const body = JSON.parse(res.payload) as { blocks: number };
    expect(body.blocks).toBeGreaterThanOrEqual(1);
    _cleanup();
  });
});

// ── Provider Error Handling ──────────────────────────────────

describe("Provider error handling", () => {
  test("returns 502 when provider fetch fails", async () => {
    const { app, _afterEach: _cleanup } = createTestServer();

    // Override fetch to throw
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("Connection refused");
    };

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "hello" }],
      },
    });

    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.payload) as { error: string };
    expect(body.error).toBe("Connection refused");

    globalThis.fetch = origFetch;
    _cleanup();
  });

  test("falls back to default provider for unknown path", async () => {
    // When no header and path doesn't match known paths, default_provider is used
    const {
      app,
      providerCalls,
      _afterEach: _cleanup,
    } = createTestServer({
      default_provider: "openai",
    });
    const res = await app.inject({
      method: "POST",
      url: "/unknown/path",
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "hello" }],
      },
    });
    // Falls back to openai (default_provider), returns 200
    expect(res.statusCode).toBe(200);
    expect(providerCalls).toHaveLength(1);
    _cleanup();
  });
});

// ── Provider Selection ───────────────────────────────────────

describe("Provider selection", () => {
  test("uses x-rivano-provider header to override default", async () => {
    const {
      app,
      providerCalls,
      _afterEach: _cleanup,
    } = createTestServer({ default_provider: "openai" }, { base_url: "http://localhost:9999" });

    const res = await app.inject({
      method: "POST",
      url: "/v1/messages", // anthropic path, but we'll override
      payload: {
        model: "claude-3",
        messages: [{ role: "user", content: "hello" }],
      },
      headers: { "x-rivano-provider": "openai" },
    });

    expect(res.statusCode).toBe(200);
    // Should call openai base_url
    expect(providerCalls[0].path).toBe("/v1/messages");
    _cleanup();
  });

  test("uses default provider when no header or path match", async () => {
    const { app, _afterEach: _cleanup } = createTestServer({
      default_provider: "openai",
    });

    // Post to arbitrary path that doesn't match known provider paths
    const res = await app.inject({
      method: "POST",
      url: "/some/arbitrary/path",
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "hello" }],
      },
    });

    // Should use default provider (openai) and call it
    expect(res.statusCode).toBe(200);
    _cleanup();
  });
});

// ── Audit Trace Emission ─────────────────────────────────────

describe("Audit trace emission", () => {
  test("emits trace with action=allowed for successful request", async () => {
    const { app, traces, _afterEach: _cleanup } = createTestServer();
    await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "hello" }],
      },
    });

    expect(traces).toHaveLength(1);
    const trace = traces[0];
    expect(trace.metadata?.action).toBe("allowed");
    expect(trace.totalCostUsd).toBeGreaterThan(0);
    expect(trace.startTime).toBeGreaterThan(0);
    expect(trace.endTime).toBeGreaterThanOrEqual(trace.startTime);
    _cleanup();
  });

  test("emits trace with action=blocked when policy blocks", async () => {
    const {
      app,
      traces,
      _afterEach: _cleanup,
    } = createTestServer({
      policies: [
        {
          name: "block-vip",
          on: "request",
          condition: { contains: "vip" },
          action: "block",
        },
      ],
    });
    await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "you vip person" }],
      },
    });

    expect(traces).toHaveLength(1);
    expect(traces[0].metadata?.action).toBe("blocked");
    _cleanup();
  });
});

// ── Edge Cases ───────────────────────────────────────────────

describe("Edge cases", () => {
  test("handles empty messages array", async () => {
    const { app, _afterEach: _cleanup } = createTestServer();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4",
        messages: [],
      },
    });
    // Fastify/zod schema allows empty messages array — provider receives it
    expect(res.statusCode).toBe(200);
    _cleanup();
  });

  test("handles messages with null content", async () => {
    const { app, _afterEach: _cleanup } = createTestServer();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: null as unknown as string }],
      },
    });
    // Zod .passthrough() allows extra fields, null content passes
    expect(res.statusCode).toBe(200);
    _cleanup();
  });

  test("handles very long message content", async () => {
    const { app, _afterEach: _cleanup } = createTestServer();
    const longContent = "x".repeat(50_000);
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: longContent }],
      },
    });
    expect(res.statusCode).toBe(200);
    _cleanup();
  });

  test("health endpoint included in stats when no requests made", async () => {
    const { app, _afterEach: _cleanup } = createTestServer();
    const res = await app.inject({
      method: "GET",
      url: "/stats",
    });
    // When requests is 0, the server uses total=1 to avoid division by zero
    const body = JSON.parse(res.payload) as { requests: number; cacheHitRate: number };
    expect(body.requests).toBe(0);
    expect(body.cacheHitRate).toBe(0);
    _cleanup();
  });
});
