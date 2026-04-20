import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { interpolateEnvVars, type RivanoConfig } from "@rivano/core";
import Fastify, { type FastifyInstance } from "fastify";
import type { ServerState } from "../state.js";
import { registerConfigRoutes, sanitizeYamlObj } from "./config.js";

describe("sanitizeYamlObj", () => {
  test("removes __proto__ from objects", () => {
    const obj = { __proto__: { evil: true }, safe: "value" };
    const sanitized = sanitizeYamlObj(obj);
    expect(sanitized).not.toHaveProperty("__proto__");
    expect((sanitized as Record<string, unknown>).safe).toBe("value");
  });

  test("removes constructor from objects", () => {
    const obj = { constructor: "evil", safe: "value" };
    const sanitized = sanitizeYamlObj(obj);
    expect(sanitized).not.toHaveProperty("constructor");
    expect((sanitized as Record<string, unknown>).safe).toBe("value");
  });

  test("removes prototype from objects", () => {
    const obj = { prototype: "evil", safe: "value" };
    const sanitized = sanitizeYamlObj(obj);
    expect(sanitized).not.toHaveProperty("prototype");
  });

  test("sanitizes nested objects", () => {
    const obj = {
      level1: {
        __proto__: { evil: true },
        level2: {
          constructor: "evil",
          safe: "value",
        },
      },
    };
    const sanitized = sanitizeYamlObj(obj);
    const result = sanitized as Record<string, unknown>;
    expect(result.level1).not.toHaveProperty("__proto__");
    expect((result.level1 as Record<string, unknown>).level2).not.toHaveProperty("constructor");
    expect((result.level1 as Record<string, unknown>).level2).toHaveProperty("safe", "value");
  });

  test("sanitizes arrays", () => {
    const obj = [{ __proto__: "evil" }, { safe: "value" }];
    const sanitized = sanitizeYamlObj(obj) as Array<Record<string, unknown>>;
    expect(sanitized[0]).not.toHaveProperty("__proto__");
    expect(sanitized[1]).toHaveProperty("safe", "value");
  });

  test("passes through primitives", () => {
    expect(sanitizeYamlObj("string")).toBe("string");
    expect(sanitizeYamlObj(42)).toBe(42);
    expect(sanitizeYamlObj(true)).toBe(true);
    expect(sanitizeYamlObj(null)).toBe(null);
    expect(sanitizeYamlObj(undefined)).toBe(undefined);
  });
});

