import { describe, expect, test } from "bun:test";
import type { Span, Trace } from "@rivano/core";
import { estimateSpanCost, evaluateCost } from "./cost.js";
import { evaluateLatency } from "./latency.js";

describe("evaluateLatency", () => {
  test("scores 1.0 for fast traces", () => {
    const trace: Trace = {
      id: "t1",
      startTime: 1000,
      endTime: 1500, // 500ms — well under 1000ms threshold
      spans: [],
    };
    const result = evaluateLatency(trace);
    expect(result.score).toBe(1.0);
  });

  test("scores 0 for slow traces", () => {
    const trace: Trace = {
      id: "t1",
      startTime: 1000,
      endTime: 50000, // 49 seconds — well over 30s threshold
      spans: [],
    };
    const result = evaluateLatency(trace);
    expect(result.score).toBe(0);
  });

  test("scores between 0 and 1 for moderate traces", () => {
    const trace: Trace = {
      id: "t1",
      startTime: 0,
      endTime: 5000, // 5 seconds — between 1s and 30s
      spans: [],
    };
    const result = evaluateLatency(trace);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(1);
  });

  test("calculates slowest span", () => {
    const trace: Trace = {
      id: "t1",
      startTime: 0,
      endTime: 10000,
      spans: [
        { id: "s1", traceId: "t1", type: "llm_call", name: "fast", startTime: 0, endTime: 1000 },
        { id: "s2", traceId: "t1", type: "llm_call", name: "slow", startTime: 0, endTime: 5000 },
      ],
    };
    const result = evaluateLatency(trace);
    const slowest = result.raw.slowestSpan as { name: string; ms: number };
    expect(slowest.name).toBe("slow");
    expect(slowest.ms).toBe(5000);
  });

  test("handles trace without endTime", () => {
    const trace: Trace = {
      id: "t1",
      startTime: 0,
      spans: [{ id: "s1", traceId: "t1", type: "llm_call", name: "s1", startTime: 0, endTime: 2000 }],
    };
    const result = evaluateLatency(trace);
    expect(result.score).toBeGreaterThan(0);
    expect(result.raw.totalMs).toBeGreaterThan(0);
  });
});

describe("estimateSpanCost", () => {
  test("returns 0 for span without metadata", () => {
    const span: Span = {
      id: "s1",
      traceId: "t1",
      type: "llm_call",
      name: "test",
      startTime: 0,
    };
    expect(estimateSpanCost(span)).toBe(0);
  });

  test("returns 0 for span without usage", () => {
    const span: Span = {
      id: "s1",
      traceId: "t1",
      type: "llm_call",
      name: "test",
      startTime: 0,
      metadata: { provider: "anthropic" },
    };
    expect(estimateSpanCost(span)).toBe(0);
  });

  test("calculates cost from usage and model", () => {
    const span: Span = {
      id: "s1",
      traceId: "t1",
      type: "llm_call",
      name: "anthropic/claude-sonnet-4-5",
      startTime: 0,
      metadata: {
        model: "claude-sonnet-4-5",
        usage: { input_tokens: 1000000, output_tokens: 1000000 },
      },
    };
    const cost = estimateSpanCost(span);
    // $3/M input + $15/M output = $18 for 1M each
    expect(cost).toBeCloseTo(18, 1);
  });
});

describe("evaluateCost", () => {
  test("sums costs across spans with token usage", () => {
    const trace: Trace = {
      id: "t1",
      startTime: 0,
      endTime: 1000,
      spans: [
        {
          id: "s1",
          traceId: "t1",
          type: "llm_call",
          name: "claude",
          startTime: 0,
          endTime: 500,
          metadata: {
            model: "claude-sonnet-4-5",
            usage: { input_tokens: 100000, output_tokens: 100000 },
          },
        },
      ],
    };
    const result = evaluateCost(trace);
    expect(result.score).toBeGreaterThan(0);
    expect(result.breakdown.length).toBeGreaterThanOrEqual(1);
  });

  test("returns 0 cost for trace with no token usage", () => {
    const trace: Trace = {
      id: "t1",
      startTime: 0,
      endTime: 100,
      spans: [{ id: "s1", traceId: "t1", type: "llm_call", name: "test", startTime: 0, endTime: 100 }],
    };
    const result = evaluateCost(trace);
    expect(result.score).toBe(0);
  });
});
