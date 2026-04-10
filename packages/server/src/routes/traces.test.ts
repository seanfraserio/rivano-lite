import { describe, expect, test } from "bun:test";
import Fastify from "fastify";
import { registerTraceRoutes } from "./traces";
import type { ServerState } from "../state";

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
});
