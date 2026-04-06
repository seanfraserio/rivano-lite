import { loadConfig, validateConfig, type RivanoConfig, type AgentConfig } from "@rivano/core";
import { createProxyServer } from "@rivano/proxy";
import { createObserverServer, createStorage, type Storage } from "@rivano/observer";
import { deploy } from "@rivano/engine";
import { watch } from "fs";
import { readFile, writeFile, stat } from "fs/promises";
import { resolve, join } from "path";
import YAML from "js-yaml";

const BANNER = `
  ┌─────────────────────────────────────┐
  │         Rivano Lite v0.1.0          │
  │   Open Source AI Operations Platform │
  └─────────────────────────────────────┘
`;

const DATA_DIR = process.env.RIVANO_DATA_DIR || "/data";
const CONFIG_PATH = process.env.RIVANO_CONFIG || resolve(DATA_DIR, "rivano.yaml");
const DB_PATH = resolve(DATA_DIR, "traces.db");
const STATE_PATH = resolve(DATA_DIR, "state.json");
const WEBUI_PORT = parseInt(process.env.RIVANO_WEBUI_PORT || "9000", 10);

interface ServerState {
  config: RivanoConfig;
  proxy: Awaited<ReturnType<typeof createProxyServer>> | null;
  observer: Awaited<ReturnType<typeof createObserverServer>> | null;
  storage: Storage | null;
  agents: Map<string, { config: AgentConfig; deployedAt: string }>;
  logBuffer: LogEntry[];
  startedAt: number;
  shuttingDown: boolean;
}

interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

const MAX_LOG_BUFFER = 500;

const state: ServerState = {
  config: null!,
  proxy: null,
  observer: null,
  storage: null,
  agents: new Map(),
  logBuffer: [],
  startedAt: Date.now(),
  shuttingDown: false,
};

function bufferLog(level: LogEntry["level"], message: string) {
  state.logBuffer.push({
    timestamp: new Date().toISOString(),
    level,
    message,
  });
  if (state.logBuffer.length > MAX_LOG_BUFFER) {
    state.logBuffer.shift();
  }
}

async function loadAndValidateConfig(): Promise<RivanoConfig> {
  try {
    return await loadConfig(CONFIG_PATH);
  } catch (err) {
    console.error(`[rivano] Failed to load config from ${CONFIG_PATH}:`, err);
    console.error("[rivano] Starting with default configuration");
    return {
      version: "1",
      providers: {},
      proxy: {
        port: 4000,
        default_provider: "anthropic",
        cache: { enabled: false, ttl: 3600 },
        rate_limit: { requests_per_minute: 60 },
        policies: [],
      },
      observer: {
        port: 4100,
        storage: "sqlite",
        retention_days: 30,
        evaluators: ["latency", "cost"],
      },
      agents: [],
    };
  }
}

async function startProxy(config: RivanoConfig) {
  if (state.proxy) {
    await state.proxy.close();
  }
  state.proxy = await createProxyServer(config.proxy, config.providers, {
    onTrace: (trace) => {
      if (state.storage) {
        try {
          state.storage.insertTrace(trace);
        } catch (err) {
          bufferLog("error", `Failed to store trace: ${err}`);
        }
      }
    },
  });
  await state.proxy.listen({ port: config.proxy.port, host: "0.0.0.0" });
  bufferLog("info", `Proxy gateway listening on :${config.proxy.port}`);
  console.log(`[rivano] Proxy gateway listening on :${config.proxy.port}`);
}

async function startObserver(config: RivanoConfig) {
  if (state.observer) {
    await state.observer.close();
  }
  // Initialize shared storage for direct WebUI queries
  if (!state.storage) {
    state.storage = createStorage(DB_PATH);
  }
  state.observer = await createObserverServer(config.observer, DB_PATH);
  await state.observer.listen({ port: config.observer.port, host: "0.0.0.0" });
  bufferLog("info", `Observer listening on :${config.observer.port}`);
  console.log(`[rivano] Observer listening on :${config.observer.port}`);
}

