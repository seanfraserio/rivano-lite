# Observability & Tracing

## Overview

The Rivano observer captures full traces of AI agent behavior. Every LLM call, tool invocation, reasoning step, and retrieval operation is recorded as a span. Spans nest via parent references to form trace trees, giving you a complete picture of what an agent did, how long it took, and how much it cost.

The observer runs on **port 4100** by default and stores traces in a local SQLite database.

---

## How Traces Work

### Span Model

A span is the fundamental unit of observation. Each span represents a single operation within a trace.

| Field              | Type     | Description                                            |
|--------------------|----------|--------------------------------------------------------|
| `id`               | `string` | Unique span identifier                                 |
| `traceId`          | `string` | ID of the parent trace                                 |
| `parentSpanId`     | `string` | ID of the parent span (omitted for root spans)         |
| `type`             | `string` | `llm_call`, `tool_call`, `reasoning`, `retrieval`, `custom` |
| `name`             | `string` | Human-readable name (e.g. "classify-ticket")           |
| `input`            | `any`    | Input payload (prompt, tool args, query)               |
| `output`           | `any`    | Output payload (response, tool result)                 |
| `error`            | `string` | Error message if the span failed                       |
| `startTime`        | `number` | Unix timestamp (ms) when the span started              |
| `endTime`          | `number` | Unix timestamp (ms) when the span ended                |
| `estimatedCostUsd` | `number` | Estimated cost in USD                                  |
| `metadata`         | `object` | Arbitrary key-value pairs (model, token counts, etc.)  |

### Trace Structure

A trace is a collection of spans sharing the same `traceId`. Spans reference their parent via `parentSpanId` to form a tree.

| Field          | Type     | Description                                |
|----------------|----------|--------------------------------------------|
| `id`           | `string` | Unique trace identifier                    |
| `spans`        | `Span[]` | All spans belonging to this trace          |
| `startTime`    | `number` | Unix timestamp (ms) of the earliest span   |
| `endTime`      | `number` | Unix timestamp (ms) of the latest span     |
| `totalCostUsd` | `number` | Sum of all span costs                      |
| `source`       | `string` | Origin identifier (e.g. "proxy", "sdk")    |
| `metadata`     | `object` | Arbitrary trace-level metadata             |

### Example Trace Tree

```
trace: "support-ticket-classification"
│
├── [llm_call] "classify-intent"          320ms   $0.002
│   └── [tool_call] "lookup-customer"      85ms   --
│       └── [retrieval] "customer-db"      42ms   --
│
├── [reasoning] "route-decision"            5ms   --
│
└── [llm_call] "draft-response"           890ms   $0.008
    └── [tool_call] "send-email"          120ms   --
```

Root spans have no `parentSpanId`. Child spans reference their parent, forming the nesting structure.

---

## Ingesting Traces

### Endpoint

```
POST http://localhost:4100/v1/traces
```

### Payload

```json
{
  "id": "trace-001",
  "startTime": 1743868800000,
  "endTime": 1743868801500,
  "totalCostUsd": 0.010,
  "source": "my-agent",
  "metadata": {
    "environment": "production"
  },
  "spans": [
    {
      "id": "span-001",
      "traceId": "trace-001",
      "type": "llm_call",
      "name": "classify-intent",
      "input": {
        "messages": [
          { "role": "user", "content": "I need to reset my password" }
        ]
      },
      "output": {
        "category": "account-access"
      },
      "startTime": 1743868800000,
      "endTime": 1743868800320,
      "metadata": {
        "model": "claude-sonnet-4-5",
        "usage": {
          "input_tokens": 42,
          "output_tokens": 8
        }
      }
    },
    {
      "id": "span-002",
      "traceId": "trace-001",
      "parentSpanId": "span-001",
      "type": "tool_call",
      "name": "lookup-customer",
      "input": { "email": "user@example.com" },
      "output": { "customer_id": "cust_123", "plan": "pro" },
      "startTime": 1743868800050,
      "endTime": 1743868800135
    }
  ]
}
```

### Response

```json
{
  "id": "trace-001",
  "spans": 2,
  "evaluators": {
    "latency": {
      "score": 1.0,
      "details": {
        "totalMs": 1500,
        "avgSpanMs": 152,
        "slowestSpan": { "name": "classify-intent", "ms": 320 }
      }
    },
    "cost": {
      "totalUsd": 0.000126,
      "perSpan": [
        { "name": "classify-intent", "usd": 0.000126 }
      ]
    }
  }
}
```

Required fields: `id`, `startTime`, `spans` (array). The observer returns `400` if any of these are missing.

### Automatic Capture

When requests are proxied through the Rivano proxy, traces are captured automatically. For direct SDK usage or custom agents, POST traces to the observer endpoint manually.

---

## Querying Traces

### List Traces

```
GET http://localhost:4100/v1/traces
```

Query parameters:

| Parameter | Type     | Default | Description                           |
|-----------|----------|---------|---------------------------------------|
| `limit`   | `number` | 50      | Max traces to return (capped at 1000) |
| `offset`  | `number` | 0       | Pagination offset                     |
| `source`  | `string` | --      | Filter by source identifier           |
| `since`   | `number` | --      | Only traces after this timestamp (ms) |

```bash
# Last 20 traces from "my-agent"
curl "http://localhost:4100/v1/traces?limit=20&source=my-agent"

# Traces from the last hour
curl "http://localhost:4100/v1/traces?since=$(( $(date +%s) * 1000 - 3600000 ))"
```

Response:

