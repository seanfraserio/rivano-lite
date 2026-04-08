import Fastify, { type FastifyInstance } from "fastify";
import type { ObserverConfig, Trace } from "@rivano/core";
import { createStorage, type Storage } from "./storage/sqlite.js";
import { evaluateLatency } from "./evaluators/latency.js";
import { evaluateCost } from "./evaluators/cost.js";

export interface ObserverServerOptions {
  storage?: Storage;
}

export function createObserverServer(
  config: ObserverConfig,
  dbPath: string,
  options?: ObserverServerOptions
): FastifyInstance {
  const server = Fastify({ logger: true });
  const ownsStorage = !options?.storage;
  const storage = options?.storage ?? createStorage(dbPath);

  server.addHook("onClose", () => {
    if (ownsStorage) storage.close();
  });

  server.get("/health", async () => {
    return { status: "ok", timestamp: Date.now() };
  });

  server.post<{ Body: Trace }>("/v1/traces", async (request, reply) => {
    const trace = request.body;

    if (!trace.id || !trace.startTime || !Array.isArray(trace.spans)) {
      return reply.status(400).send({ error: "Invalid trace: requires id, startTime, and spans" });
    }

    storage.insertTrace(trace);

    const evaluatorResults: Record<string, unknown> = {};
    if (config.evaluators.includes("latency")) evaluatorResults.latency = evaluateLatency(trace);
    if (config.evaluators.includes("cost")) evaluatorResults.cost = evaluateCost(trace);

    return reply.status(201).send({
      id: trace.id,
      spans: trace.spans.length,
      evaluators: evaluatorResults,
    });
  });

  server.get<{
    Querystring: { limit?: string; offset?: string; source?: string; since?: string };
  }>("/v1/traces", async (request) => {
    const limit = Math.min(parseInt(request.query.limit ?? "50", 10) || 50, 1000);
    const offset = parseInt(request.query.offset ?? "0", 10) || 0;
    const source = request.query.source || undefined;
    const since = request.query.since ? parseInt(request.query.since, 10) : undefined;

    return storage.listTraces({ limit, offset, source, since });
  });

  server.get<{ Params: { id: string } }>("/v1/traces/:id", async (request, reply) => {
    const trace = storage.getTrace(request.params.id);
    if (!trace) {
      return reply.status(404).send({ error: "Trace not found" });
    }
    return trace;
  });

  server.get("/v1/stats", async () => {
    return storage.getStats();
  });

  server.delete("/v1/traces", async () => {
    const deleted = storage.deleteOlderThan(config.retention_days);
    return { deleted, retention_days: config.retention_days };
  });

  return server;
}

if (import.meta.main) {
  const config: ObserverConfig = {
    port: parseInt(process.env.OBSERVER_PORT ?? "7778", 10),
    storage: "sqlite",
    retention_days: parseInt(process.env.RETENTION_DAYS ?? "30", 10),
    evaluators: (process.env.EVALUATORS ?? "latency,cost").split(","),
  };

  const dbPath = process.env.DB_PATH ?? "./rivano-observer.db";
  const server = createObserverServer(config, dbPath);

  server.listen({ port: config.port, host: "0.0.0.0" }, (err) => {
    if (err) {
      server.log.error(err);
      process.exit(1);
    }
  });
}
