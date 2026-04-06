import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentConfig } from "@rivano/core";

export interface AgentState {
  name: string;
  configHash: string;
  deployedAt: string;
  version: number;
  provider: string;
  model: string;
}

export interface DeploymentState {
  agents: Record<string, AgentState>;
  lastUpdated: string;
}

function emptyState(): DeploymentState {
  return { agents: {}, lastUpdated: new Date().toISOString() };
}

export async function loadState(statePath: string): Promise<DeploymentState> {
  try {
    const raw = await readFile(statePath, "utf-8");
    return JSON.parse(raw) as DeploymentState;
  } catch {
    return emptyState();
  }
}

export async function saveState(
  statePath: string,
  state: DeploymentState,
): Promise<void> {
  const dir = dirname(statePath);
  await mkdir(dir, { recursive: true });

  const tmpPath = join(dir, `.state.tmp.${Date.now()}`);
  const content = JSON.stringify(state, null, 2);

  await writeFile(tmpPath, content, "utf-8");
  await rename(tmpPath, statePath);
}

function sortedStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(sortedStringify).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map(
    (k) =>
      `${JSON.stringify(k)}:${sortedStringify((value as Record<string, unknown>)[k])}`,
  );
  return "{" + entries.join(",") + "}";
}

export function hashConfig(agent: AgentConfig): string {
  const serialized = sortedStringify(agent);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(serialized);
  return hasher.digest("hex");
}