```json
{
  "traces": [ ... ],
  "total": 142
}
```

### Get Single Trace

```
GET http://localhost:4100/v1/traces/:id
```

```bash
curl http://localhost:4100/v1/traces/trace-001
```

Returns the full trace with all spans. Returns `404` if not found.

### Aggregate Stats

```
GET http://localhost:4100/v1/stats
```

```json
{
  "totalTraces": 1842,
  "totalSpans": 12456,
  "avgLatencyMs": 2340,
  "totalCostUsd": 14.82,
  "tracesPerDay": {
    "2026-04-05": 142,
    "2026-04-04": 238,
    "2026-04-03": 195
  }
}
```

Returns totals, averages, and a per-day breakdown for the last 30 days.

---

## Evaluators

Evaluators run automatically on every ingested trace and return structured results. Enable them in `rivano.yaml`:

```yaml
observer:
  evaluators:
    - latency
    - cost
```

### Latency Evaluator

Scores trace latency on a 0-1 scale.

**Scoring:**

| Total latency | Score |
|---------------|-------|
| Under 1s      | 1.0   |
| 1s - 30s      | Linear degradation from 1.0 to 0 |
| Over 30s       | 0     |

**Output:**

```json
{
  "score": 0.872,
  "details": {
    "totalMs": 4720,
    "avgSpanMs": 944,
    "slowestSpan": {
      "name": "draft-response",
      "ms": 2100
    }
  }
}
```

The evaluator identifies the slowest span by duration (`endTime - startTime`). If the trace has no `endTime`, total latency is computed from the latest span end time minus the trace start time.

### Cost Evaluator

Estimates USD cost per span using token counts from span metadata and a built-in pricing table.

**How it works:**

1. Reads `metadata.usage.input_tokens` and `metadata.usage.output_tokens` from each span.
2. Looks up `metadata.model` in the pricing table.
3. Computes: `(input_tokens / 1M * input_price) + (output_tokens / 1M * output_price)`.

**Built-in Pricing Table:**

| Model               | Input (per 1M tokens) | Output (per 1M tokens) |
|----------------------|-----------------------|------------------------|
| `claude-sonnet-4-5`  | $3.00                 | $15.00                 |
| `claude-haiku-4-5`   | $0.80                 | $4.00                  |
| `gpt-4o`             | $2.50                 | $10.00                 |
| `gpt-4o-mini`        | $0.15                 | $0.60                  |

**Default fallback** for unknown models: $1.00 input / $3.00 output per million tokens.

**Output:**

```json
{
  "totalUsd": 0.010246,
  "perSpan": [
    { "name": "classify-intent", "usd": 0.000246 },
    { "name": "draft-response", "usd": 0.010000 }
  ]
}
```

Only spans with non-zero token counts appear in `perSpan`.

---

## Storage

### SQLite with WAL

Traces are stored in a SQLite database with WAL (Write-Ahead Logging) mode enabled for concurrent read/write performance.

**Default location:** `/data/traces.db` (configurable via `RIVANO_DATA_DIR` environment variable, which sets the base directory).

**Schema:**

- `traces` table: id, source, start_time, end_time, total_cost_usd, span_count, metadata, created_at
- `spans` table: id, trace_id (foreign key), parent_span_id, type, name, input, output, error, start_time, end_time, estimated_cost_usd, metadata
- Indexes on `spans.trace_id`, `traces.start_time`, and `traces.source`
- Foreign keys enabled with `ON DELETE CASCADE` -- deleting a trace removes its spans.

### Retention

Configure retention in `rivano.yaml`:

```yaml
observer:
  retention_days: 30
```

Purge expired traces manually:

```bash
curl -X DELETE http://localhost:4100/v1/traces
```

Returns:

```json
{
  "deleted": 42,
  "retention_days": 30
}
```

This deletes traces older than `retention_days` from their `created_at` timestamp.

---

## Configuration

Full observer configuration in `rivano.yaml`:

```yaml
observer:
  port: 4100
  storage: sqlite
  retention_days: 30
  evaluators:
    - latency
    - cost
```

Environment variable overrides:

| Variable          | Default                  | Description              |
|-------------------|--------------------------|--------------------------|
| `RIVANO_DATA_DIR` | `/data`                  | Base directory for all persistent data (config, database, state) |
| `RIVANO_CONFIG`   | `<DATA_DIR>/rivano.yaml` | Path to the config file  |
| `RIVANO_API_KEY`  | —                        | API key for WebUI authentication |
| `RIVANO_WEBUI_PORT` | `9000`                 | Port for the WebUI dashboard |

Observer settings are configured in `rivano.yaml` under the `observer` key — they cannot be overridden with separate environment variables.

---

## Health Check

```bash
curl http://localhost:4100/health
```

```json
{
  "status": "ok",
  "timestamp": 1743868800000
}
```

---

## Lite vs Cloud

Rivano Lite gives you the full local observability stack. Rivano Cloud extends it for teams and production:

| Capability                    | Lite          | Cloud         |
|-------------------------------|---------------|---------------|
| Trace capture & storage       | SQLite        | Managed Postgres |
| Latency & cost evaluators     | Yes           | Yes           |
| PII detection in traces       | Regex-based   | ML-based      |
| Retention                     | Configurable  | Configurable  |
| SOC2 / HIPAA trace export     | --            | Yes           |
| Slack / PagerDuty alerts      | --            | Yes           |
| Team RBAC                     | --            | Yes           |
| Dashboard                     | --            | Hosted WebUI  |
