# Anthropic Quickstart

Use Rivano Lite as a proxy for Anthropic's Claude models with injection detection and PII redaction.

## Setup

```bash
# Set your API key
echo "ANTHROPIC_API_KEY=sk-ant-..." > ~/.rivano/.env

# Copy this config
cp rivano.yaml ~/.rivano/rivano.yaml

# Start Rivano Lite
rivano start
```

## Usage

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "http://localhost:4000/v1",
});

const message = await client.messages.create({
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello, Claude!" }],
});
```

```python
from anthropic import Anthropic

client = Anthropic(base_url="http://localhost:4000/v1")
message = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello, Claude!"}],
)
```

## What's Happening

1. Your request hits the Rivano proxy at `:4000`
2. Injection detection scores the prompt (blocks if score > 0.8)
3. PII detection scans for emails, phones, SSNs (redacts if found)
4. Request forwards to Anthropic's API
5. Response is cached for 1 hour (exact match)
6. A trace is recorded in the observer at `:4100`
7. View traces at http://localhost:9000/traces
