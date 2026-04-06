# Proxy Gateway

## Overview

The Rivano proxy sits between your application and LLM providers. Every request flows through a middleware pipeline that enforces rate limits, detects prompt injection, applies policies, caches responses, and writes audit logs -- before the request ever reaches the provider.

The proxy runs on **port 4000** by default and supports three providers out of the box:

- **Anthropic** (`/v1/messages`)
- **OpenAI** (`/v1/chat/completions`)
- **Ollama** (`/api/chat`)

Provider detection is path-based. The proxy examines the request path and routes to the correct provider automatically. You can also override detection with the `x-rivano-provider` header.

---

## Connecting Your App

Point your SDK's `baseURL` at the proxy. Your API key stays in `rivano.yaml` -- the proxy injects it before forwarding.

### TypeScript (Anthropic SDK)

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "http://localhost:4000",
});

const response = await client.messages.create({
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
});
```

### Python (Anthropic SDK)

```python
import anthropic

client = anthropic.Anthropic(
    base_url="http://localhost:4000",
)

response = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}],
)
```

### TypeScript (OpenAI SDK)

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:4000",
});

const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});
```

### Python (OpenAI SDK)

```python
import openai

client = openai.OpenAI(
    base_url="http://localhost:4000",
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello"}],
)
```

### curl

```bash
# Anthropic (detected from /v1/messages path)
curl -X POST http://localhost:4000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-5",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# OpenAI (detected from /v1/chat/completions path)
curl -X POST http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# Explicit provider override
curl -X POST http://localhost:4000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-rivano-provider: anthropic" \
  -d '{"model": "claude-sonnet-4-5", "max_tokens": 1024, "messages": [{"role": "user", "content": "Hello"}]}'
```

### Path-Based Provider Detection

| Path prefix              | Provider   |
|--------------------------|------------|
| `/v1/messages`           | `anthropic`|
| `/v1/chat/completions`   | `openai`   |
| `/api/chat`              | `ollama`   |

If the path does not match any known prefix and no `x-rivano-provider` header is set, the proxy returns `400 Bad Request`.

---

## Middleware Pipeline

Every request passes through an ordered pipeline. Each middleware step returns one of three results:

- **`continue`** -- proceed to the next step
- **`block`** -- halt the pipeline and return an error response
- **`short-circuit`** -- skip remaining steps and return early (used by cache hits)

```
                          REQUEST PIPELINE
  ┌─────────────┐   ┌───────────┐   ┌────────┐   ┌───────┐
  │ rate-limit   │──▸│ injection │──▸│ policy │──▸│ cache │
  └─────────────┘   └───────────┘   └────────┘   └───────┘
         │                │               │            │
      block?          scores &         block?      hit? ──▸ short-circuit
                      annotates        redact?              (skip provider)
                                       warn?
                                       tag?
                                                       │
                                                       ▼
                                                  ┌──────────┐
                                                  │ PROVIDER  │
                                                  │ (remote)  │
                                                  └──────────┘
                                                       │
                          RESPONSE PIPELINE            ▼
                                        ┌───────┐  ┌────────┐  ┌───────┐
                                        │ cache │──▸│ policy │──▸│ audit │
                                        └───────┘  └────────┘  └───────┘
                                           │            │            │
                                         store       block?       log to
                                        response     redact?      stdout &
                                                     warn?        jsonl
                                                     tag?
```

**Request pipeline order:** rate-limit, injection, policy (request phase), cache (lookup).

**Response pipeline order:** cache (store), policy (response phase), audit.

If any step returns `block`, the pipeline halts immediately and the proxy returns the error to the caller. If cache returns `short-circuit` on a hit, the proxy skips the provider call entirely and runs the response pipeline against the cached result.

---

## Providers

Configure providers in `rivano.yaml` under the `providers` key. API keys can reference environment variables with `${VAR_NAME}` syntax.

### Anthropic

```yaml
providers:
  anthropic:
    api_key: ${ANTHROPIC_API_KEY}
```

- Default `base_url`: `https://api.anthropic.com`
- The proxy sets the `anthropic-version: 2023-06-01` header automatically.
- Token counts are extracted from `usage.input_tokens` and `usage.output_tokens` in the response.

### OpenAI

```yaml
providers:
  openai:
    api_key: ${OPENAI_API_KEY}
```

- Default `base_url`: `https://api.openai.com`
- The proxy sets `Authorization: Bearer <key>` automatically.
- Token counts are extracted from `usage.prompt_tokens` and `usage.completion_tokens` in the response.

### Ollama

```yaml
providers:
  ollama:
    base_url: "http://host.docker.internal:11434"
```

