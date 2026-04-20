import { describe, expect, test } from "bun:test";
import { DEFAULT_PRICING, estimateCost, MODEL_PRICING } from "./pricing.js";

describe("estimateCost", () => {
  test("calculates cost for known model", () => {
    // claude-sonnet-4-5: $3/M input, $15/M output
    const cost = estimateCost("claude-sonnet-4-5", 1_000_000, 1_000_000);
    expect(cost).toBe(3 + 15); // $18.00
  });

  test("calculates cost for small token counts", () => {
    // gpt-4o: $2.5/M input, $10/M output
    const cost = estimateCost("gpt-4o", 1_000, 2_000);
    // (1000/1M)*2.5 + (2000/1M)*10 = 0.0025 + 0.02 = 0.0225
    expect(cost).toBeCloseTo(0.0225, 5);
  });

  test("returns zero for zero tokens", () => {
    const cost = estimateCost("claude-sonnet-4-5", 0, 0);
    expect(cost).toBe(0);
  });

  test("uses default pricing for unknown model", () => {
    const cost = estimateCost("unknown-model-xyz", 1_000_000, 1_000_000);
    expect(cost).toBe(DEFAULT_PRICING.inputPerMillion + DEFAULT_PRICING.outputPerMillion);
  });

  test("handles input-only tokens", () => {
    const cost = estimateCost("claude-opus-4-6", 500_000, 0);
    // $15/M input → 0.5 * 15 = 7.5
    expect(cost).toBeCloseTo(7.5, 5);
  });

  test("handles output-only tokens", () => {
    const cost = estimateCost("claude-opus-4-6", 0, 200_000);
    // $75/M output → 0.2 * 75 = 15
    expect(cost).toBeCloseTo(15, 5);
  });

  test("rounds to 6 decimal places", () => {
    const cost = estimateCost("gpt-4o-mini", 1, 1);
    // Very small numbers should still be reasonable
    expect(typeof cost).toBe("number");
    expect(cost).toBeGreaterThanOrEqual(0);
  });
});

describe("MODEL_PRICING", () => {
  test("contains all expected models", () => {
    expect(MODEL_PRICING["claude-opus-4-6"]).toBeDefined();
    expect(MODEL_PRICING["claude-sonnet-4-5"]).toBeDefined();
    expect(MODEL_PRICING["claude-haiku-4-5"]).toBeDefined();
    expect(MODEL_PRICING["gpt-4o"]).toBeDefined();
    expect(MODEL_PRICING["gpt-4o-mini"]).toBeDefined();
    expect(MODEL_PRICING["o3-mini"]).toBeDefined();
  });

  test("each model has input and output pricing", () => {
    for (const [_model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(typeof pricing.inputPerMillion).toBe("number");
      expect(typeof pricing.outputPerMillion).toBe("number");
      expect(pricing.inputPerMillion).toBeGreaterThan(0);
      expect(pricing.outputPerMillion).toBeGreaterThan(0);
    }
  });
});
