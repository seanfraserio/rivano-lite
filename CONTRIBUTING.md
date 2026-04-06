# Contributing to Rivano Lite

## Development Setup

### Prerequisites

- [Bun](https://bun.sh) 1.x
- Docker (for container builds)

### Install

```bash
git clone https://github.com/seanfraserio/rivano-lite.git
cd rivano-lite
bun install
```

### Build Order

Packages have interdependencies. Build in this order:

```bash
bun run --filter @rivano/core build
bun run --filter @rivano/engine build
bun run --filter @rivano/proxy build
bun run --filter @rivano/observer build
bun run --filter @rivano/server build
bun run --filter @rivano/webui build
```

Or build everything:

```bash
bun run build
```

## Project Structure

```
packages/
  core/       Type definitions, shared interfaces (AgentConfig, Policy, Trace, Span)
  engine/     Agent deployment engine: diff, state management, validation
  proxy/      AI proxy gateway: routing, middleware pipeline, policy enforcement
  observer/   Tracing and observability: span capture, cost attribution, evaluators
  server/     HTTP server: API routes, SQLite storage, serves the WebUI
  webui/      Browser dashboard: Astro-based UI for configuration and monitoring
```

## Running Locally

### Backend

```bash
cd packages/server
bun run dev
```

Starts the API server with hot reload.

### Frontend

```bash
cd packages/webui
bun run dev
```

Starts the Astro dev server for the dashboard.

### Full Container

```bash
docker build -t rivano-lite .
docker run -p 9000:9000 -p 4000:4000 -p 4100:4100 -v ~/.rivano:/data rivano-lite
```

## Testing

Run tests per package:

```bash
cd packages/engine
bun test
```

### What to test

- **Middleware pipeline** -- Policy evaluation order, continue/block/short-circuit behavior
- **Policy evaluation** -- Condition matching (contains, regex, injection_score, pii_detected, length_exceeds)
- **PII detection** -- Regex patterns match expected inputs, no false positives on common text
- **Injection scoring** -- Heuristic scores align with known attack patterns
- **SQLite storage** -- Read/write traces, audit entries, retention cleanup
- **Deploy/diff engine** -- Correct diff actions (create/update/delete/unchanged), hash stability, atomic state writes, validation errors

## Code Style

- TypeScript strict mode
- ESM (`import`/`export`, no CommonJS)
- No default exports (exception: Astro pages, which require them)
- Zod for runtime validation of external input
- No unnecessary comments -- code should be self-documenting
- Prefer explicit types over `any`

## Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-change`)
3. Commit your changes with a descriptive message
4. Open a PR against `main`

### PR guidelines

- Describe what changed and why
- Tests are required for new features and bug fixes
- Keep PRs focused -- one concern per PR
- Run `bun test` in affected packages before submitting

## Architecture Decisions

See [docs/architecture.md](docs/architecture.md) for the full architecture overview.

Key constraints that guide contributions:

- **Single process** -- Rivano Lite runs as one process. No external services, no sidecars.
- **No external databases** -- SQLite only. No Postgres, Redis, or managed services.
- **Bun runtime** -- All packages target Bun. No Node.js-specific APIs.
- **Container size** -- The Docker image must stay under 200MB. Be mindful of dependencies.

## License

MIT. By contributing, you agree that your contributions are licensed under the same terms. See [LICENSE](LICENSE).
