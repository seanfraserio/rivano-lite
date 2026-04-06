<p align="center">
  <img src="packages/webui/public/logo.svg" alt="Rivano" width="80" height="80" />
</p>

<h1 align="center">Rivano Lite</h1>

<p align="center"><strong>Open source, self-hosted AI operations platform.</strong></p>

<p align="center">
  <a href="https://rivano.ai">Website</a> &middot;
  <a href="https://rivano.ai/docs">Docs</a> &middot;
  <a href="https://rivano.ai/pricing">Cloud</a>
</p>

---

Rivano Lite gives you the core [Rivano](https://rivano.ai) experience locally — an AI proxy with governance, observability with tracing, and agent deployment — all in a single container.

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/seanfraserio/rivano-lite/main/install.sh | sh
rivano start
```

Or run directly with Docker:

```bash
docker run -d --name rivano-lite \
  -p 9000:9000 -p 4000:4000 -p 4100:4100 \
  -v ~/.rivano:/data \
  ghcr.io/seanfraserio/rivano-lite:latest
```

Then open [http://localhost:9000](http://localhost:9000) to configure your providers and start proxying.

## What You Get

- **AI Proxy Gateway** — Route requests to Anthropic, OpenAI, Ollama, or AWS Bedrock with policy enforcement, PII redaction, prompt injection detection, caching, and rate limiting
- **Observability** — Full trace capture with span trees, timing waterfalls, cost attribution, and quality evaluators
- **Agent Deployment** — Define agents as code in YAML, deploy idempotently with diff/validate
- **Local WebUI** — Browser-based dashboard at `localhost:9000` for configuration and monitoring

## Requirements

- Docker (Docker Desktop on macOS, or Docker Engine on Linux)
- macOS (Intel or Apple Silicon) or Linux (amd64 or arm64)

## Configuration

All configuration lives in a single `rivano.yaml` file:

```yaml
version: "1"

providers:
  anthropic:
    api_key: ${ANTHROPIC_API_KEY}
  ollama:
    base_url: "http://host.docker.internal:11434"

proxy:
  port: 4000
  cache:
    enabled: true
  policies:
    - name: block-injection
      on: request
      condition: { injection_score: { gt: 0.8 } }
      action: block

observer:
  port: 4100
  retention_days: 30

agents:
  - name: my-agent
    model:
      provider: anthropic
      name: claude-sonnet-4-5
    system_prompt: "You are a helpful assistant."
```

## Management

```bash
docker logs -f rivano-lite     # Stream logs
docker stop rivano-lite        # Stop
docker start rivano-lite       # Restart
docker rm -f rivano-lite       # Remove

# Update to latest version
docker pull ghcr.io/seanfraserio/rivano-lite:latest
docker rm -f rivano-lite
docker run -d --name rivano-lite \
  -p 9000:9000 -p 4000:4000 -p 4100:4100 \
  -v ~/.rivano:/data \
  ghcr.io/seanfraserio/rivano-lite:latest
```

## Connect Your App

Point your AI SDK at the Rivano proxy:

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "http://localhost:4000/v1",
});
```

```python
from anthropic import Anthropic

client = Anthropic(base_url="http://localhost:4000/v1")
```

## Rivano Lite vs Rivano Cloud

| | Lite (OSS) | Cloud |
|---|---|---|
| AI Proxy | All providers | All + custom |
| PII Detection | Regex | ML-based NER |
| Injection Detection | Heuristic | ML models |
| Cache | Exact-match | Semantic (ML) |
| Rate Limiting | In-memory | Distributed |
| Tracing | Full spans + cost | + PII in traces |
| Storage | SQLite | Managed Postgres |
| Auth | — | OAuth, SAML, RBAC |
| Alerts | — | Slack, PagerDuty |
| Compliance | — | SOC2, HIPAA |
| **Price** | **Free** | **Usage-based** |

[Upgrade to Rivano Cloud →](https://rivano.ai)

## License

MIT