async function deployAgents(config: RivanoConfig) {
  if (config.agents.length === 0) {
    bufferLog("info", "No agents defined — skipping deployment");
    console.log("[rivano] No agents defined — skipping deployment");
    return;
  }

  const results = await deploy(config.agents, STATE_PATH);
  for (const result of results) {
    if (result.success) {
      state.agents.set(result.agent, {
        config: config.agents.find((a) => a.name === result.agent)!,
        deployedAt: new Date().toISOString(),
      });
      if (result.action !== "unchanged") {
        bufferLog("info", `Agent "${result.agent}" ${result.action}d (${result.duration}ms)`);
        console.log(
          `[rivano] Agent "${result.agent}" ${result.action}d (${result.duration}ms)`
        );
      }
    } else {
      bufferLog("error", `Agent "${result.agent}" failed: ${result.error}`);
      console.error(
        `[rivano] Agent "${result.agent}" failed: ${result.error}`
      );
    }
  }
  console.log(
    `[rivano] ${state.agents.size} agent(s) registered`
  );
}

async function startWebUI() {
  const { default: Fastify } = await import("fastify");
  const { default: fastifyStatic } = await import("@fastify/static");

  const app = Fastify({ logger: false });

  // ── Static files (Astro static build output) ────────────────
  // Astro static mode outputs to dist/ (no client/server split)
  const possiblePaths = [
    resolve("/rivano/webui/dist"),
    resolve(import.meta.dir, "../../webui/dist"),
    resolve(process.cwd(), "packages/webui/dist"),
  ];
  let webuiDist: string | null = null;
  for (const p of possiblePaths) {
    try {
      await stat(resolve(p, "index.html"));
      webuiDist = p;
      break;
    } catch {}
  }

  if (webuiDist) {
    await app.register(fastifyStatic, {
      root: webuiDist,
      prefix: "/",
      wildcard: false,
    });

    // Serve Astro page HTML for known routes (Astro generates /page/index.html)
    const pageRoutes = ["proxy", "traces", "agents", "logs", "settings"];
    for (const route of pageRoutes) {
      app.get(`/${route}`, async (_req, reply) => {
        const html = await readFile(resolve(webuiDist!, route, "index.html"), "utf-8");
        reply.type("text/html").send(html);
      });
    }

    bufferLog("info", `WebUI serving static files from ${webuiDist}`);
  } else {
    bufferLog("warn", "WebUI static files not found — API-only mode");
  }

  // ── Health ─────────────────────────────────────────────────
  app.get("/health", async () => ({
    status: "ok",
    version: "0.1.0",
    uptime: Math.floor((Date.now() - state.startedAt) / 1000),
    services: {
      proxy: state.proxy ? "running" : "stopped",
      observer: state.observer ? "running" : "stopped",
      agents: state.agents.size,
    },
  }));

  // ── Status ─────────────────────────────────────────────────
  app.get("/api/status", async () => ({
    config: CONFIG_PATH,
    dataDir: DATA_DIR,
    version: "0.1.0",
    uptime: Math.floor((Date.now() - state.startedAt) / 1000),
    proxy: {
      port: state.config.proxy.port,
      providers: Object.keys(state.config.providers),
      policies: state.config.proxy.policies.length,
    },
    observer: {
      port: state.config.observer.port,
      storage: state.config.observer.storage,
      retentionDays: state.config.observer.retention_days,
    },
    agents: Array.from(state.agents.values()).map((a) => ({
      name: a.config.name,
      provider: a.config.model.provider,
      model: a.config.model.name,
      deployedAt: a.deployedAt,
    })),
  }));

  // ── Config read ────────────────────────────────────────────
  app.get("/api/config", async () => {
    const masked = JSON.parse(JSON.stringify(state.config));
    for (const [, provider] of Object.entries(masked.providers || {})) {
      const p = provider as Record<string, unknown>;
      if (p.api_key && typeof p.api_key === "string") {
        p.api_key = p.api_key.length > 8 ? "****" + p.api_key.slice(-4) : "****";
      }
    }
    return masked;
  });

  app.get("/api/config/raw", async () => {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return { yaml: raw };
  });

  // ── Config write ───────────────────────────────────────────
  app.put<{ Body: { yaml: string } }>("/api/config", async (request, reply) => {
    try {
      const { yaml } = request.body;
      if (!yaml || typeof yaml !== "string") {
        return reply.status(400).send({ ok: false, error: "Missing yaml field" });
      }

      if (yaml.length > 100_000) {
        return reply.status(400).send({ ok: false, error: "Config too large (max 100KB)" });
      }

      // Validate before writing — use safe YAML schema
      const parsed = YAML.load(yaml, { schema: YAML.JSON_SCHEMA });
      validateConfig(parsed);

      // Write atomically (tmp + rename)
      const tmpPath = CONFIG_PATH + ".tmp";
      await writeFile(tmpPath, yaml, "utf-8");
      const { rename } = await import("fs/promises");
      await rename(tmpPath, CONFIG_PATH);

      bufferLog("info", "Config updated via WebUI");
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      bufferLog("error", `Config update failed: ${message}`);
      return reply.status(400).send({ ok: false, error: "Configuration validation failed" });
    }
  });

  // ── Config validate ────────────────────────────────────────
  app.post<{ Body: { yaml: string } }>("/api/config/validate", async (request, reply) => {
    try {
      const { yaml } = request.body;
      if (!yaml || typeof yaml !== "string") {
        return reply.status(400).send({ valid: false, errors: ["Missing yaml field"] });
      }
      const parsed = YAML.load(yaml, { schema: YAML.JSON_SCHEMA });
      validateConfig(parsed);
      return { valid: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid config";
      return { valid: false, errors: [message] };
    }
  });

  // ── Traces ─────────────────────────────────────────────────
  app.get<{
    Querystring: { limit?: string; offset?: string; source?: string; since?: string };
  }>("/api/traces", async (request) => {
    if (!state.storage) return { traces: [], total: 0 };
    const { limit = "50", offset = "0", source, since } = request.query;
    return state.storage.listTraces({
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
      source: source || undefined,
      since: since ? parseInt(since, 10) : undefined,
    });
  });

  app.get<{ Params: { id: string } }>("/api/traces/:id", async (request, reply) => {
    if (!state.storage) return reply.status(503).send({ error: "Storage not ready" });
    const trace = state.storage.getTrace(request.params.id);
    if (!trace) return reply.status(404).send({ error: "Trace not found" });
    return trace;
  });

  app.get("/api/traces/stats", async () => {
    if (!state.storage) {
      return { totalTraces: 0, totalSpans: 0, avgLatencyMs: 0, totalCostUsd: 0, tracesPerDay: {} };
    }
    return state.storage.getStats();
  });

  app.delete("/api/traces", async () => {
    if (!state.storage) return { deleted: 0 };
    const deleted = state.storage.deleteOlderThan(state.config.observer.retention_days);
    bufferLog("info", `Purged ${deleted} traces older than ${state.config.observer.retention_days} days`);
    return { deleted };
  });

  // ── Logs ───────────────────────────────────────────────────
  app.get<{
    Querystring: { since?: string; level?: string };
  }>("/api/logs", async (request) => {
    let logs = state.logBuffer;
    const { since, level } = request.query;

    if (since) {
      const sinceDate = new Date(since);
      logs = logs.filter((l) => new Date(l.timestamp) > sinceDate);
    }

    if (level && level !== "all") {
      logs = logs.filter((l) => l.level === level);
    }

    return { logs };
  });

  // ── Storage info ───────────────────────────────────────────
  app.get("/api/storage", async () => {
    let dbSizeBytes = 0;
    try {
      const dbStat = await stat(DB_PATH);
      dbSizeBytes = dbStat.size;
    } catch {
      // DB may not exist yet
    }
    return {
      dbPath: DB_PATH,
      dbSizeBytes,
      dbSizeMB: Math.round((dbSizeBytes / 1024 / 1024) * 100) / 100,
    };
  });

  // ── Env file management ────────────────────────────────────
  app.get("/api/env", async () => {
    const envPath = join(DATA_DIR, ".env");
    try {
      const raw = await readFile(envPath, "utf-8");
      const keys = raw
        .split("\n")
        .filter((l) => l.includes("=") && !l.startsWith("#"))
        .map((l) => {
          const [key, ...rest] = l.split("=");
          const value = rest.join("=");
          const masked = value.length > 4 ? "****" + value.slice(-4) : "****";
          return { key: key.trim(), masked, hasValue: value.trim().length > 0 };
        });
      return { keys };
    } catch {
      return { keys: [] };
    }
  });

  const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

  function readEnvLines(envPath: string): Promise<string[]> {
    return readFile(envPath, "utf-8")
      .then((raw) => raw.split("\n"))
      .catch(() => []);
  }

  async function writeEnvLines(envPath: string, lines: string[]) {
    const content = lines.filter((l) => l.trim()).join("\n") + "\n";
    const tmpPath = envPath + ".tmp";
    await writeFile(tmpPath, content, "utf-8");
    const { rename } = await import("fs/promises");
    await rename(tmpPath, envPath);
  }

  app.put<{ Body: { key: string; value: string } }>("/api/env", async (request, reply) => {
    try {
      const { key, value } = request.body;
      if (!key || typeof key !== "string") {
        return reply.status(400).send({ ok: false, error: "Missing key" });
      }
      if (!ENV_KEY_PATTERN.test(key)) {
        return reply.status(400).send({ ok: false, error: "Invalid key: must be UPPER_SNAKE_CASE (e.g., ANTHROPIC_API_KEY)" });
      }
      if (typeof value !== "string" || value.includes("\n") || value.includes("\r")) {
        return reply.status(400).send({ ok: false, error: "Invalid value: must not contain newlines" });
      }

      const envPath = join(DATA_DIR, ".env");
      const lines = await readEnvLines(envPath);

      const existingIdx = lines.findIndex((l) => l.startsWith(`${key}=`));
      const newLine = `${key}=${value}`;
      if (existingIdx >= 0) {
        lines[existingIdx] = newLine;
      } else {
        lines.push(newLine);
      }

      await writeEnvLines(envPath, lines);
      bufferLog("info", `Environment variable ${key} updated`);
      return { ok: true };
    } catch (err) {
      return reply.status(500).send({ ok: false, error: "Failed to save environment variable" });
    }
  });

  app.delete<{ Body: { key: string } }>("/api/env", async (request, reply) => {
    try {
      const { key } = request.body;
      if (!key || typeof key !== "string" || !ENV_KEY_PATTERN.test(key)) {
        return reply.status(400).send({ ok: false, error: "Invalid key" });
      }

      const envPath = join(DATA_DIR, ".env");
      const lines = await readEnvLines(envPath);
      const filtered = lines.filter((l) => !l.startsWith(`${key}=`));

      if (filtered.length === lines.length) {
        return reply.status(404).send({ ok: false, error: "Key not found" });
      }

      await writeEnvLines(envPath, filtered);
      bufferLog("info", `Environment variable ${key} removed`);
      return { ok: true };
    } catch (err) {
      return reply.status(500).send({ ok: false, error: "Failed to remove environment variable" });
    }
  });

  await app.listen({ port: WEBUI_PORT, host: "0.0.0.0" });
  console.log(`[rivano] WebUI API listening on :${WEBUI_PORT}`);
}

function watchConfig() {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  watch(CONFIG_PATH, () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      bufferLog("info", "Config file changed — reloading...");
      console.log("[rivano] Config file changed — reloading...");
      try {
        const newConfig = await loadAndValidateConfig();
        state.config = newConfig;
        await startProxy(newConfig);
        await deployAgents(newConfig);
        bufferLog("info", "Reload complete");
        console.log("[rivano] Reload complete");
      } catch (err) {
        bufferLog("error", `Reload failed: ${err}`);
        console.error("[rivano] Reload failed:", err);
      }
    }, 500);
  });

  console.log(`[rivano] Watching ${CONFIG_PATH} for changes`);
}

