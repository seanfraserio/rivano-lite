import { describe, expect, test } from "bun:test";
import { validate } from "./deploy.js";
import type { AgentConfig } from "@rivano/core";

describe("validate", () => {
  test("accepts valid agent config", () => {
    const agents: AgentConfig[] = [
      {
        name: "my-agent",
        model: { provider: "anthropic", name: "claude-sonnet-4-5" },
        system_prompt: "You are a helpful assistant.",
      },
    ];
    const result = validate(agents);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("rejects agent without name", () => {
    const agents = [
      { model: { provider: "anthropic" as const, name: "claude-sonnet-4-5" }, system_prompt: "test" },
    ] as AgentConfig[];
    const result = validate(agents);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.error.includes("name"))).toBe(true);
  });

  test("rejects agent without model.provider", () => {
    const agents = [
      { name: "test", model: { name: "claude-sonnet-4-5" }, system_prompt: "test" },
    ] as AgentConfig[];
    const result = validate(agents);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.error.includes("model.provider"))).toBe(true);
  });

  test("rejects unsupported provider", () => {
    const agents = [
      { name: "test", model: { provider: "unsupported", name: "test" }, system_prompt: "test" },
    ] as unknown as AgentConfig[];
    const result = validate(agents);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.error.includes("Unsupported provider"))).toBe(true);
  });

  test("rejects agent without model.name", () => {
    const agents = [
      { name: "test", model: { provider: "anthropic" as const }, system_prompt: "test" },
    ] as AgentConfig[];
    const result = validate(agents);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.error.includes("model.name"))).toBe(true);
  });

  test("rejects agent without system_prompt", () => {
    const agents = [
      { name: "test", model: { provider: "anthropic" as const, name: "claude" } },
    ] as AgentConfig[];
    const result = validate(agents);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.error.includes("system_prompt"))).toBe(true);
  });

  test("rejects temperature outside 0-2 range", () => {
    const agents: AgentConfig[] = [
      { name: "test", model: { provider: "anthropic", name: "claude", temperature: 3 }, system_prompt: "test" },
    ];
    const result = validate(agents);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.error.includes("Temperature"))).toBe(true);
  });

  test("rejects negative max_tokens", () => {
    const agents: AgentConfig[] = [
      { name: "test", model: { provider: "anthropic", name: "claude", max_tokens: -1 }, system_prompt: "test" },
    ];
    const result = validate(agents);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.error.includes("max_tokens"))).toBe(true);
  });

  test("accepts valid temperature range (0-2)", () => {
    const agents: AgentConfig[] = [
      { name: "test", model: { provider: "anthropic", name: "claude", temperature: 1.5 }, system_prompt: "test" },
    ];
    const result = validate(agents);
    expect(result.valid).toBe(true);
  });

  test("collects multiple errors", () => {
    const agents = [
      { model: {}, system_prompt: "x" },
    ] as AgentConfig[];
    const result = validate(agents);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});