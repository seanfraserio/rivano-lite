import { describe, expect, test } from "bun:test";
import Fastify from "fastify";
import { registerConfigRoutes } from "./config";
import type { ServerState } from "../state";

function createState(): ServerState {
  return {
    config: {
      version: "1",
      providers: {
        ollama: {
          base_url: "http://host.docker.internal:11434",
        },
      },
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
    storage: null,
    agents: new Map(),
    logBuffer: [],
    startedAt: Date.now(),
    shuttingDown: false,
    bufferLog: () => {},
  };
}

describe("config routes", () => {
  test("POST /api/config/validate rejects unresolved environment variables", async () => {
    const app = Fastify();
    registerConfigRoutes(app, createState(), async () => {});

    const response = await app.inject({
      method: "POST",
      url: "/api/config/validate",
      payload: {
        yaml: `version: "1"

providers:
  anthropic:
    api_key: \${MISSING_VALIDATE_KEY}

proxy:
  port: 4000
  default_provider: anthropic
  cache:
    enabled: true
    ttl: 3600
  rate_limit:
    requests_per_minute: 120
  policies: []

observer:
  port: 4100
  storage: sqlite
  retention_days: 30
  evaluators:
    - latency

agents: []
`,
      },
    });

    const data = response.json() as { valid: boolean; errors?: string[] };

    expect(response.statusCode).toBe(200);
    expect(data.valid).toBe(false);
    expect(data.errors?.[0]).toMatch(/MISSING_VALIDATE_KEY/);
  });
});
