# Architecture

How Rivano Lite works under the hood.

## Overview

Rivano Lite runs as a single Docker container with a single Bun process hosting four subsystems:

```
                        rivano.yaml
                            |
                     [ Config Loader ]
                     /    |    |     \
                    v     v    v      v
               +-------+-----+------+--------+
               | Proxy | Obs | Eng  | WebUI  |
               | :4000 |:4100| ine  | :9000  |
               +-------+-----+------+--------+
                            |
                      [ SQLite WAL ]
                        /data/db
```

**Proxy Gateway** (:4000) — Receives AI API calls, runs them through a middleware pipeline, routes to the configured provider, and records traces.

**Observer** (:4100) — Ingests trace spans, stores them in SQLite, and runs evaluators on ingest.

**Engine** — Manages agent-as-code deployments using a plan/apply pattern.

**WebUI API** (:9000) — Astro SSR application serving the dashboard and config management endpoints.

All four subsystems share a single Bun process and communicate via direct function calls — no internal HTTP overhead.

## Container Layout

```
/app
  /dist              # Compiled JS bundles (proxy, observer, engine, webui)
  /defaults          # Default rivano.yaml, seed configs
  /node_modules      # Bun dependencies (minimal — most is bundled)
/data                # Volume mount point (persists across restarts)
  /db                # SQLite database files (traces.db, state.db)
  /logs              # Structured JSON logs
```

The host volume mount maps `~/.rivano/` to `/data`:

```
~/.rivano/
  rivano.yaml        # User config (mounted read-only)
  .env               # Provider API keys (mounted read-only)
  data/
    traces.db        # SQLite trace storage
    traces.db-wal    # WAL file
    state.json       # Engine deployment state
```

The Bun runtime, compiled bundles, and default configs are baked into the image. User data lives exclusively in the mounted volume.

## The Proxy Gateway

Every request to `:4000` passes through an ordered middleware pipeline:

```
Request
  |
  v
[1] Rate Limiter        -- per-client token bucket, in-memory
  |
  v
[2] Injection Detector  -- heuristic + classifier scoring
  |
  v
[3] Policy (request)    -- user-defined rules from rivano.yaml
  |
  v
[4] Cache (request)     -- semantic cache lookup (SHA-256 of normalized input)
  |                        hit → skip to response pipeline
  v
[5] Provider Router     -- selects provider, sends request
  |
  v
[6] Cache (response)    -- store response if cacheable
  |
  v
[7] Policy (response)   -- output filtering, PII redaction rules
  |
  v
[8] Audit               -- emit trace span to Observer
  |
  v
Response
```

Each middleware returns one of three signals:

- **continue** — Pass to the next middleware
- **block** — Return an error response immediately (e.g., 403 for policy violation)
- **short-circuit** — Return a cached or synthetic response, skip remaining pipeline

### Provider Routing

Supported providers:

| Provider  | Protocol           | Auth              |
|-----------|--------------------|-------------------|
| Anthropic | Messages API       | API key           |
| OpenAI    | Chat Completions   | API key           |
| Ollama    | Chat Completions   | None (local)      |
| Bedrock   | Bedrock Runtime    | AWS credentials   |

The proxy normalizes all requests to and from the OpenAI-compatible format. Provider-specific translation happens at the boundary.

For streaming provider responses, Rivano Lite currently buffers the full upstream stream before returning it to the client. This allows response-phase policies such as `block` and `redact` to inspect the complete payload before release, but it is not token-by-token passthrough streaming.

When multiple providers are configured for the same model, the router supports:

- **Priority** — First available provider wins
- **Fallback** — Retry with next provider on failure
- **Round-robin** — Distribute load across providers

## The Observer

Trace data flows from the proxy to the observer via direct function call — no HTTP serialization in Lite mode.

### Storage

SQLite with WAL (Write-Ahead Logging) mode. WAL allows concurrent reads during writes without blocking, which matters because the WebUI reads traces while the proxy writes them.

The database schema is append-optimized: traces are inserted, never updated. Indexes on `trace_id`, `timestamp`, and `model` support the primary query patterns (timeline, per-trace drill-down, model-level aggregation).

### Span Model

Every trace consists of one or more spans. Each span has a type:

| Type        | Description                                          |
|-------------|------------------------------------------------------|
| `llm_call`  | A request/response to a language model               |
| `tool_call` | A tool/function call made by an agent                |
| `reasoning` | Internal chain-of-thought or planning step           |
| `retrieval` | RAG or context retrieval operation                   |
| `custom`    | User-defined span type via SDK or proxy headers      |

Spans form a tree: an `llm_call` span may have child `tool_call` spans, which may have child `llm_call` spans (for multi-step agents).

### Evaluators

Evaluators run synchronously on ingest. They annotate spans with computed metadata:

- **Cost** — Token count multiplied by model pricing table
- **Latency** — Total duration, time-to-first-token
- **Quality** — Optional user-defined scoring functions

Evaluators are lightweight by design. Heavy analysis (e.g., embedding-based similarity) should run asynchronously via the WebUI or external tooling.

## The Engine

The engine manages agent-as-code deployments. Agents are defined in `rivano.yaml`:

```yaml
agents:
  - name: support-router
    model: claude-sonnet-4-20250514
    system: "You route support tickets to the correct team."
    tools:
      - get_ticket
      - assign_team
    policies:
      - injection-detection
```

### Plan/Apply Pattern

Borrowed from Terraform. The engine never mutates state without showing you what will change.

1. **Hash** — Each agent config is SHA-256 hashed
2. **Diff** — Compare current hashes against `state.json`
3. **Plan** — Output the set of create/update/delete operations
4. **Apply** — Execute the plan, update `state.json`

```bash
rivano agents plan     # Show what would change
rivano agents apply    # Execute the changes
```

