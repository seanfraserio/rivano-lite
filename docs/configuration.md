# Configuration Reference

All Rivano Lite configuration lives in a single `rivano.yaml` file. By default this file is located at `~/.rivano/rivano.yaml` (mapped to `/data/rivano.yaml` inside the container). You can override the path with the `RIVANO_CONFIG` environment variable.

The config supports `${ENV_VAR}` interpolation and is hot-reloaded on change — no restart required.

---

## Full Example

```yaml
version: "1"

# ─── AI Providers ───────────────────────────────────────────
providers:
  anthropic:
    api_key: ${ANTHROPIC_API_KEY}
    models:
      - claude-sonnet-4-5
      - claude-haiku-4-5

  openai:
    api_key: ${OPENAI_API_KEY}
    base_url: "https://api.openai.com/v1"  # optional, shown for clarity
    models:
      - gpt-4o
      - gpt-4o-mini

  ollama:
    base_url: "http://host.docker.internal:11434"

  bedrock:
    # Uses AWS credentials from the environment (AWS_ACCESS_KEY_ID, etc.)

# ─── Proxy Gateway ──────────────────────────────────────────
proxy:
  port: 4000
  default_provider: anthropic
  cache:
    enabled: true
    ttl: 3600                    # seconds
  rate_limit:
    requests_per_minute: 120
    burst: 20                    # optional, concurrent burst allowance
  policies:
    - name: block-injection
      on: request
      condition:
        injection_score: 0.8     # trigger when score >= 0.8
      action: block
      message: "Potential prompt injection detected"

    - name: redact-pii
      on: request
      condition:
        pii_detected: true
      action: redact

    - name: limit-length
      on: request
      condition:
        length_exceeds: 50000
      action: block
      message: "Request too long"

    - name: block-keyword
      on: request
      condition:
        contains: "CONFIDENTIAL"
      action: block
      message: "Message contains restricted content"

    - name: flag-pattern
      on: response
      condition:
        regex: "(?i)internal\\s+use\\s+only"
      action: tag

# ─── Observability ──────────────────────────────────────────
observer:
  port: 4100
  storage: sqlite
  retention_days: 30
  evaluators:
    - latency
    - cost

# ─── Agents ─────────────────────────────────────────────────
agents:
  - name: support-triage
    description: "Classifies and routes support tickets"
    model:
      provider: anthropic
      name: claude-sonnet-4-5
      temperature: 0.3
      max_tokens: 2048
    system_prompt: |
      You classify support tickets into categories:
      billing, technical, feature-request, bug-report.
    tools:
      - search
      - create-ticket
    memory: true

  - name: local-assistant
    model:
      provider: ollama
      name: llama3.2
      temperature: 0.7
    system_prompt: |
      You are a helpful AI assistant running locally.
```

---

## Reference

### `version`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `version` | `string` | Yes | — | Schema version. Always `"1"`. |

---

### `providers`

A map of provider name to provider configuration. The key is the provider identifier used elsewhere in the config (e.g., in `proxy.default_provider` or `agents[].model.provider`).

Supported provider names: `anthropic`, `openai`, `ollama`, `bedrock`.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `api_key` | `string` | No | — | API key for the provider. Supports `${ENV_VAR}` interpolation. Not needed for Ollama or Bedrock (which uses AWS env credentials). |
| `base_url` | `string` | No | Provider default | Base URL for API requests. Required for Ollama; optional override for others. |
| `models` | `string[]` | No | — | Allowlist of model names. When set, only these models can be used through the proxy for this provider. |

#### Provider Defaults

| Provider | Default `base_url` | Auth |
|----------|-------------------|------|
| `anthropic` | `https://api.anthropic.com` | `api_key` required |
| `openai` | `https://api.openai.com/v1` | `api_key` required |
| `ollama` | — (must be set, typically `http://host.docker.internal:11434`) | None |
| `bedrock` | AWS SDK default | Uses `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` from environment |

---

### `proxy`

Configuration for the AI proxy gateway that routes requests and enforces policies.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `port` | `integer` | Yes | — | Port the proxy listens on. Must be positive. |
| `default_provider` | `string` | Yes | — | Default provider for requests that don't specify one. One of: `anthropic`, `openai`, `ollama`, `bedrock`. |
| `cache` | `object` | Yes | — | Response cache settings. |
| `cache.enabled` | `boolean` | Yes | — | Enable or disable exact-match response caching. |
| `cache.ttl` | `number` | Yes | — | Cache time-to-live in seconds. Must be positive. |
| `rate_limit` | `object` | Yes | — | Rate limiting settings. |
| `rate_limit.requests_per_minute` | `integer` | Yes | — | Maximum requests per minute. Must be positive. |
| `rate_limit.burst` | `integer` | No | — | Maximum concurrent burst allowance. Must be positive when set. |
| `policies` | `Policy[]` | Yes | `[]` | Ordered array of policy rules. Evaluated top-to-bottom; first match wins. |

---

### `proxy.policies[]`

Each policy defines a condition to check against a request or response, and an action to take when matched. Policies are evaluated in order — the first matching policy determines the outcome.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | Yes | — | Unique name for this policy. Used in logs and traces. |
| `on` | `string` | Yes | — | When to evaluate: `"request"` (before sending to provider) or `"response"` (after receiving from provider). |
| `condition` | `object` | Yes | — | Condition to match. See condition fields below. Multiple fields in a single condition are AND-ed together. |
| `action` | `string` | Yes | — | Action when condition matches. One of: `block`, `warn`, `redact`, `tag`. |
| `message` | `string` | No | — | Human-readable message returned or logged when the policy triggers. |

#### Actions

