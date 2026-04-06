# Upgrading to Rivano Cloud

## Why Upgrade

Rivano Lite is designed for individual developers running locally. When your usage grows beyond that, Rivano Cloud provides the infrastructure for teams and production workloads.

Consider upgrading when you need:

- **Team collaboration** -- Multiple developers managing agents and policies
- **Production governance** -- Role-based access, environment promotion gates, deployment audit trails
- **Compliance** -- SOC2, HIPAA, and enterprise authentication (OAuth, SAML)
- **Scale** -- Distributed rate limiting, semantic caching, ML-based detection

## Feature Comparison

| Capability | Lite (OSS) | Cloud |
|---|---|---|
| **AI Proxy** | Anthropic, OpenAI, Ollama, Bedrock | All providers + custom endpoints |
| **PII Detection** | Regex-based pattern matching | ML-based named entity recognition |
| **Injection Detection** | Heuristic scoring | ML models with continuous updates |
| **Cache** | Exact-match (in-memory) | Semantic similarity (ML embeddings) |
| **Rate Limiting** | In-memory, single process | Distributed across nodes |
| **Tracing** | Full spans, timing, cost attribution | + PII detection in traces |
| **Storage** | SQLite (local file) | Managed Postgres (multi-region) |
| **Agent Deployment** | Local, single user | Multi-environment with promotion gates |
| **Auth** | None | OAuth, SAML, RBAC |
| **Alerts** | None | Slack, PagerDuty, webhooks |
| **Compliance** | None | SOC2, HIPAA |
| **Support** | Community (GitHub Issues) | Dedicated support + SLAs |
| **Deployment** | Self-hosted container | Managed or self-hosted |
| **Price** | Free | Usage-based |

## Migration Path

Migration is straightforward because Lite and Cloud share the same configuration format, API surface, and SDK compatibility.

### Step 1: Export Your Data

```bash
rivano export --output ./rivano-backup/
```

This exports your traces, agent state, and configuration.

### Step 2: Update Your Endpoint

Your `rivano.yaml` stays the same. Point the proxy to your Cloud instance:

```yaml
# No changes to providers, policies, agents, or observer config.
# The Cloud dashboard handles endpoint routing.
```

### Step 3: Update SDK Base URL

Your application code requires a one-line change:

```typescript
const client = new Anthropic({
  // Before: baseURL: "http://localhost:4000/v1"
  baseURL: "https://your-org.rivano.ai/v1",
});
```

```python
# Before: base_url="http://localhost:4000/v1"
client = Anthropic(base_url="https://your-org.rivano.ai/v1")
```

### Step 4: Import Data (Optional)

Import your exported traces and configuration into Cloud via the dashboard or CLI.

## What Stays the Same

- **Config format** -- `rivano.yaml` syntax is identical. No rewriting configs.
- **API endpoints** -- Same `/v1` proxy paths. SDKs work without code changes beyond the base URL.
- **Policy syntax** -- Policies defined in Lite work in Cloud unchanged.
- **Agent definitions** -- Same YAML schema, same validation rules.
- **CLI commands** -- `rivano start`, `rivano status`, etc. work the same way.

## What Changes

| Area | Lite | Cloud |
|---|---|---|
| **Storage** | SQLite file at `~/.rivano/data/` | Managed Postgres (automatic backups, replication) |
| **Auth** | None -- local access only | OAuth/SAML for user identity, RBAC for permissions |
| **PII Detection** | Regex patterns for SSN, email, phone, etc. | ML-based NER that handles names, addresses, context-dependent PII |
| **Cache** | Exact string match on prompts | Semantic similarity using embeddings (catches paraphrased queries) |
| **Rate Limiting** | In-memory counters (reset on restart) | Distributed counters across nodes (persistent, coordinated) |
| **Agent Deployment** | Single local state file | Multi-environment (dev/staging/prod) with promotion gates and RBAC |

## Get Started

1. Visit [rivano.ai](https://rivano.ai) to create an account
2. In the Rivano Lite WebUI, go to **Settings** and click **Upgrade to Cloud**
3. Follow the guided migration to connect your existing configuration
