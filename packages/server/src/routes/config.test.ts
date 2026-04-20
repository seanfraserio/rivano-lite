import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { interpolateEnvVars, type RivanoConfig } from "@rivano/core";
import Fastify, { type FastifyInstance } from "fastify";
import type { ServerState } from "../state.js";
import { registerConfigRoutes, sanitizeYamlObj } from "./config.js";

describe("sanitizeYamlObj", () => {
  test("removes own enumerable __proto__ property", () => {
    // Plain objects { __proto__: { evil: true } } set the prototype, not an own property.
    // Object.entries() won't enumerate it, so sanitizeYamlObj can't filter it.
    // Use Object.defineProperty to create an actual own enumerable property:
    const obj = { safe: "value" };
    Object.defineProperty(obj, "__proto__", { value: { evil: true }, enumerable: true, configurable: true });
    const sanitized = sanitizeYamlObj(obj);
    expect(Object.hasOwn(sanitized, "__proto__")).toBe(false);
    expect((sanitized as Record<string, unknown>).safe).toBe("value");
  });

  test("removes own enumerable constructor property", () => {
    const obj = { constructor: { evil: true }, safe: "value" };
    const sanitized = sanitizeYamlObj(obj);
    expect(Object.hasOwn(sanitized, "constructor")).toBe(false);
    expect((sanitized as Record<string, unknown>).safe).toBe("value");
  });

  test("removes own enumerable prototype property", () => {
    const obj = { prototype: "evil", safe: "value" };
    const sanitized = sanitizeYamlObj(obj);
    expect(Object.hasOwn(sanitized, "prototype")).toBe(false);
  });

  test("recursively sanitizes nested objects", () => {
    const inner = { constructor: { evil: true }, safe: "value" };
    const level1 = { safe: "level1" };
    Object.defineProperty(level1, "__proto__", { value: { evil: true }, enumerable: true, configurable: true });
    Object.defineProperty(level1, "level2", { value: inner, enumerable: true });
    const obj = { level1 };

    const sanitized = sanitizeYamlObj(obj);
    const result = sanitized as Record<string, unknown>;
    // Extract into typed variables so TypeScript can track nullability
    const level1Obj = result.level1 as Record<string, unknown> | undefined;
    if (!level1Obj) throw new Error("level1 missing");
    expect(Object.hasOwn(level1Obj, "__proto__")).toBe(false);
    const level2Obj = level1Obj.level2 as Record<string, unknown> | undefined;
    if (!level2Obj) throw new Error("level2 missing");
    expect(Object.hasOwn(level2Obj, "constructor")).toBe(false);
    expect(level2Obj).toHaveProperty("safe", "value");
  });

  test("recursively sanitizes arrays", () => {
    const obj1 = { safe: "value" };
    Object.defineProperty(obj1, "__proto__", { value: "evil", enumerable: true, configurable: true });
    const obj2 = { constructor: "evil", safe: "value" };
    const obj = [obj1, obj2];
    const sanitized = sanitizeYamlObj(obj) as Array<Record<string, unknown>>;
    expect(Object.hasOwn(sanitized[0], "__proto__")).toBe(false);
    expect(Object.hasOwn(sanitized[1], "constructor")).toBe(false);
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
    // Masking: first 4 chars + '****'
    expect(body.providers.openai.api_key).toBe("sk-t****");
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

  test("POST /api/config/validate returns 400 when yaml field is missing", async () => {
    registerConfigRoutes(app, state, async () => {});

    const response = await app.inject({
      method: "POST",
      url: "/api/config/validate",
      headers: { "content-type": "application/json" },
      payload: { something: "else" },
    });

    // Route returns 400 status when yaml field is missing
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.valid).toBe(false);
    expect(body.errors).toContain("Missing yaml field");
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
  /* biome-ignore lint/suspicious/noTemplateCurlyInString: ${VAR} is intentional literal for interpolateEnvVars */
  test("replaces ${VAR} with environment variable values", () => {
    process.env.TEST_VAR = "hello";
    /* biome-ignore lint/suspicious/noTemplateCurlyInString: ${VAR} is intentional literal for interpolateEnvVars */
    const result = interpolateEnvVars("Hello ${TEST_VAR}!", { strict: true });
    expect(result).toBe("Hello hello!");
    delete process.env.TEST_VAR;
  });

  test("leaves unset variables as placeholders with strict: false", () => {
    delete process.env.UNSET_TEST_VAR;
    /* biome-ignore lint/suspicious/noTemplateCurlyInString: ${VAR} is intentional literal for interpolateEnvVars */
    const result = interpolateEnvVars("Value: ${UNSET_TEST_VAR}");
    /* biome-ignore lint/suspicious/noTemplateCurlyInString: expects same ${VAR} format back */
    expect(result).toBe("Value: ${UNSET_TEST_VAR}");
  });

  test("throws with strict: true when variables are missing", () => {
    delete process.env.STRICT_TEST_VAR;
    /* biome-ignore lint/suspicious/noTemplateCurlyInString: ${VAR} is intentional literal for interpolateEnvVars */
    expect(() => interpolateEnvVars("Value: ${STRICT_TEST_VAR}", { strict: true })).toThrow(
      /Unresolved environment variables/,
    );
  });
});