| Action | Behavior |
|--------|----------|
| `block` | Reject the request with a 403. The `message` field is returned in the error response. |
| `warn` | Allow the request but log a warning in the trace. |
| `redact` | Strip matched content (PII patterns) before forwarding to the provider. |
| `tag` | Allow the request and attach a metadata tag to the trace for later filtering. |

#### Condition Fields

All condition fields are optional. When multiple fields are present in a single condition, all must match (AND logic).

| Field | Type | Description |
|-------|------|-------------|
| `contains` | `string` | Matches if the text contains this exact substring. |
| `regex` | `string` | Matches if the text matches this regular expression (JavaScript `RegExp` syntax). |
| `injection_score` | `number` (0.0 - 1.0) | Matches if the computed prompt injection score is **greater than or equal to** this threshold. The score is derived from a weighted heuristic that checks for known injection patterns (role hijacking, instruction override, delimiter injection, etc.). |
| `pii_detected` | `boolean` | Matches if PII detection finds (or does not find, if `false`) personally identifiable information. Detected PII types: email, phone, SSN, credit card, IP address, AWS access key. |
| `length_exceeds` | `number` | Matches if the text length is **strictly greater than** this value (in characters). Must be positive. |

---

### `observer`

Configuration for the observability service that captures traces, spans, and quality metrics.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `port` | `integer` | Yes | — | Port the observer API listens on. Must be positive. |
| `storage` | `string` | Yes | — | Storage backend. Currently only `"sqlite"` is supported. |
| `retention_days` | `integer` | Yes | — | Number of days to retain trace data before automatic cleanup. Must be positive. |
| `evaluators` | `string[]` | Yes | — | List of evaluators to run on each trace. |

#### Available Evaluators

| Evaluator | Description |
|-----------|-------------|
| `latency` | Computes per-span and total trace latency metrics. |
| `cost` | Estimates USD cost per span and total trace cost based on token counts and model pricing. |

---

### `agents[]`

Define agents as code. Each agent is deployed idempotently when the config loads or reloads.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | Yes | — | Unique agent identifier. Used in API calls and traces. |
| `description` | `string` | No | — | Human-readable description of the agent's purpose. |
| `model` | `object` | Yes | — | Model configuration for this agent. |
| `model.provider` | `string` | Yes | — | Provider to use. One of: `anthropic`, `openai`, `ollama`, `bedrock`. |
| `model.name` | `string` | Yes | — | Model name (e.g., `claude-sonnet-4-5`, `gpt-4o`, `llama3.2`). |
| `model.temperature` | `number` | No | — | Sampling temperature. Range: 0.0 - 2.0. |
| `model.max_tokens` | `integer` | No | — | Maximum tokens in the response. Must be positive. |
| `system_prompt` | `string` | Yes | — | The system prompt sent with every request to this agent. Supports YAML multiline syntax (`\|`). |
| `tools` | `string[]` | No | — | List of tool names the agent can invoke. |
| `memory` | `boolean` | No | — | Enable conversation memory for this agent. |

---

## Environment Variable Interpolation

Any value in `rivano.yaml` can reference environment variables with `${VAR_NAME}` syntax. Variables are resolved at config load time.

```yaml
providers:
  anthropic:
    api_key: ${ANTHROPIC_API_KEY}
  openai:
    api_key: ${OPENAI_API_KEY}
```

### .env File

Place a `.env` file at `~/.rivano/.env` (or `/data/.env` inside the container). Variables defined there are loaded automatically before config interpolation.

```
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENAI_API_KEY=sk-...
```

### Behavior

- If a referenced variable is **not set**, config loading fails with an error naming the missing variable.
- Interpolation applies to the raw YAML text before parsing, so `${VAR}` works in any value position (strings, URLs, keys).
- Variables are trimmed of surrounding whitespace before lookup.

---

## Hot Reload Behavior

Rivano watches `rivano.yaml` with a filesystem watcher (debounced at 500ms). When the file changes:

1. The new YAML is read and validated against the schema.
2. If validation passes:
   - **Proxy** is restarted with new settings (port, policies, cache, rate limits).
   - **Agents** are redeployed with updated definitions.
   - A `"Reload complete"` log entry is emitted.
3. If validation fails:
   - The existing configuration continues running unchanged.
   - A `"Reload failed"` error is logged with the validation error.

### What Reloads

| Component | Reloaded on change? |
|-----------|-------------------|
| Providers (keys, URLs, models) | Yes |
| Proxy (port, policies, cache, rate limit) | Yes |
| Agents (model, prompt, tools) | Yes |
| Observer port | **No** — requires a full restart |
| Observer storage / retention | **No** — requires a full restart |

The observer is started once at boot and is not restarted by the config watcher. To change observer settings, restart the container.

---

## Validation

You can validate a `rivano.yaml` file without applying it using any of these methods:

### CLI

```bash
rivano config validate
```

Reads the current config file, runs Zod schema validation, and prints any errors.

### WebUI

Open the config editor at `http://localhost:9000` and use the **Validate** button. Validation runs client-side before saving.

### API

```bash
curl -X POST http://localhost:9000/api/config/validate \
  -H "Content-Type: application/json" \
  -d '{"yaml": "version: \"1\"\nproviders: {}\nproxy:\n  port: 4000\n  ..."}'
```

**Response (valid):**
```json
{ "valid": true }
```

**Response (invalid):**
```json
{ "valid": false, "errors": ["Expected number, received string at \"proxy.port\""] }
```

Validation checks:
- All required fields are present.
- Types are correct (e.g., ports are positive integers, `injection_score` is 0.0-1.0, `temperature` is 0.0-2.0).
- Enum values are valid (provider names, policy actions, `on` values).
- Environment variable references resolve to defined variables.
