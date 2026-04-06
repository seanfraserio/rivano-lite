import type { AgentConfig, Provider } from "@rivano/core";
import type { DiffAction } from "./diff.js";
import { computeDiff } from "./diff.js";
import { loadState, saveState, hashConfig } from "./state.js";

export interface DeployResult {
  agent: string;
  action: DiffAction;
  success: boolean;
  error?: string;
  duration: number;
}

interface DeployOptions {
  dryRun?: boolean;
}

const SUPPORTED_PROVIDERS: Set<Provider> = new Set([
  "anthropic",
  "openai",
  "ollama",
  "bedrock",
]);

export function validate(
  agents: AgentConfig[],
): { valid: boolean; errors: Array<{ agent: string; error: string }> } {
  const errors: Array<{ agent: string; error: string }> = [];

  for (const agent of agents) {
    const label = agent.name || "<unnamed>";

    if (!agent.name) {
      errors.push({ agent: label, error: "Missing required field: name" });
    }
    if (!agent.model?.provider) {
      errors.push({
        agent: label,
        error: "Missing required field: model.provider",
      });
    } else if (!SUPPORTED_PROVIDERS.has(agent.model.provider)) {
      errors.push({
        agent: label,
        error: `Unsupported provider: ${agent.model.provider}`,
      });
    }
    if (!agent.model?.name) {
      errors.push({
        agent: label,
        error: "Missing required field: model.name",
      });
    }
    if (!agent.system_prompt) {
      errors.push({
        agent: label,
        error: "Missing required field: system_prompt",
      });
    }
    if (
      agent.model?.temperature !== undefined &&
      (agent.model.temperature < 0 || agent.model.temperature > 2)
    ) {
      errors.push({
        agent: label,
        error: `Temperature must be between 0 and 2, got ${agent.model.temperature}`,
      });
    }
    if (
      agent.model?.max_tokens !== undefined &&
      agent.model.max_tokens <= 0
    ) {
      errors.push({
        agent: label,
        error: `max_tokens must be positive, got ${agent.model.max_tokens}`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function deploy(
  agents: AgentConfig[],
  statePath: string,
  options?: DeployOptions,
): Promise<DeployResult[]> {
  const state = await loadState(statePath);
  const diffs = computeDiff(agents, state);
  const results: DeployResult[] = [];

  for (const diff of diffs) {
    if (diff.action === "unchanged") {
      results.push({
        agent: diff.name,
        action: "unchanged",
        success: true,
        duration: 0,
      });
      continue;
    }

    if (options?.dryRun) {
      results.push({
        agent: diff.name,
        action: diff.action,
        success: true,
        duration: 0,
      });
      continue;
    }

    const start = performance.now();

    try {
      if (diff.action === "create" || diff.action === "update") {
        const agent = diff.desired!;
        const validation = validate([agent]);
        if (!validation.valid) {
          results.push({
            agent: diff.name,
            action: diff.action,
            success: false,
            error: validation.errors.map((e) => e.error).join("; "),
            duration: performance.now() - start,
          });
          continue;
        }

        const existing = state.agents[diff.name];
        state.agents[diff.name] = {
          name: agent.name,
          configHash: hashConfig(agent),
          deployedAt: new Date().toISOString(),
          version: existing ? existing.version + 1 : 1,
          provider: agent.model.provider,
          model: agent.model.name,
        };
      } else if (diff.action === "delete") {
        delete state.agents[diff.name];
      }

      results.push({
        agent: diff.name,
        action: diff.action,
        success: true,
        duration: performance.now() - start,
      });
    } catch (err) {
      results.push({
        agent: diff.name,
        action: diff.action,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        duration: performance.now() - start,
      });
    }
  }

  if (!options?.dryRun) {
    state.lastUpdated = new Date().toISOString();
    await saveState(statePath, state);
  }

  return results;
}
