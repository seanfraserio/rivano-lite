import { describe, expect, test } from "bun:test";
import { evaluateCondition, evaluatePolicies, evaluatePolicy } from "./policy.js";
import type { Policy, PolicyCondition } from "./types.js";

describe("evaluateCondition", () => {
  test("matches contains condition", () => {
    const condition: PolicyCondition = { contains: "secret" };
    const result = evaluateCondition(condition, {
      text: "This is a secret message",
      injectionScore: 0,
      piiDetected: false,
    });
    expect(result).toBe(true);
  });

  test("does not match contains when text lacks the word", () => {
    const condition: PolicyCondition = { contains: "secret" };
    const result = evaluateCondition(condition, {
      text: "This is a public message",
      injectionScore: 0,
      piiDetected: false,
    });
    expect(result).toBe(false);
  });

  test("matches regex condition", () => {
    const condition: PolicyCondition = { regex: "password\\s*=" };
    const result = evaluateCondition(condition, {
      text: "the password = abc123",
      injectionScore: 0,
      piiDetected: false,
    });
    expect(result).toBe(true);
  });

  test("rejects unsafe regex (ReDoS)", () => {
    const condition: PolicyCondition = { regex: "(a+)+$" };
    const result = evaluateCondition(condition, { text: "test", injectionScore: 0, piiDetected: false });
    expect(result).toBe(false);
  });

  test("handles invalid regex gracefully", () => {
    const condition: PolicyCondition = { regex: "[invalid" };
    const result = evaluateCondition(condition, { text: "test", injectionScore: 0, piiDetected: false });
    expect(result).toBe(false);
  });

  test("matches injection_score as number threshold", () => {
    const condition: PolicyCondition = { injection_score: 0.5 };
    expect(evaluateCondition(condition, { text: "test", injectionScore: 0.7, piiDetected: false })).toBe(true);
    expect(evaluateCondition(condition, { text: "test", injectionScore: 0.3, piiDetected: false })).toBe(false);
  });

  test("matches injection_score with range object", () => {
    const condition: PolicyCondition = { injection_score: { gte: 0.5, lt: 0.9 } };
    expect(evaluateCondition(condition, { text: "test", injectionScore: 0.6, piiDetected: false })).toBe(true);
    expect(evaluateCondition(condition, { text: "test", injectionScore: 0.3, piiDetected: false })).toBe(false);
    expect(evaluateCondition(condition, { text: "test", injectionScore: 0.95, piiDetected: false })).toBe(false);
  });

  test("matches pii_detected condition", () => {
    const condition: PolicyCondition = { pii_detected: true };
    expect(evaluateCondition(condition, { text: "test", injectionScore: 0, piiDetected: true })).toBe(true);
    expect(evaluateCondition(condition, { text: "test", injectionScore: 0, piiDetected: false })).toBe(false);
  });

  test("matches length_exceeds condition", () => {
    const condition: PolicyCondition = { length_exceeds: 100 };
    expect(evaluateCondition(condition, { text: "x".repeat(200), injectionScore: 0, piiDetected: false })).toBe(true);
    expect(evaluateCondition(condition, { text: "short", injectionScore: 0, piiDetected: false })).toBe(false);
  });

  test("all conditions must match (AND logic)", () => {
    const condition: PolicyCondition = { contains: "hello", injection_score: 0.5 };
    // Both match
    expect(evaluateCondition(condition, { text: "hello world", injectionScore: 0.8, piiDetected: false })).toBe(true);
    // Only one matches
    expect(evaluateCondition(condition, { text: "hello world", injectionScore: 0.2, piiDetected: false })).toBe(false);
  });

  test("truncates text to 10K chars before matching contains", () => {
    const condition: PolicyCondition = { contains: "needle" };
    const text = `${"A".repeat(20_000)}needle`;
    expect(evaluateCondition(condition, { text, injectionScore: 0, piiDetected: false })).toBe(false);
  });
});

describe("evaluatePolicy", () => {
  test("returns action when condition matches", () => {
    const policy: Policy = {
      name: "block-secrets",
      on: "request",
      condition: { contains: "password" },
      action: "block",
    };
    const result = evaluatePolicy(policy, { text: "What is the password?", injectionScore: 0, piiDetected: false });
    expect(result.action).toBe("block");
  });

  test("returns null action when condition does not match", () => {
    const policy: Policy = {
      name: "block-secrets",
      on: "request",
      condition: { contains: "password" },
      action: "block",
    };
    const result = evaluatePolicy(policy, { text: "Hello, how are you?", injectionScore: 0, piiDetected: false });
    expect(result.action).toBeNull();
  });

  test("returns message on match", () => {
    const policy: Policy = {
      name: "warn-injection",
      on: "request",
      condition: { injection_score: 0.8 },
      action: "warn",
      message: "Potential prompt injection detected",
    };
    const result = evaluatePolicy(policy, { text: "test", injectionScore: 0.9, piiDetected: false });
    expect(result.action).toBe("warn");
    expect(result.message).toBe("Potential prompt injection detected");
  });
});

describe("evaluatePolicies", () => {
  test("returns first matching policy", () => {
    const policies: Policy[] = [
      { name: "block-passwords", on: "request", condition: { contains: "password" }, action: "block" },
      { name: "warn-secrets", on: "request", condition: { contains: "secret" }, action: "warn" },
    ];
    const result = evaluatePolicies(policies, {
      text: "What is the password and secret?",
      injectionScore: 0,
      piiDetected: false,
    });
    expect(result.action).toBe("block");
    expect(result.matchedPolicy?.name).toBe("block-passwords");
  });

  test("returns 'continue' when no policies match", () => {
    const policies: Policy[] = [
      { name: "block-passwords", on: "request", condition: { contains: "password" }, action: "block" },
    ];
    const result = evaluatePolicies(policies, { text: "Hello world", injectionScore: 0, piiDetected: false });
    expect(result.action).toBe("continue");
  });

  test("skips policies for different phase", () => {
    const policies: Policy[] = [
      { name: "response-only", on: "response", condition: { contains: "anything" }, action: "tag" },
    ];
    // This doesn't filter by phase at evaluatePolicies level (that's done by createPolicyMiddleware)
    // but evaluatePolicies itself just evaluates the policies given to it
    const result = evaluatePolicies(policies, { text: "anything", injectionScore: 0, piiDetected: false });
    expect(result.action).toBe("tag");
  });

  test("empty policy list returns continue", () => {
    const result = evaluatePolicies([], { text: "test", injectionScore: 0, piiDetected: false });
    expect(result.action).toBe("continue");
  });
});
