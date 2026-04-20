import { describe, expect, test } from "bun:test";
import Fastify from "fastify";
import type { ServerState } from "../state";
import { registerTraceRoutes } from "./traces";

const traces = [
  {
    id: "trace-allowed",
    source: "proxy",
    startTime: 1_000,
    endTime: 2_000,
    totalCostUsd: 0.02,
    spans: [
      {
        id: "span-1",
        type: "llm_call",
        name: "allowed",
        startTime: 1_000,
        endTime: 2_000,
        estimatedCostUsd: 0.02,
        metadata: {
          model: "gpt-4o",
          action: "allowed",
        },
      },
    ],
  },
  {
    id: "trace-blocked",
    source: "proxy",
    startTime: 5_000,
    endTime: 6_000,
    totalCostUsd: 0.15,
    spans: [
      {
        id: "span-2",
        type: "llm_call",
        name: "blocked",
        startTime: 5_000,
        endTime: 6_000,
        estimatedCostUsd: 0.15,
        metadata: {
          model: "claude-sonnet-4-5",
          action: "blocked",
        },
      },
    ],
  },
];

function createState(): ServerState {
  return {
    config: {
      version: "1",
      providers: {},
      proxy: {
        port: 4000,
        default_provider: "ollama",
        cache: {
          enabled: true,
          ttl: 3600,
        },
        rate_limit: {
          requests_per_minute: 120,
        },
        policies: [],
      },
      observer: {
        port: 4100,
        storage: "sqlite",
        retention_days: 30,
        evaluators: ["latency"],
      },
      agents: [],
    },
    proxy: null,
    observer: null,
    webuiApp: null,
    storage: {
      insertTrace: async () => {},
      listTraces: () => ({ traces, total: traces.length }),
      getTrace: (id: string) => traces.find((trace) => trace.id === id) ?? null,
      getStats: () => ({
        totalTraces: traces.length,
        totalSpans: 2,
        avgLatencyMs: 1000,
        totalCostUsd: 0.17,
        tracesPerDay: {},
      }),
      deleteOlderThan: () => 0,
      close: () => {},
    } as unknown as ServerState["storage"],
    agents: new Map(),
    logBuffer: [],
    startedAt: Date.now(),
    shuttingDown: false,
    bufferLog: () => {},
  };
}