- Default `base_url`: `http://localhost:11434`
- No authentication required.
- Use `host.docker.internal` when running Rivano in Docker with Ollama on the host.
- Token counts are extracted from `prompt_eval_count` and `eval_count` in the response.

### Default Provider

Set `default_provider` under `proxy` to route requests when the path is ambiguous:

```yaml
proxy:
  default_provider: anthropic
```

### Streaming

All three providers support streaming. When the request body includes `"stream": true`, the proxy passes the stream through directly as `text/event-stream`. Streamed responses bypass response-phase caching.

---

## Policies

Policies are rules that evaluate against request or response content. Each policy has a name, a phase (`request` or `response`), a condition, and an action.

### Structure

```yaml
proxy:
  policies:
    - name: my-policy
      on: request          # "request" or "response"
      condition:
        # one or more conditions (all must match)
      action: block        # "block", "warn", "redact", or "tag"
      message: "Optional human-readable reason"
```

### Conditions

All conditions in a single policy are AND-ed together. If any condition is false, the policy does not match.

| Condition          | Type      | Description                                      |
|--------------------|-----------|--------------------------------------------------|
| `contains`         | `string`  | True if the text includes this exact substring   |
| `regex`            | `string`  | True if the text matches this regular expression |
| `injection_score`  | `number`  | True if injection score >= this threshold (0-1)  |
| `pii_detected`     | `boolean` | True if PII patterns were found in the text      |
| `length_exceeds`   | `number`  | True if text length > this character count       |

### Actions

| Action   | Behavior                                                          |
|----------|-------------------------------------------------------------------|
| `block`  | Halt the pipeline. Returns 403 with the policy's `message`.      |
| `warn`   | Log a warning in the pipeline decisions. Request continues.       |
| `redact` | Replace detected PII with `[REDACTED:type]` tokens. Continues.   |
| `tag`    | Add the policy name to `metadata.tags`. Continues.                |

### Examples

**Block high injection scores:**

```yaml
- name: block-injection
  on: request
  condition:
    injection_score: 0.8
  action: block
  message: "Potential prompt injection detected"
```

**Redact PII from requests before they reach the provider:**

```yaml
- name: redact-pii
  on: request
  condition:
    pii_detected: true
  action: redact
```

**Warn on excessively long prompts:**

```yaml
- name: warn-long-prompt
  on: request
  condition:
    length_exceeds: 50000
  action: warn
  message: "Prompt exceeds 50k characters"
```

**Tag requests containing specific keywords:**

```yaml
- name: tag-code-gen
  on: request
  condition:
    contains: "write code"
  action: tag
```

**Block responses matching a regex:**

```yaml
- name: block-credential-leak
  on: response
  condition:
    regex: "AKIA[0-9A-Z]{16}"
  action: block
  message: "Response contains AWS credentials"
```

Policies are evaluated in order. The first matching `block` policy stops the pipeline. `warn`, `redact`, and `tag` policies run and the pipeline continues to the next policy.

---

## PII Detection

The proxy includes built-in regex patterns for detecting and redacting personally identifiable information.

### Built-in Patterns

| Pattern       | Replacement token        | Example match                  |
|---------------|--------------------------|--------------------------------|
| `email`       | `[REDACTED:email]`       | `user@example.com`             |
| `phone`       | `[REDACTED:phone]`       | `+1 (555) 123-4567`           |
| `ssn`         | `[REDACTED:ssn]`         | `123-45-6789`                  |
| `credit_card` | `[REDACTED:credit_card]` | `4111-1111-1111-1111`          |
| `ip_address`  | `[REDACTED:ip_address]`  | `192.168.1.1`                  |
| `aws_key`     | `[REDACTED:aws_key]`     | `AKIAIOSFODNN7EXAMPLE`         |

### How Redaction Works

When a policy with `action: redact` matches, the proxy replaces all PII matches in message content with their replacement tokens before forwarding to the provider:

```
Input:  "My email is user@example.com and SSN is 123-45-6789"
Output: "My email is [REDACTED:email] and SSN is [REDACTED:ssn]"
```

On the `request` phase, redaction modifies the message content sent to the provider. On the `response` phase, it modifies the response body before returning to the caller.

Lite uses regex-based detection. Rivano Cloud adds ML-based PII detection for higher accuracy and additional entity types (names, addresses, medical records).

---

## Prompt Injection Detection

The injection middleware scores every request on a 0-1 scale using heuristic pattern matching. The score is attached to the pipeline context so policies can use it as a condition.

### Detected Patterns

