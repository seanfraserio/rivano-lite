import type { FastifyInstance } from "fastify";
import { stat } from "fs/promises";
import { resolve } from "path";
import type { ServerState } from "../state.js";

const DB_PATH = resolve(process.env.RIVANO_DATA_DIR || "/data", "traces.db");

export function registerSystemRoutes(app: FastifyInstance, state: ServerState) {
  const VERSION = "0.1.0";

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
  app.get("/api/status", async () => ({
    config: process.env.RIVANO_CONFIG || resolve(process.env.RIVANO_DATA_DIR || "/data", "rivano.yaml"),
    dataDir: process.env.RIVANO_DATA_DIR || "/data",
    version: VERSION,
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