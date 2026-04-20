import { describe, expect, test } from "bun:test";
import type { Middleware, PipelineContext, Provider } from "@rivano/core";
import { Pipeline } from "./pipeline.js";

describe("Pipeline", () => {
  function createPassthroughMiddleware(name: string): Middleware {
    return {
      name,
      async execute(_ctx: PipelineContext) {
        return "continue";
      },
    };
  }

  function createBlockingMiddleware(name: string): Middleware {
    return {
      name,
      async execute(_ctx: PipelineContext) {
        return "block";
      },
    };
  }

  function createShortCircuitMiddleware(name: string): Middleware {
    return {
      name,
      async execute(_ctx: PipelineContext) {
        return "short-circuit";
      },
    };
  }

  test("executes all middlewares and returns continue when all pass", async () => {
    const pipeline = new Pipeline([
      createPassthroughMiddleware("mw1"),
      createPassthroughMiddleware("mw2"),
      createPassthroughMiddleware("mw3"),
    ]);

    const ctx: PipelineContext = {
      id: "test-1",
      provider: "openai",
      model: "gpt-4",
      messages: [],
      decisions: [],
      startTime: Date.now(),
      metadata: {},
    };

    const result = await pipeline.execute(ctx);
    expect(result).toBe("continue");
    expect(ctx.decisions).toHaveLength(3);
    expect(ctx.decisions.every((d) => d.result === "continue")).toBe(true);
    expect(ctx.decisions[0].middleware).toBe("mw1");
  });

  test("stops execution on block and records decision", async () => {
    const pipeline = new Pipeline([
      createPassthroughMiddleware("mw1"),
      createBlockingMiddleware("mw2"),
      createPassthroughMiddleware("mw3"),
    ]);

    const ctx: PipelineContext = {
      id: "test-2",
      provider: "openai",
      model: "gpt-4",
      messages: [],
      decisions: [],
      startTime: Date.now(),
      metadata: {},
    };

    const result = await pipeline.execute(ctx);
    expect(result).toBe("block");
    expect(ctx.decisions).toHaveLength(2);
    expect(ctx.decisions[0].result).toBe("continue");
    expect(ctx.decisions[1].result).toBe("block");
    // mw3 should NOT have been executed
    expect(ctx.decisions).not.toContainEqual({ middleware: "mw3", result: "continue" });
  });

  test("stops execution on short-circuit and records decision", async () => {
    const pipeline = new Pipeline([
      createPassthroughMiddleware("mw1"),
      createShortCircuitMiddleware("mw2"),
      createPassthroughMiddleware("mw3"),
    ]);

    const ctx: PipelineContext = {
      id: "test-3",
      provider: "openai",
      model: "gpt-4",
      messages: [],
      decisions: [],
      startTime: Date.now(),
      metadata: {},
    };

    const result = await pipeline.execute(ctx);
    expect(result).toBe("short-circuit");
    expect(ctx.decisions).toHaveLength(2);
  });

  test("handles empty middleware list", async () => {
    const pipeline = new Pipeline([]);
    const ctx: PipelineContext = {
      id: "test-4",
      provider: "openai",
      model: "gpt-4",
      messages: [],
      decisions: [],
      startTime: Date.now(),
      metadata: {},
    };

    const result = await pipeline.execute(ctx);
    expect(result).toBe("continue");
    expect(ctx.decisions).toHaveLength(0);
  });

  test("pipeline can be re-used with different results per context", async () => {
    // Both middlewares pass — so result is always "continue"
    const pipeline = new Pipeline([createPassthroughMiddleware("mw1"), createPassthroughMiddleware("mw2")]);

    const ctx1: PipelineContext = {
      id: "test-5a",
      provider: "openai" as Provider,
      model: "gpt-4",
      messages: [],
      decisions: [],
      startTime: Date.now(),
      metadata: {},
    };
    expect(await pipeline.execute(ctx1)).toBe("continue");
    expect(ctx1.decisions).toHaveLength(2);

    // Same pipeline, different context
    const ctx2: PipelineContext = {
      id: "test-5b",
      provider: "anthropic" as Provider,
      model: "claude-3",
      messages: [],
      decisions: [],
      startTime: Date.now(),
      metadata: {},
    };
    expect(await pipeline.execute(ctx2)).toBe("continue");
    expect(ctx2.decisions).toHaveLength(2);
  });

  test("blocks take priority over short-circuits in ordering", async () => {
    const pipeline = new Pipeline([createBlockingMiddleware("mw1"), createShortCircuitMiddleware("mw2")]);

    const ctx: PipelineContext = {
      id: "test-6",
      provider: "openai",
      model: "gpt-4",
      messages: [],
      decisions: [],
      startTime: Date.now(),
      metadata: {},
    };

    const result = await pipeline.execute(ctx);
    expect(result).toBe("block");
    expect(ctx.decisions).toHaveLength(1);
  });
});