`state.json` tracks the deployed state: agent name, config hash, deployment timestamp, and status. This makes deploys idempotent — applying the same config twice is a no-op.

## Config Hot Reload

A file watcher monitors `rivano.yaml` for changes. On modification:

1. **Debounce** — Wait 500ms for rapid successive saves to settle
2. **Parse** — Validate the new YAML against the config schema
3. **Diff** — Determine which subsystems are affected
4. **Reload** — Update only the affected subsystems

What reloads without restart:

- Proxy policies, rate limits, cache settings
- Provider configuration (new providers, model lists)
- Agent definitions (triggers a new plan)

What requires a restart (`rivano restart`):

- Port changes
- `.env` file changes (environment variables are read at boot)
- SQLite storage path changes

If the new config fails validation, the reload is rejected and the previous config stays active. An error is logged and surfaced in the WebUI.

## WebUI

The dashboard is an Astro SSR application with React islands for interactive components.

```
:9000
  /              # Dashboard home — summary metrics
  /traces        # Trace list with filtering and search
  /traces/:id    # Single trace detail with span tree
  /agents        # Agent list with status and config
  /settings      # Provider config, policy editor
  /logs          # Live log stream (Server-Sent Events)
```

The WebUI API endpoints support:

- **Config CRUD** — Read and write `rivano.yaml` sections
- **Trace queries** — Filter by time range, model, status, cost
- **Log streaming** — SSE endpoint for real-time log tailing

All state lives in SQLite and `rivano.yaml`. The WebUI is stateless — refreshing the page loses nothing.

## API Authentication

When the `RIVANO_API_KEY` environment variable is set, all `/api/*` endpoints require authentication via a Bearer token:

```
Authorization: Bearer <your-api-key>
```

Requests without a valid key receive a `401 Unauthorized` response. When `RIVANO_API_KEY` is not set, all API endpoints are accessible without authentication (intended for local development only).

The `/api/config/raw` endpoint always requires authentication, even when no global API key is set, because it exposes provider API keys in plaintext.

In the WebUI, enter the key in **Settings → API Authentication**. The browser stores it in `localStorage` and includes it automatically with all API requests.

### WebUI API Endpoints

| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| `GET` | `/health` | No | Health check |
| `GET` | `/api/status` | Yes | System status, agents, ports |
| `GET` | `/api/config` | Yes | Config (API keys masked) |
| `GET` | `/api/config/raw` | Yes* | Raw YAML config (plaintext keys) |
| `PUT` | `/api/config` | Yes | Update config (YAML in body) |
| `POST` | `/api/config/validate` | Yes | Validate config YAML |
| `GET` | `/api/traces` | Yes | List traces (paginated) |
| `GET` | `/api/traces/stats` | Yes | Aggregate trace statistics |
| `DELETE` | `/api/traces` | Yes | Purge traces older than retention |
| `GET` | `/api/traces/:id` | Yes | Single trace with spans |
| `GET` | `/api/env` | Yes | List env vars (values masked) |
| `PUT` | `/api/env` | Yes | Set an env var |
| `DELETE` | `/api/env` | Yes | Remove an env var |
| `GET` | `/api/storage` | Yes | Database size info |
| `GET` | `/api/policy-activity` | Yes | Policy evaluation summary |

*\* `/api/config/raw` requires authentication even when `RIVANO_API_KEY` is not set.*

## Why Bun?

Rivano Lite uses Bun instead of Node.js for three reasons:

1. **Built-in SQLite** — Bun ships with a native SQLite driver (`bun:sqlite`). No native addon compilation, no `better-sqlite3` build step, no `node-gyp` dependency. This keeps the Docker image simple and the build reproducible.

2. **Fast startup** — The container boots in ~150ms. Cold start matters for a developer tool that starts and stops frequently.

3. **Smaller image** — The final Docker image is ~80MB. Bun's single-binary runtime avoids the Node.js + npm overhead.

The tradeoff is a smaller ecosystem for Bun-specific APIs, but Rivano Lite uses Bun primarily as a runtime — application code is standard TypeScript that would run on Node.js with minimal changes.

## Differences from Rivano Cloud

Rivano Lite and [Rivano Cloud](https://rivano.ai) share the same config format (`rivano.yaml`) and core proxy logic, but differ in deployment architecture:

| Dimension       | Rivano Lite                | Rivano Cloud                    |
|-----------------|----------------------------|---------------------------------|
| Process model   | Single Bun process         | Distributed microservices       |
| Database        | SQLite (local)             | Postgres (managed)              |
| Cache           | In-memory LRU              | Redis                           |
| Auth / RBAC     | API key (`RIVANO_API_KEY`)  | Full RBAC with SSO              |
| Trace retention | Limited by disk            | Configurable retention policies |
| Scaling         | Single machine             | Horizontal auto-scaling         |
| Agent runtime   | Local process              | Isolated container per agent    |

The migration path is intentionally smooth: export your `rivano.yaml` from Lite and import it into Cloud. Provider configs, policies, and agent definitions transfer directly.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RIVANO_API_KEY` | — | API key for WebUI authentication. When set, all `/api/*` endpoints require `Authorization: Bearer <key>`. When unset, endpoints are open (local dev only). |
| `RIVANO_DATA_DIR` | `/data` | Base directory for persistent storage. Config, database, and state files live here. |
| `RIVANO_CONFIG` | `<DATA_DIR>/rivano.yaml` | Path to the config file. Overrides the default location. |
| `RIVANO_WEBUI_PORT` | `9000` | Port for the WebUI dashboard and API. |

Provider API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.) are typically stored in `<DATA_DIR>/.env` and referenced in `rivano.yaml` with `${ANTHROPIC_API_KEY}` interpolation.
