import { loadConfig, validateConfig, type RivanoConfig } from "@rivano/core";
import { createProxyServer } from "@rivano/proxy";
import { createObserverServer, createStorage, type Storage } from "@rivano/observer";
import { deploy } from "@rivano/engine";
import { watch } from "fs";
import { readFile, writeFile, stat } from "fs/promises";
import { resolve } from "path";
import type { ServerState, LogEntry } from "./state.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerTraceRoutes } from "./routes/traces.js";
import { registerEnvRoutes } from "./routes/env.js";
import { registerSystemRoutes } from "./routes/system.js";

const VERSION = "0.1.0";

const BANNER = `
  ┌─────────────────────────────────────┐
  │         Rivano Lite v${VERSION}          │
  │   Open Source AI Operations Platform │
  └─────────────────────────────────────┘
`;

const DATA_DIR = process.env.RIVANO_DATA_DIR || "/data";
const CONFIG_PATH = process.env.RIVANO_CONFIG || resolve(DATA_DIR, "rivano.yaml");
const DB_PATH = resolve(DATA_DIR, "traces.db");
const STATE_PATH = resolve(DATA_DIR, "state.json");
const WEBUI_PORT = parseInt(process.env.RIVANO_WEBUI_PORT || "9000", 10);
const API_KEY = process.env.RIVANO_API_KEY;

let reloadInProgress = false;
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
  bufferLog(level, message) {
    state.logBuffer.push({ timestamp: new Date().toISOString(), level, message });
    if (state.logBuffer.length > MAX_LOG_BUFFER) state.logBuffer.shift();
  },
};

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
  if (state.proxy) await state.proxy.close();
  state.proxy = await createProxyServer(config.proxy, config.providers, {
    onTrace: (trace) => {
      if (state.storage) {
        try { state.storage.insertTrace(trace); }
        catch (err) { state.bufferLog("error", `Failed to store trace: ${err}`); }
      }
    },
  });
  await state.proxy.listen({ port: config.proxy.port, host: "0.0.0.0" });
  state.bufferLog("info", `Proxy gateway listening on :${config.proxy.port}`);
  console.log(`[rivano] Proxy gateway listening on :${config.proxy.port}`);
}

async function startObserver(config: RivanoConfig) {
  if (state.observer) await state.observer.close();
  if (!state.storage) state.storage = createStorage(DB_PATH);
  state.observer = await createObserverServer(config.observer, DB_PATH, { storage: state.storage });
  await state.observer.listen({ port: config.observer.port, host: "0.0.0.0" });
  state.bufferLog("info", `Observer listening on :${config.observer.port}`);
  console.log(`[rivano] Observer listening on :${config.observer.port}`);
}

async function deployAgents(config: RivanoConfig) {
  if (config.agents.length === 0) {
    // Clear any previously deployed agents
    state.agents.clear();
    state.bufferLog("info", "No agents defined — skipping deployment");
    console.log("[rivano] No agents defined — skipping deployment");
    return;
  }
  // Remove agents no longer in config
  for (const name of state.agents.keys()) {
    if (!config.agents.find((a) => a.name === name)) {
      state.agents.delete(name);
    }
  }

  const results = await deploy(config.agents, STATE_PATH);
  for (const result of results) {
    if (result.success) {
      state.agents.set(result.agent, {
        config: config.agents.find((a) => a.name === result.agent)!,
        deployedAt: new Date().toISOString(),
      });
      if (result.action !== "unchanged") {
        state.bufferLog("info", `Agent "${result.agent}" ${result.action}d (${result.duration}ms)`);
        console.log(`[rivano] Agent "${result.agent}" ${result.action}d (${result.duration}ms)`);
      }
    } else {
      state.bufferLog("error", `Agent "${result.agent}" failed: ${result.error}`);
      console.error(`[rivano] Agent "${result.agent}" failed: ${result.error}`);
    }
  }
  console.log(`[rivano] ${state.agents.size} agent(s) registered`);
}

async function reloadServices() {
  const newConfig = await loadAndValidateConfig();
  state.config = newConfig;
  await startObserver(newConfig);
  await startProxy(newConfig);
  await deployAgents(newConfig);
}

async function startWebUI() {
  const { default: Fastify } = await import("fastify");
  const { default: fastifyStatic } = await import("@fastify/static");

  const app = Fastify({ logger: false });

  // ── API authentication middleware ────────────────────────────
  if (!API_KEY) {
    console.warn("[rivano] WARNING: No RIVANO_API_KEY set — API endpoints are unauthenticated!");
    console.warn("[rivano] Set RIVANO_API_KEY environment variable to secure the API.");
  }

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api")) return;
    if (!API_KEY) return;
    const auth = request.headers["authorization"];
    if (auth === `Bearer ${API_KEY}`) return;
    return reply.status(401).send({ error: "Unauthorized: provide a valid API key via Authorization: Bearer <key>" });
  });

  // ── Static files (Astro build output) ────────────────────────
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
    await app.register(fastifyStatic, { root: webuiDist, prefix: "/", wildcard: false });
    for (const route of ["proxy", "traces", "agents", "logs", "settings"]) {
      app.get(`/${route}`, async (_req, reply) => {
        const html = await readFile(resolve(webuiDist!, route, "index.html"), "utf-8");
        reply.type("text/html").send(html);
      });
    }
    state.bufferLog("info", `WebUI serving static files from ${webuiDist}`);
  } else {
    state.bufferLog("warn", "WebUI static files not found — API-only mode");
  }

  // ── Register API route modules ──────────────────────────────
  registerSystemRoutes(app, state);
  registerConfigRoutes(app, state, reloadServices);
  registerTraceRoutes(app, state);
  registerEnvRoutes(app, state);

  await app.listen({ port: WEBUI_PORT, host: "0.0.0.0" });
  console.log(`[rivano] WebUI API listening on :${WEBUI_PORT}`);
}

function watchConfig() {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  watch(CONFIG_PATH, () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      if (reloadInProgress) {
        state.bufferLog("info", "Reload already in progress — skipping");
        return;
      }
      reloadInProgress = true;
      state.bufferLog("info", "Config file changed — reloading...");
      console.log("[rivano] Config file changed — reloading...");
      try {
        await reloadServices();
        state.bufferLog("info", "Reload complete");
        console.log("[rivano] Reload complete");
      } catch (err) {
        state.bufferLog("error", `Reload failed: ${err}`);
        console.error("[rivano] Reload failed:", err);
      } finally {
        reloadInProgress = false;
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

  const drainTimeout = new Promise<void>((_, reject) =>
    setTimeout(() => reject(new Error("Drain timeout")), 10_000)
  );

  try {
    await Promise.race([Promise.allSettled(shutdowns), drainTimeout]);
  } catch {
    console.log("[rivano] Drain timeout — forcing shutdown");
  }

  if (state.storage) state.storage.close();
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
  console.log(`[rivano] Observer: http://localhost:${state.config.observer.port}`);
  console.log(`[rivano] WebUI:    http://localhost:${WEBUI_PORT}\n`);

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[rivano] Fatal startup error:", err);
  process.exit(1);
});