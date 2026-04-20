import type { AgentConfig } from "@rivano/core";
import type { AgentState, DeploymentState } from "./state.js";
import { hashConfig } from "./state.js";

export type DiffAction = "create" | "update" | "delete" | "unchanged";

export interface AgentDiff {
  name: string;
  action: DiffAction;
  current?: AgentState;
  desired?: AgentConfig;
  changes?: string[];
}

function detectChanges(current: AgentState, desired: AgentConfig): string[] {
  const changes: string[] = [];

  if (current.provider !== desired.model.provider) {
    changes.push(`provider: ${current.provider} -> ${desired.model.provider}`);
  }
  if (current.model !== desired.model.name) {
    changes.push(`model: ${current.model} -> ${desired.model.name}`);
  }

  if (changes.length === 0) {
    changes.push("config hash changed (system_prompt, tools, temperature, or other fields)");
  }

  return changes;
}

export function computeDiff(desired: AgentConfig[], currentState: DeploymentState): AgentDiff[] {
  const diffs: AgentDiff[] = [];
  const desiredNames = new Set<string>();

  for (const agent of desired) {
    desiredNames.add(agent.name);
    const current = currentState.agents[agent.name];
    const newHash = hashConfig(agent);

    if (!current) {
      diffs.push({ name: agent.name, action: "create", desired: agent });
    } else if (current.configHash !== newHash) {
      diffs.push({
        name: agent.name,
        action: "update",
        current,
        desired: agent,
        changes: detectChanges(current, agent),
      });
    } else {
      diffs.push({
        name: agent.name,
        action: "unchanged",
        current,
        desired: agent,
      });
    }
  }

  for (const [name, state] of Object.entries(currentState.agents)) {
    if (!desiredNames.has(name)) {
      diffs.push({ name, action: "delete", current: state });
    }
  }

  return diffs;
}

const ANSI = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
} as const;

export function formatDiff(diffs: AgentDiff[]): string {
  if (diffs.length === 0) return "No agents configured.";

  const lines: string[] = [];
  lines.push(`${ANSI.bold}Agent Deployment Plan${ANSI.reset}`);
  lines.push("");

  const counts = { create: 0, update: 0, delete: 0, unchanged: 0 };

  for (const diff of diffs) {
    counts[diff.action]++;

    switch (diff.action) {
      case "create":
        lines.push(
          `${ANSI.green}+ ${diff.name}${ANSI.reset}  (${diff.desired?.model.provider}/${diff.desired?.model.name})`,
        );
        break;
      case "update":
        lines.push(`${ANSI.yellow}~ ${diff.name}${ANSI.reset}`);
        if (diff.changes) {
          for (const change of diff.changes) {
            lines.push(`  ${ANSI.yellow}  ${change}${ANSI.reset}`);
          }
        }
        break;
      case "delete":
        lines.push(`${ANSI.red}- ${diff.name}${ANSI.reset}  (${diff.current?.provider}/${diff.current?.model})`);
        break;
      case "unchanged":
        lines.push(`${ANSI.gray}= ${diff.name}${ANSI.reset}  ${ANSI.gray}(no changes)${ANSI.reset}`);
        break;
    }
  }

  lines.push("");
  lines.push(
    `${ANSI.bold}Summary:${ANSI.reset} ${counts.create} to create, ${counts.update} to update, ${counts.delete} to delete, ${counts.unchanged} unchanged`,
  );

  return lines.join("\n");
}