describe("registerConfigRoutes", () => {
  let app: FastifyInstance;
  let state: ServerState;

  beforeEach(() => {
    app = Fastify({ logger: false });
    const mockConfig: RivanoConfig = {
      version: "1",
      providers: {
        openai: { api_key: "sk-test-key-1234567890", base_url: "https://api.openai.com" },
      },
      proxy: {
        port: 4000,
        default_provider: "openai",
        cache: { enabled: false, ttl: 3600 },
        rate_limit: { requests_per_minute: 60 },
        policies: [],
      },
      observer: {
        port: 4100,
        storage: "sqlite",
        retention_days: 30,
        evaluators: [],
      },
      agents: [],
    };
    state = {
      config: mockConfig,
      proxy: null,
      observer: null,
      webuiApp: null,
      storage: null,
      agents: new Map(),
      logBuffer: [],
      startedAt: Date.now(),
      shuttingDown: false,
      bufferLog(level: string, message: string) {
        this.logBuffer.push({
          timestamp: new Date().toISOString(),
          level: level as "info" | "warn" | "error",
          message,
        });
      },
    };
  });

  afterEach(async () => {
    await app.close();
  });

  test("GET /api/config returns masked provider keys", async () => {
    registerConfigRoutes(app, state, async () => {});

    const response = await app.inject({
      method: "GET",
      url: "/api/config",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.providers.openai.api_key).toBe("sk-*");
  });

  test("GET /api/config masks short keys entirely", async () => {
    const shortKeyConfig: RivanoConfig = {
      version: "1",
      providers: {
        test: { api_key: "short" },
      },
      proxy: {
        port: 4000,
        default_provider: "openai",
        cache: { enabled: false, ttl: 3600 },
        rate_limit: { requests_per_minute: 60 },
        policies: [],
      },
      observer: { port: 4100, storage: "sqlite", retention_days: 30, evaluators: [] },
      agents: [],
    };
    const shortState: ServerState = {
      config: shortKeyConfig,
      proxy: null,
      observer: null,
      webuiApp: null,
      storage: null,
      agents: new Map(),
      logBuffer: [],
      startedAt: Date.now(),
      shuttingDown: false,
      bufferLog() {},
    };
    const shortApp = Fastify({ logger: false });
    registerConfigRoutes(shortApp, shortState, async () => {});

    const response = await shortApp.inject({ method: "GET", url: "/api/config" });
    const body = JSON.parse(response.body);
    expect(body.providers.test.api_key).toBe("****");
    await shortApp.close();
  });

  test("POST /api/config/validate returns valid for good config", async () => {
    registerConfigRoutes(app, state, async () => {});

    const response = await app.inject({
      method: "POST",
      url: "/api/config/validate",
      headers: { "content-type": "application/json" },
      payload: {
        yaml: `version: "1"
providers:
  openai:
    api_key: sk-test
proxy:
  port: 4000
  default_provider: openai
  cache:
    enabled: false
    ttl: 3600
  rate_limit:
    requests_per_minute: 60
  policies: []
observer:
  port: 4100
  storage: sqlite
  retention_days: 30
  evaluators: []
agents: []
`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.valid).toBe(true);
  });

  test("POST /api/config/validate returns errors for invalid config", async () => {
    registerConfigRoutes(app, state, async () => {});

    const response = await app.inject({
      method: "POST",
      url: "/api/config/validate",
      headers: { "content-type": "application/json" },
      payload: { yaml: "invalid: yaml: content:" },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.valid).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  test("POST /api/config/validate rejects missing yaml field", async () => {
    registerConfigRoutes(app, state, async () => {});

    const response = await app.inject({
      method: "POST",
      url: "/api/config/validate",
      headers: { "content-type": "application/json" },
      payload: { something: "else" },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.valid).toBe(false);
  });

  test("PUT /api/config rejects missing yaml field", async () => {
    registerConfigRoutes(app, state, async () => {});

    const response = await app.inject({
      method: "PUT",
      url: "/api/config",
      headers: { "content-type": "application/json" },
      payload: { something: "else" },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(false);
  });

  test("PUT /api/config rejects config that is too large", async () => {
    registerConfigRoutes(app, state, async () => {});
    const hugeYaml = `x: ${"a".repeat(100_001)}`;

    const response = await app.inject({
      method: "PUT",
      url: "/api/config",
      headers: { "content-type": "application/json" },
      payload: { yaml: hugeYaml },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toContain("too large");
  });
});

describe("interpolateEnvVars", () => {
  test("replaces ${VAR} with environment variable values", () => {
    process.env.TEST_VAR = "hello";
    const result = interpolateEnvVars("Hello ${TEST_VAR}!", { strict: true });
    expect(result).toBe("Hello hello!");
    delete process.env.TEST_VAR;
  });

  test("leaves unset variables as placeholders with strict: false", () => {
    delete process.env.UNSET_TEST_VAR;
    const result = interpolateEnvVars("Value: ${UNSET_TEST_VAR}");
    expect(result).toBe("Value: ${UNSET_TEST_VAR}");
  });

  test("throws with strict: true when variables are missing", () => {
    delete process.env.STRICT_TEST_VAR;
    expect(() => interpolateEnvVars("Value: ${STRICT_TEST_VAR}", { strict: true })).toThrow(
      /Unresolved environment variables/,
    );
  });
});
