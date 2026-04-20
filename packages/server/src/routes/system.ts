import { stat } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { ServerState } from "../state.js";
import { CONFIG_PATH, DATA_DIR, DB_PATH, VERSION } from "../state.js";

export function registerSystemRoutes(app: FastifyInstance, state: ServerState) {
  // ── Health ─────────────────────────────────────────────────
  app.get("/health", async () => ({
    status: "ok",
    version: VERSION,
    uptime: Math.floor((Date.now() - state.startedAt) / 1000),
    services: {
      proxy: state.proxy ? "running" : "stopped",
      observer: state.observer ? "running" : "stopped",
      agents: state.agents.size,
    },
  }));

  // ── Status ─────────────────────────────────────────────────
  app.get("/api/status", async () => {
    const cfg = state.config;
    return {
      config: CONFIG_PATH,
      dataDir: DATA_DIR,
      version: VERSION,
      uptime: Math.floor((Date.now() - state.startedAt) / 1000),
      proxy: cfg
        ? {
            port: cfg.proxy.port,
            providers: Object.keys(cfg.providers),
            policies: cfg.proxy.policies.length,
          }
        : null,
      observer: cfg
        ? {
            port: cfg.observer.port,
            storage: cfg.observer.storage,
            retentionDays: cfg.observer.retention_days,
          }
        : null,
      agents: Array.from(state.agents.values())
        .filter((a) => a.config)
        .map((a) => ({
          name: a.config.name,
          provider: a.config.model.provider,
          model: a.config.model.name,
          deployedAt: a.deployedAt,
        })),
    };
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
}