describe("trace routes", () => {
  test("GET /api/traces filters by since, model, status, and cost range", async () => {
    const app = Fastify();
    registerTraceRoutes(app, createState());

    const response = await app.inject({
      method: "GET",
      url: "/api/traces?since=3000&model=claude-sonnet-4-5&status=blocked&minCostUsd=0.1&maxCostUsd=0.2",
    });

    const data = response.json() as { traces: typeof traces; total: number };

    expect(response.statusCode).toBe(200);
    expect(data).toEqual({
      traces: [traces[1]],
      total: 1,
    });
  });

  test("GET /api/traces scans past the first 5000 traces when derived filters are present", async () => {
    const app = Fastify();
    const largeTraceSet = Array.from({ length: 6001 }, (_, index) => ({
      id: `trace-${index}`,
      source: "proxy",
      startTime: index,
      endTime: index + 1,
      totalCostUsd: index === 6000 ? 0.25 : 0.01,
      spans: [
        {
          id: `span-${index}`,
          type: "llm_call" as const,
          name: index === 6000 ? "late-match" : "early-trace",
          startTime: index,
          endTime: index + 1,
          estimatedCostUsd: index === 6000 ? 0.25 : 0.01,
          metadata: {
            model: index === 6000 ? "claude-sonnet-4-5" : "gpt-4o",
            action: index === 6000 ? "blocked" : "allowed",
          },
        },
      ],
    }));

    let callCount = 0;
    registerTraceRoutes(app, {
      ...createState(),
      storage: {
        insertTrace: async () => {},
        listTraces: ({ limit, offset }: { limit: number; offset: number }) => {
          callCount++;
          return {
            traces: largeTraceSet.slice(offset, offset + limit),
            total: largeTraceSet.length,
          };
        },
        getTrace: (id: string) => largeTraceSet.find((trace) => trace.id === id) ?? null,
        getStats: () => ({
          totalTraces: largeTraceSet.length,
          totalSpans: largeTraceSet.length,
          avgLatencyMs: 1,
          totalCostUsd: 60.25,
          tracesPerDay: {},
        }),
        deleteOlderThan: () => 0,
        close: () => {},
      } as unknown as ServerState["storage"],
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/traces?model=claude-sonnet-4-5&status=blocked&minCostUsd=0.2",
    });

    const data = response.json() as {
      traces: Array<{ id: string }>;
      total: number;
    };

    expect(response.statusCode).toBe(200);
    expect(data.total).toBe(1);
    expect(data.traces.map((trace) => trace.id)).toEqual(["trace-6000"]);
    expect(callCount).toBeGreaterThan(1);

    await app.close();
  });

  test("GET /api/traces without derived filters uses storage directly", async () => {
    let capturedOpts: { limit: number; offset: number } | null = null;
    const storageMock = {
      ...createState().storage,
      listTraces: (opts: { limit: number; offset: number }) => {
        capturedOpts = opts;
        return createState().storage?.listTraces(opts);
      },
    };

    const app = Fastify();
    registerTraceRoutes(app, { ...createState(), storage: storageMock as any });

    await app.inject({
      method: "GET",
      url: "/api/traces?limit=20&offset=10&source=proxy",
    });

    expect(capturedOpts?.limit).toBe(20);
    expect(capturedOpts?.offset).toBe(10);
    expect(capturedOpts?.source).toBe("proxy");

    await app.close();
  });

  test("GET /api/traces/:id returns single trace", async () => {
    const app = Fastify();
    registerTraceRoutes(app, createState());

    const response = await app.inject({
      method: "GET",
      url: "/api/traces/trace-allowed",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { id: string };
    expect(body.id).toBe("trace-allowed");
  });

  test("GET /api/traces/:id returns 404 for missing trace", async () => {
    const app = Fastify();
    registerTraceRoutes(app, createState());

    const response = await app.inject({
      method: "GET",
      url: "/api/traces/nonexistent",
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toBe("Trace not found");

    await app.close();
  });

  test("GET /api/traces/stats returns aggregate stats", async () => {
    const app = Fastify();
    registerTraceRoutes(app, createState());

    const response = await app.inject({
      method: "GET",
      url: "/api/traces/stats",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      totalTraces: number;
      totalSpans: number;
      avgLatencyMs: number;
      totalCostUsd: number;
    };
    expect(body.totalTraces).toBe(2);
    expect(body.totalSpans).toBe(2);
    expect(body.totalCostUsd).toBeCloseTo(0.17, 2);

    await app.close();
  });

  test("GET /api/traces returns empty result when no storage", async () => {
    const app = Fastify();
    registerTraceRoutes(app, { ...createState(), storage: null });

    const response = await app.inject({
      method: "GET",
      url: "/api/traces",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { traces: unknown[]; total: number };
    expect(body.traces).toEqual([]);
    expect(body.total).toBe(0);

    await app.close();
  });

  test("GET /api/traces/stats returns zero stats when no storage", async () => {
    const app = Fastify();
    registerTraceRoutes(app, { ...createState(), storage: null });

    const response = await app.inject({
      method: "GET",
      url: "/api/traces/stats",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      totalTraces: number;
      totalSpans: number;
      avgLatencyMs: number;
      totalCostUsd: number;
      tracesPerDay: Record<string, number>;
    };
    expect(body.totalTraces).toBe(0);
    expect(body.tracesPerDay).toEqual({});

    await app.close();
  });

  test("GET /api/traces/:id returns 503 when no storage", async () => {
    const app = Fastify();
    registerTraceRoutes(app, { ...createState(), storage: null });

    const response = await app.inject({
      method: "GET",
      url: "/api/traces/any-id",
    });

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toBe("Storage not ready");

    await app.close();
  });

  test("DELETE /api/traces deletes old traces and returns count", async () => {
    let deleted = 0;
    const storageMock = {
      ...createState().storage,
      deleteOlderThan: () => {
        deleted = 5;
        return deleted;
      },
    } as any;

    const app = Fastify();
    registerTraceRoutes(app, { ...createState(), storage: storageMock });

    const response = await app.inject({
      method: "DELETE",
      url: "/api/traces",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { deleted: number };
    expect(body.deleted).toBe(5);

    await app.close();
  });

  test("DELETE /api/traces uses retention_days from config when no storage", async () => {
    const app = Fastify();
    registerTraceRoutes(app, { ...createState(), storage: null });

    const response = await app.inject({
      method: "DELETE",
      url: "/api/traces",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { deleted: number };
    expect(body.deleted).toBe(0);

    await app.close();
  });
});
