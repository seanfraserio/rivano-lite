import type { TraceStatus } from "@rivano/core";
import type { FastifyInstance } from "fastify";
import type { ServerState } from "../state.js";

type TraceQuery = {
  limit?: string;
  offset?: string;
  source?: string;
  since?: string;
  model?: string;
  status?: TraceStatus;
  minCostUsd?: string;
  maxCostUsd?: string;
};

const TRACE_SCAN_BATCH_SIZE = 1000;

function getTraceCost(trace: { totalCostUsd?: number; spans: Array<{ estimatedCostUsd?: number }> }): number {
  if (typeof trace.totalCostUsd === "number") {
    return trace.totalCostUsd;
  }
  return trace.spans.reduce((sum, span) => sum + (span.estimatedCostUsd ?? 0), 0);
}

function getTraceModel(trace: { spans: Array<{ metadata?: Record<string, unknown> }> }): string | undefined {
  for (const span of trace.spans) {
    const model = span.metadata?.model;
    if (typeof model === "string" && model.length > 0) {
      return model;
    }
  }
  return undefined;
}

function getTraceStatus(trace: { spans: Array<{ metadata?: Record<string, unknown> }> }): TraceStatus {
  let warned = false;
  for (const span of trace.spans) {
    const action = span.metadata?.action;
    if (action === "blocked") {
      return "blocked";
    }
    if (action === "warned") {
      warned = true;
    }
  }
  return warned ? "warned" : "allowed";
}

export function registerTraceRoutes(app: FastifyInstance, state: ServerState) {
  // ── List traces ────────────────────────────────────────────
  app.get<{
    Querystring: TraceQuery;
  }>("/api/traces", async (request) => {
    if (!state.storage) return { traces: [], total: 0 };
    const { limit = "50", offset = "0", source, since, model, status, minCostUsd, maxCostUsd } = request.query;
    const parsedLimit = Math.min(parseInt(limit, 10) || 50, 1000);
    const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);
    const sourceFilter = source || undefined;
    const sinceFilter = since ? parseInt(since, 10) : undefined;
    const hasDerivedFilters = Boolean(model || status || minCostUsd || maxCostUsd);

    if (!hasDerivedFilters) {
      return state.storage.listTraces({
        limit: parsedLimit,
        offset: parsedOffset,
        source: sourceFilter,
        since: sinceFilter,
      });
    }

    const filtered: ReturnType<typeof state.storage.listTraces>["traces"] = [];
    let scanOffset = 0;
    let total = 0;

    while (true) {
      const batch = state.storage.listTraces({
        limit: TRACE_SCAN_BATCH_SIZE,
        offset: scanOffset,
        source: sourceFilter,
        since: sinceFilter,
      });
      total = batch.total;
      if (batch.traces.length === 0) {
        break;
      }

      for (const trace of batch.traces) {
        const matches = (() => {
          if (model && getTraceModel(trace) !== model) {
            return false;
          }
          if (status && getTraceStatus(trace) !== status) {
            return false;
          }
          const cost = getTraceCost(trace);
          if (minCostUsd && cost < parseFloat(minCostUsd)) {
            return false;
          }
          if (maxCostUsd && cost > parseFloat(maxCostUsd)) {
            return false;
          }
          return true;
        })();
        if (matches) {
          filtered.push(trace);
        }
      }

      scanOffset += batch.traces.length;
      if (scanOffset >= total) {
        break;
      }
    }

    return {
      traces: filtered.slice(parsedOffset, parsedOffset + parsedLimit),
      total: filtered.length,
    };
  });

  // ── Get single trace ────────────────────────────────────────
  app.get<{ Params: { id: string } }>("/api/traces/:id", async (request, reply) => {
    if (!state.storage) return reply.status(503).send({ error: "Storage not ready" });
    const trace = state.storage.getTrace(request.params.id);
    if (!trace) return reply.status(404).send({ error: "Trace not found" });
    return trace;
  });

  // ── Trace stats ────────────────────────────────────────────
  app.get("/api/traces/stats", async () => {
    if (!state.storage) {
      return { totalTraces: 0, totalSpans: 0, avgLatencyMs: 0, totalCostUsd: 0, tracesPerDay: {} };
    }
    return state.storage.getStats();
  });

  // ── Policy activity ─────────────────────────────────────────
  app.get("/api/policy-activity", async () => {
    if (!state.storage) return { activity: [] };
    const { traces } = state.storage.listTraces({ limit: 500, offset: 0 });
    const activity: Array<{
      traceId: string;
      timestamp: number;
      model: string;
      provider: string;
      action: string;
      blockedBy?: string;
      reason?: string;
      tokensIn?: number;
      tokensOut?: number;
      costUsd?: number;
    }> = [];

    const summary = { total: 0, allowed: 0, blocked: 0, redacted: 0, warned: 0 };

    for (const trace of traces) {
      for (const span of trace.spans) {
        const m = (span.metadata ?? {}) as Record<string, unknown>;
        const action = (m.action as string) ?? "allowed";
        summary.total++;
        if (action === "allowed") summary.allowed++;
        else if (action === "blocked") summary.blocked++;
        else if (action === "redacted") summary.redacted++;
        else if (action === "warned") summary.warned++;

        if (action !== "allowed") {
          activity.push({
            traceId: trace.id,
            timestamp: span.startTime,
            model: (m.model as string) ?? "",
            provider: (m.provider as string) ?? "",
            action,
            blockedBy: m.blockedBy as string | undefined,
            reason: m.blockReason as string | undefined,
            tokensIn: m.tokensIn as number | undefined,
            tokensOut: m.tokensOut as number | undefined,
            costUsd: span.estimatedCostUsd ?? undefined,
          });
        }
      }
    }

    return { summary, activity: activity.slice(0, 100) };
  });

  // ── Delete old traces ────────────────────────────────────────
  app.delete("/api/traces", async () => {
    if (!state.storage) return { deleted: 0 };
    const retentionDays = state.config?.observer.retention_days ?? 30;
    const deleted = state.storage.deleteOlderThan(retentionDays);
    state.bufferLog("info", `Purged ${deleted} traces older than ${retentionDays} days`);
    return { deleted };
  });
}
