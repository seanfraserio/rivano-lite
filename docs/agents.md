# Agent Deployment Guide

## Overview

Rivano Lite lets you define AI agents as code in `rivano.yaml` and deploy them idempotently. Every agent configuration is version-controlled, diffed before applying, and tracked via SHA-256 config hashing. No manual state management required.

## Defining Agents

Agents live in the `agents` section of `rivano.yaml`. Each agent specifies a model, system prompt, and optional tools/memory settings.

```yaml
agents:
  - name: support-agent
    description: "Handles customer support inquiries"
    model:
      provider: anthropic
      name: claude-sonnet-4-5
      temperature: 0.7
      max_tokens: 4096
    system_prompt: |
      You are a customer support agent. Be concise, empathetic,
      and escalate billing issues to a human.
    tools:
      - search_knowledge_base
      - create_ticket
    memory: true
```

### Field Reference

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Unique identifier for the agent |
| `description` | No | Human-readable description |
| `model.provider` | Yes | One of: `anthropic`, `openai`, `ollama`, `bedrock` |
| `model.name` | Yes | Model identifier (e.g., `claude-sonnet-4-5`, `gpt-4o`) |
| `model.temperature` | No | Sampling temperature, 0-2 |
| `model.max_tokens` | No | Maximum output tokens, must be positive |
| `system_prompt` | Yes | The agent's system instructions |
| `tools` | No | List of tool names the agent can invoke |
| `memory` | No | Enable conversation memory (`true`/`false`) |

## How Deployment Works

Deployment is idempotent. Running it twice with the same config produces no changes.

1. **Load state** -- The engine reads `~/.rivano/data/state.json` (created automatically, not committed to git).
2. **Compute diff** -- Each agent's config is serialized with sorted keys and hashed with SHA-256. The hash is compared against the stored hash.
3. **Apply changes** -- Only agents with changed hashes are redeployed. New agents are created, removed agents are deleted.
4. **Save state** -- The updated state is written atomically (write to temp file, then rename).

Each agent in state tracks:
- `configHash` -- SHA-256 of the serialized config
- `version` -- Incremented on every update
- `deployedAt` -- ISO timestamp of last deployment
- `provider` and `model` -- For quick status lookups

## Diffing

Before applying changes, the engine computes a diff between your desired config and the current state. Use `--dry-run` to preview without applying.

### Diff Actions

| Symbol | Color | Action | Meaning |
|---|---|---|---|
| `+` | Green | create | New agent, not in current state |
| `~` | Yellow | update | Agent exists but config hash changed |
| `-` | Red | delete | Agent in state but removed from config |
| `=` | Gray | unchanged | Config hash matches, no action needed |

### Example Output

```
Agent Deployment Plan

+ code-reviewer  (anthropic/claude-sonnet-4-5)
~ support-agent
    provider: openai -> anthropic
    config hash changed (system_prompt, tools, temperature, or other fields)
- legacy-bot  (openai/gpt-3.5-turbo)
= triage-agent  (no changes)

Summary: 1 to create, 1 to update, 1 to delete, 1 unchanged
```

Any field change -- even a single character in the system prompt -- produces a new hash and triggers an update.

## Multi-Agent Configuration

Define multiple agents in a single config. All agents route through the same Rivano proxy, sharing policies, caching, and observability.

```yaml
agents:
  - name: triage-agent
    description: "Routes incoming requests to the right specialist"
    model:
      provider: anthropic
      name: claude-haiku-4
      temperature: 0.3
      max_tokens: 1024
    system_prompt: |
      You are a triage agent. Classify the user's request into one of:
      support, engineering, billing. Respond with only the category.
    tools:
      - classify_intent

  - name: engineering-agent
    description: "Handles technical questions and debugging"
    model:
      provider: anthropic
      name: claude-sonnet-4-5
      temperature: 0.5
      max_tokens: 8192
    system_prompt: |
      You are a senior engineer. Help users debug issues, explain
      architecture decisions, and write code examples.
    tools:
      - search_docs
      - run_query
    memory: true

  - name: summarizer
    description: "Produces concise summaries of conversations"
    model:
      provider: openai
      name: gpt-4o-mini
      temperature: 0.2
      max_tokens: 2048
    system_prompt: |
      Summarize the conversation in 3-5 bullet points.
      Focus on decisions made, action items, and open questions.
```

## Validation

The engine validates every agent before deployment. Invalid agents are skipped with an error -- they do not block other agents from deploying.

### Validation Rules

- **`name`** -- Required, must be present
- **`model.provider`** -- Required, must be one of: `anthropic`, `openai`, `ollama`, `bedrock`
- **`model.name`** -- Required, must be present
- **`system_prompt`** -- Required, must be present
- **`model.temperature`** -- If set, must be between 0 and 2 (inclusive)
- **`model.max_tokens`** -- If set, must be a positive number

## Lite vs Cloud

Rivano Lite gives you local, single-developer agent deployment. Rivano Cloud adds the operational layer needed for teams and production environments.

| Capability | Lite | Cloud |
|---|---|---|
| Agent definitions in YAML | Yes | Yes |
| Idempotent deployment | Yes | Yes |
| Config diffing | Yes | Yes |
| Validation | Yes | Yes |
| Audit trail | -- | Full history with user attribution |
| Deployment RBAC | -- | Role-based access per environment |
| Environment promotion | -- | Gated dev -> staging -> production |
| Secrets management | -- | Encrypted, scoped to environments |
| SSO/SAML | -- | Enterprise identity providers |

[Upgrade to Rivano Cloud](https://rivano.ai) when you need team collaboration, environment promotion gates, or compliance audit trails.