async function shutdown(signal: string) {
  if (state.shuttingDown) return;
  state.shuttingDown = true;
  console.log(`\n[rivano] Received ${signal} — shutting down gracefully...`);

  const shutdowns: Promise<void>[] = [];
  if (state.proxy) shutdowns.push(state.proxy.close());
  if (state.observer) shutdowns.push(state.observer.close());

  await Promise.allSettled(shutdowns);
  console.log("[rivano] Shutdown complete");
  process.exit(0);
}

async function main() {
  console.log(BANNER);

  state.config = await loadAndValidateConfig();

  console.log(
    `[rivano] Config loaded — ${Object.keys(state.config.providers).length} provider(s), ${state.config.proxy.policies.length} policy/policies, ${state.config.agents.length} agent(s)`
  );

  await startObserver(state.config);
  await startProxy(state.config);
  await deployAgents(state.config);
  await startWebUI();
  watchConfig();

  console.log("\n[rivano] All systems operational");
  console.log(`[rivano] Proxy:    http://localhost:${state.config.proxy.port}`);
  console.log(
    `[rivano] Observer: http://localhost:${state.config.observer.port}`
  );
  console.log(`[rivano] WebUI:    http://localhost:${WEBUI_PORT}`);
  console.log("");

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[rivano] Fatal startup error:", err);
  process.exit(1);
});
