import { describe, expect, test } from "bun:test";
import type { AgentConfig } from "@rivano/core";
import { hashConfig } from "./state.js";

describe("hashConfig", () => {
  test("produces a deterministic SHA-256 hex string", () => {
    const agent: AgentConfig = {
      name: "test",
      model: { provider: "anthropic", name: "claude-sonnet-4-5" },
      system_prompt: "hello",
    };
    const hash1 = hashConfig(agent);
    const hash2 = hashConfig(agent);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex = 64 chars
  });

  test("produces different hashes for different configs", () => {
    const agent1: AgentConfig = {
      name: "test",
      model: { provider: "anthropic", name: "claude-sonnet-4-5" },
      system_prompt: "hello",
    };
    const agent2: AgentConfig = {
      name: "test",
      model: { provider: "anthropic", name: "claude-sonnet-4-5" },
      system_prompt: "goodbye",
    };
    expect(hashConfig(agent1)).not.toBe(hashConfig(agent2));
  });

  test("is order-independent for object keys", () => {
    const hash1 = hashConfig({ a: 1, b: 2 } as unknown as AgentConfig);
    const hash2 = hashConfig({ b: 2, a: 1 } as unknown as AgentConfig);
    expect(hash1).toBe(hash2);
  });

  test("handles nested objects", () => {
    const agent: AgentConfig = {
      name: "nested-test",
      model: { provider: "openai", name: "gpt-4o", temperature: 0.7 },
      system_prompt: "test",
    };
    const hash = hashConfig(agent);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
