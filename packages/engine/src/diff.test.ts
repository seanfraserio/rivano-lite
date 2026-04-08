import { describe, expect, test, beforeEach } from "bun:test";
import { computeDiff, formatDiff } from "./diff.js";
import type { AgentConfig } from "@rivano/core";
import type { DeploymentState } from "./state.js";
import { hashConfig } from "./state.js";

describe("computeDiff", () => {
  const baseAgent: AgentConfig = {
    name: "test-agent",
    model: { provider: "anthropic", name: "claude-sonnet-4-5" },
    system_prompt: "You are a helpful assistant.",
  };

  test("creates new agents not in state", () => {
    const emptyState: DeploymentState = { agents: {}, lastUpdated: "" };
    const diffs = computeDiff([baseAgent], emptyState);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].action).toBe("create");
    expect(diffs[0].name).toBe("test-agent");
  });

  test("marks unchanged agents", () => {
    const state: DeploymentState = {
      agents: {
        "test-agent": {
          name: "test-agent",
          configHash: hashConfig(baseAgent),
          deployedAt: "2024-01-01",
          version: 1,
          provider: "anthropic",
          model: "claude-sonnet-4-5",
        },
      },
      lastUpdated: "2024-01-01",
    };
    const diffs = computeDiff([baseAgent], state);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].action).toBe("unchanged");
  });

  test("detects updated agents (config change)", () => {
    const originalAgent: AgentConfig = {
      name: "test-agent",
      model: { provider: "anthropic", name: "claude-sonnet-4-5" },
      system_prompt: "Original prompt",
    };
    const updatedAgent: AgentConfig = {
      name: "test-agent",
      model: { provider: "anthropic", name: "claude-sonnet-4-5" },
      system_prompt: "Updated prompt",
    };
    const state: DeploymentState = {
      agents: {
        "test-agent": {
          name: "test-agent",
          configHash: hashConfig(originalAgent),
          deployedAt: "2024-01-01",
          version: 1,
          provider: "anthropic",
          model: "claude-sonnet-4-5",
        },
      },
      lastUpdated: "2024-01-01",
    };
    const diffs = computeDiff([updatedAgent], state);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].action).toBe("update");
  });

  test("deletes agents not in desired config", () => {
    const state: DeploymentState = {
      agents: {
        "old-agent": {
          name: "old-agent",
          configHash: "abc123",
          deployedAt: "2024-01-01",
          version: 1,
          provider: "anthropic",
          model: "claude-sonnet-4-5",
        },
      },
      lastUpdated: "2024-01-01",
    };
    const diffs = computeDiff([], state);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].action).toBe("delete");
    expect(diffs[0].name).toBe("old-agent");
  });

  test("handles mix of create, update, delete, unchanged", () => {
    const agentA: AgentConfig = {
      name: "agent-a",
      model: { provider: "anthropic", name: "claude-haiku-4-5" },
      system_prompt: "Agent A",
    };
    const agentB: AgentConfig = {
      name: "agent-b",
      model: { provider: "openai", name: "gpt-4o" },
      system_prompt: "Agent B v2",
    };
    const state: DeploymentState = {
      agents: {
        "agent-a": {
          name: "agent-a",
          configHash: hashConfig(agentA),
          deployedAt: "2024-01-01",
          version: 1,
          provider: "anthropic",
          model: "claude-haiku-4-5",
        },
        "agent-b": {
          name: "agent-b",
          configHash: hashConfig({ ...agentB, system_prompt: "Agent B v1" }),
          deployedAt: "2024-01-01",
          version: 1,
          provider: "openai",
          model: "gpt-4o",
        },
        "agent-c": {
          name: "agent-c",
          configHash: "old-hash",
          deployedAt: "2024-01-01",
          version: 1,
          provider: "ollama",
          model: "llama3",
        },
      },
      lastUpdated: "2024-01-01",
    };
    const diffs = computeDiff([agentA, agentB], state);
    expect(diffs).toHaveLength(3);
    // agent-a: unchanged
    expect(diffs.find((d) => d.name === "agent-a")?.action).toBe("unchanged");
    // agent-b: update (different prompt)
    expect(diffs.find((d) => d.name === "agent-b")?.action).toBe("update");
    // agent-c: delete
    expect(diffs.find((d) => d.name === "agent-c")?.action).toBe("delete");
  });
});

describe("formatDiff", () => {
  test("returns message for empty diffs", () => {
    expect(formatDiff([])).toContain("No agents configured");
  });

  test("formats create action", () => {
    const result = formatDiff([
      { name: "new-agent", action: "create", desired: { name: "new-agent", model: { provider: "anthropic", name: "claude-haiku-4-5" }, system_prompt: "test" } },
    ]);
    expect(result).toContain("new-agent");
    expect(result).toContain("1 to create");
  });

  test("formats delete action", () => {
    const result = formatDiff([
      { name: "old-agent", action: "delete", current: { name: "old-agent", configHash: "x", deployedAt: "2024", version: 1, provider: "anthropic", model: "claude" } },
    ]);
    expect(result).toContain("old-agent");
    expect(result).toContain("1 to delete");
  });

  test("includes summary counts", () => {
    const result = formatDiff([
      { name: "a", action: "create" as const, desired: { name: "a", model: { provider: "anthropic", name: "claude-haiku-4-5" }, system_prompt: "x" } },
      { name: "b", action: "unchanged" as const, current: { name: "b", configHash: "x", deployedAt: "2024", version: 1, provider: "openai", model: "gpt-4o" }, desired: { name: "b", model: { provider: "openai", name: "gpt-4o" }, system_prompt: "x" } },
    ]);
    expect(result).toContain("1 to create");
    expect(result).toContain("1 unchanged");
  });
});