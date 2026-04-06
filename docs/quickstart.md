# Quickstart

Get Rivano Lite running and proxy your first AI request in under 5 minutes.

## Prerequisites

- **Docker** — [Docker Desktop](https://docs.docker.com/desktop/) on macOS, [Docker Engine](https://docs.docker.com/engine/install/) on Linux. Must be running before you start.
- **Ollama** (optional) — Install [Ollama](https://ollama.com) if you want to use local models with zero API keys.

## Install

```bash
curl -fsSL https://get.rivano.ai | sh
```

This does three things:

1. Pulls the `rivano/lite` Docker image
2. Installs the `rivano` CLI wrapper to your PATH
3. Creates `~/.rivano/` with a default `rivano.yaml` config

## Start Rivano Lite

```bash
rivano start
```

The CLI starts the container and waits for all services to pass health checks. You'll see:

```
Starting Rivano Lite...
  Proxy     ✓  localhost:4000
  Observer  ✓  localhost:4100
  WebUI     ✓  localhost:9000
Ready.
```

## Open the WebUI

Navigate to [localhost:9000](http://localhost:9000) or run:

```bash
rivano config
```

The dashboard shows three sections: **Traces** (empty for now), **Agents** (none deployed), and **Settings** where you configure providers.

## Connect a Provider

You need at least one provider to start proxying requests.

### Option A: Ollama (no API keys)

If Ollama is running locally, Rivano auto-detects it. Pull a model and you're done:

```bash
ollama pull llama3.1
```

The default `rivano.yaml` already includes:

```yaml
providers:
  ollama:
    base_url: http://host.docker.internal:11434
```

### Option B: Anthropic

Add your API key to `~/.rivano/.env`:

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." >> ~/.rivano/.env
```

Or add it through the WebUI at **Settings > Providers**.

Your `rivano.yaml` provider block:

```yaml
providers:
  anthropic:
    api_key: ${ANTHROPIC_API_KEY}
    models:
      - claude-sonnet-4-20250514
      - claude-haiku-4-20250414
```

### Option C: OpenAI

Same pattern:

```bash
echo "OPENAI_API_KEY=sk-..." >> ~/.rivano/.env
```

```yaml
providers:
  openai:
    api_key: ${OPENAI_API_KEY}
    models:
      - gpt-4o
      - gpt-4o-mini
```

After adding a provider, restart to pick up `.env` changes:

```bash
rivano restart
```

Config changes to `rivano.yaml` are hot-reloaded automatically — no restart needed.

## Send Your First Request

The proxy at `localhost:4000` accepts the standard OpenAI-compatible `/v1/chat/completions` format. Point any client at it.

### curl

```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "Hello from Rivano!"}]
  }'
```

### TypeScript

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:4000/v1",
  apiKey: "unused", // Rivano manages provider keys
});

const response = await client.chat.completions.create({
  model: "claude-sonnet-4-20250514",
  messages: [{ role: "user", content: "Hello from Rivano!" }],
});

console.log(response.choices[0].message.content);
```

### Python

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:4000/v1",
    api_key="unused",  # Rivano manages provider keys
)

response = client.chat.completions.create(
    model="claude-sonnet-4-20250514",
    messages=[{"role": "user", "content": "Hello from Rivano!"}],
)

print(response.choices[0].message.content)
```

## View the Trace

Open [localhost:9000/traces](http://localhost:9000/traces). You'll see your request as a trace entry with:

- **Span tree** — The full request lifecycle (receive, policy check, provider call, response)
- **Cost** — Token usage and estimated cost
- **Latency** — Total duration and time-to-first-token
- **Input/Output** — Full request and response payloads

Click any span to expand its details.

## Add a Policy

Policies let you intercept and enforce rules on requests and responses. Add a prompt injection detection policy to your `~/.rivano/rivano.yaml`:

```yaml
policies:
  - name: injection-detection
    on: request
    condition:
      type: injection_score
      threshold: 0.85
    action: block
    message: "Request blocked: potential prompt injection detected."
```

The config hot-reloads. Send a request that triggers the policy and you'll get a 403 with the block message. Check the trace to see the policy span in the tree.

## Next Steps

- [Configuration Reference](./configuration.md) — Full `rivano.yaml` schema
- [Proxy Gateway](./proxy.md) — Routing, load balancing, fallbacks, caching
- [Agent Deployment](./agents.md) — Deploy agents-as-code with plan/apply
