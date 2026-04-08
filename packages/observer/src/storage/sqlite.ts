import { Database } from "bun:sqlite";
import type { Trace, Span } from "@rivano/core";

export interface ListOptions {
  limit: number;
  offset: number;
  source?: string;
  since?: number;
}

export interface TraceStats {
  totalTraces: number;
  totalSpans: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  tracesPerDay: Record<string, number>;
}

export interface Storage {
  insertTrace(trace: Trace): void;
  getTrace(id: string): Trace | null;
  listTraces(opts: ListOptions): { traces: Trace[]; total: number };
  getStats(): TraceStats;
  deleteOlderThan(days: number): number;
  close(): void;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS traces (
    id TEXT PRIMARY KEY,
    source TEXT,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    total_cost_usd REAL DEFAULT 0,
    span_count INTEGER DEFAULT 0,
    metadata TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS spans (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
    parent_span_id TEXT,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    input TEXT,
    output TEXT,
    error TEXT,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    estimated_cost_usd REAL DEFAULT 0,
    metadata TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON spans(trace_id);
  CREATE INDEX IF NOT EXISTS idx_traces_start_time ON traces(start_time);
  CREATE INDEX IF NOT EXISTS idx_traces_source ON traces(source);
`;

function rowToSpan(row: Record<string, unknown>): Span {
  return {
    id: row.id as string,
    traceId: row.trace_id as string,
    parentSpanId: (row.parent_span_id as string) || undefined,
    type: row.type as Span["type"],
    name: row.name as string,
    input: row.input ? JSON.parse(row.input as string) : undefined,
    output: row.output ? JSON.parse(row.output as string) : undefined,
    error: (row.error as string) || undefined,
    startTime: row.start_time as number,
    endTime: (row.end_time as number) || undefined,
    estimatedCostUsd: (row.estimated_cost_usd as number) || undefined,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
  };
}

function rowToTrace(
  row: Record<string, unknown>,
  spans: Span[]
): Trace {
  return {
    id: row.id as string,
    source: (row.source as string) || undefined,
    startTime: row.start_time as number,
    endTime: (row.end_time as number) || undefined,
    totalCostUsd: (row.total_cost_usd as number) || undefined,
    spans,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
  };
}

export function createStorage(dbPath: string): Storage {
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);

  const insertTraceStmt = db.prepare(`
    INSERT INTO traces (id, source, start_time, end_time, total_cost_usd, span_count, metadata)
    VALUES ($id, $source, $startTime, $endTime, $totalCostUsd, $spanCount, $metadata)
  `);

  const insertSpanStmt = db.prepare(`
    INSERT INTO spans (id, trace_id, parent_span_id, type, name, input, output, error, start_time, end_time, estimated_cost_usd, metadata)
    VALUES ($id, $traceId, $parentSpanId, $type, $name, $input, $output, $error, $startTime, $endTime, $estimatedCostUsd, $metadata)
  `);

  const getTraceStmt = db.prepare("SELECT * FROM traces WHERE id = $id");
  const getSpansStmt = db.prepare("SELECT * FROM spans WHERE trace_id = $traceId ORDER BY start_time ASC");

  const deleteOldTracesStmt = db.prepare(`
    DELETE FROM traces WHERE created_at < unixepoch() - ($days * 86400)
  `);

  const statsStmt = db.prepare(`
    SELECT
      COUNT(*) as total_traces,
      COALESCE(SUM(span_count), 0) as total_spans,
      COALESCE(AVG(CASE WHEN end_time IS NOT NULL THEN end_time - start_time END), 0) as avg_latency_ms,
      COALESCE(SUM(total_cost_usd), 0) as total_cost_usd
    FROM traces
  `);

  const tracesPerDayStmt = db.prepare(`
    SELECT date(start_time / 1000, 'unixepoch') as day, COUNT(*) as count
    FROM traces
    GROUP BY day
    ORDER BY day DESC
    LIMIT 30
  `);

  return {
    insertTrace(trace: Trace): void {
      const insertAll = db.transaction(() => {
        insertTraceStmt.run({
          $id: trace.id,
          $source: trace.source ?? null,
          $startTime: trace.startTime,
          $endTime: trace.endTime ?? null,
          $totalCostUsd: trace.totalCostUsd ?? 0,
          $spanCount: trace.spans.length,
          $metadata: trace.metadata ? JSON.stringify(trace.metadata) : null,
        });

        for (const span of trace.spans) {
          insertSpanStmt.run({
            $id: span.id,
            $traceId: trace.id,
            $parentSpanId: span.parentSpanId ?? null,
            $type: span.type,
            $name: span.name,
            $input: span.input !== undefined ? JSON.stringify(span.input) : null,
            $output: span.output !== undefined ? JSON.stringify(span.output) : null,
            $error: span.error ?? null,
            $startTime: span.startTime,
            $endTime: span.endTime ?? null,
            $estimatedCostUsd: span.estimatedCostUsd ?? 0,
            $metadata: span.metadata ? JSON.stringify(span.metadata) : null,
          });
        }
      });

      insertAll();
    },

    getTrace(id: string): Trace | null {
      const row = getTraceStmt.get({ $id: id }) as Record<string, unknown> | null;
      if (!row) return null;

      const spanRows = getSpansStmt.all({ $traceId: id }) as Record<string, unknown>[];
      const spans = spanRows.map(rowToSpan);

      return rowToTrace(row, spans);
    },

    listTraces(opts: ListOptions): { traces: Trace[]; total: number } {
      const conditions: string[] = [];
      const params: Record<string, unknown> = {};

      if (opts.source) {
        conditions.push("source = $source");
        params.$source = opts.source;
      }
      if (opts.since) {
        conditions.push("start_time >= $since");
        params.$since = opts.since;
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const countRow = db
        .prepare(`SELECT COUNT(*) as total FROM traces ${where}`)
        .get(params as Record<string, string | number>) as { total: number };

      const rows = db
        .prepare(
          `SELECT * FROM traces ${where} ORDER BY start_time DESC LIMIT $limit OFFSET $offset`
        )
        .all({ ...params, $limit: opts.limit, $offset: opts.offset }) as Record<string, unknown>[];

      // Batch-load spans for all traces in a single query (fixes N+1)
      const traceIds = rows.map((r) => r.id as string);
      const allSpans = traceIds.length > 0
        ? (db
            .prepare(
              `SELECT * FROM spans WHERE trace_id IN (${traceIds.map((_, i) => `$id${i}`).join(",")}) ORDER BY start_time ASC`
            )
            .all(
              Object.fromEntries(traceIds.map((id, i) => [`$id${i}`, id]))
            ) as Record<string, unknown>[])
        : [];

      // Group spans by trace_id
      const spansByTrace = new Map<string, Span[]>();
      for (const spanRow of allSpans) {
        const traceId = spanRow.trace_id as string;
        const span = rowToSpan(spanRow);
        const arr = spansByTrace.get(traceId);
        if (arr) arr.push(span);
        else spansByTrace.set(traceId, [span]);
      }

      const traces = rows.map((row) => {
        const spans = spansByTrace.get(row.id as string) ?? [];
        return rowToTrace(row, spans);
      });

      return { traces, total: countRow.total };
    },

    getStats(): TraceStats {
      const row = statsStmt.get() as Record<string, number>;
      const dayRows = tracesPerDayStmt.all() as Array<{ day: string; count: number }>;

      const tracesPerDay: Record<string, number> = {};
      for (const dayRow of dayRows) {
        tracesPerDay[dayRow.day] = dayRow.count;
      }

      return {
        totalTraces: row.total_traces,
        totalSpans: row.total_spans,
        avgLatencyMs: Math.round(row.avg_latency_ms),
        totalCostUsd: row.total_cost_usd,
        tracesPerDay,
      };
    },

    deleteOlderThan(days: number): number {
      const result = deleteOldTracesStmt.run({ $days: days });
      return result.changes;
    },

    close(): void {
      db.close();
    },
  };
}