| Signal                 | Weight | Description                                           |
|------------------------|--------|-------------------------------------------------------|
| `ignore_previous`      | 0.90   | "ignore all previous instructions"                    |
| `system_prompt_extract`| 0.85   | "reveal your system prompt"                           |
| `role_hijacking`       | 0.80   | "you are now a..."                                    |
| `jailbreak_prefix`     | 0.90   | DAN/DUDE/AIM/STAN mode triggers                       |
| `encoding_trick`       | 0.70   | "base64 decode", "rot13 translate"                    |
| `delimiter_injection`  | 0.75   | Fake XML/markdown delimiters (`<system>`, `[INST]`)   |
| `instruction_override` | 0.85   | "new instructions", "override the previous"           |
| `prompt_leak`          | 0.60   | "what are your instructions"                          |

### Scoring

The score is the ratio of matched pattern weights to total possible weight, clamped to [0, 1]. A single high-weight match can push the score past typical thresholds.

The injection middleware itself does **not** block requests. It annotates the context with the score. Use a policy to act on it:

```yaml
policies:
  - name: block-injection
    on: request
    condition:
      injection_score: 0.8
    action: block
    message: "Potential prompt injection detected"
```

Recommended thresholds:
- **0.5** -- conservative, may flag legitimate prompts about prompt engineering
- **0.7** -- balanced for most production use
- **0.8-0.9** -- only catches clear injection attempts

---

## Caching

The proxy includes an in-memory exact-match cache to avoid redundant provider calls.

### How It Works

1. On request, the cache middleware computes a key: `SHA-256(provider + model + messages)`.
2. If the key exists and has not expired, the cached response is returned immediately (short-circuit). The provider is never called.
3. On response, the result is stored in the cache with the computed key.

### Configuration

```yaml
proxy:
  cache:
    enabled: true
    ttl: 3600    # seconds (1 hour)
```

### Behavior

- **Key computation:** SHA-256 hash of `JSON.stringify({ provider, model, messages })`.
- **TTL:** Entries expire after `ttl` seconds from creation.
- **Max entries:** 1000. When the cache is full, the least recently used entry is evicted (LRU).
- **In-memory only.** Cache is lost on restart.
- **Streaming responses are not cached.** Only non-streaming responses are stored.
- **Cache hits are free.** No provider call, no tokens consumed, no cost.

### Stats

Check cache performance via the `/stats` endpoint:

```bash
curl http://localhost:4000/stats
```

Returns:

```json
{
  "requests": 142,
  "cacheHitRate": 0.35,
  "blocks": 2,
  "uptime": 3600000
}
```

---

## Rate Limiting

The proxy uses a token bucket algorithm for per-caller rate limiting.

### Configuration

```yaml
proxy:
  rate_limit:
    requests_per_minute: 60
    burst: 10                # optional, defaults to requests_per_minute
```

### Behavior

- **Per-caller buckets:** Each unique caller gets its own bucket, keyed by `x-api-key` header, falling back to IP address, falling back to `"global"`.
- **Token bucket:** Starts full at `burst` tokens (or `requests_per_minute` if `burst` is not set). Tokens refill at `requests_per_minute / 60` per second.
- **When exceeded:** Returns `429` with `{"error": "Rate limit exceeded"}`.
- **In-memory only.** Buckets reset on restart.

---

## Audit Logging

The audit middleware runs as the last step in the response pipeline and records every request.

### What Gets Logged

Each entry contains:

| Field       | Type     | Description                                |
|-------------|----------|--------------------------------------------|
| `id`        | `string` | Request UUID                               |
| `timestamp` | `number` | Unix timestamp (ms)                        |
| `traceId`   | `string` | Trace ID if observability is enabled       |
| `provider`  | `string` | `anthropic`, `openai`, or `ollama`         |
| `model`     | `string` | Model name from the request                |
| `action`    | `string` | `allowed`, `blocked`, `redacted`, `warned` |
| `reason`    | `string` | Why it was blocked/warned (if applicable)  |
| `latencyMs` | `number` | End-to-end latency in milliseconds         |
| `tokensIn`  | `number` | Input token count (if available)           |
| `tokensOut` | `number` | Output token count (if available)          |
| `costUsd`   | `number` | Estimated cost in USD (if available)       |

### Output

By default, audit entries are written to **stdout** as single-line JSON. File output writes to `rivano-audit.jsonl` (one JSON object per line).

Example entry:

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "timestamp": 1743868800000,
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "action": "allowed",
  "latencyMs": 1842,
  "tokensIn": 156,
  "tokensOut": 512,
  "costUsd": 0.008148
}
```

---

## Health Check

```bash
curl http://localhost:4000/health
```

```json
{
  "status": "ok",
  "uptime": 3600000
}
```
