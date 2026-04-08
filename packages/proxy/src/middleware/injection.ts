import type { PipelineContext, PipelineResult } from "@rivano/core";
import { scoreInjection } from "@rivano/core";
import type { Middleware } from "../pipeline.js";

export function createInjectionMiddleware(threshold?: number): Middleware {
  const limit = threshold ?? 0.8;

  return {
    name: "injection",

    async execute(ctx: PipelineContext): Promise<PipelineResult> {
      const content = ctx.messages
        .map((m) => {
          const msg = m as { content?: string; role?: string };
          return typeof msg.content === "string" ? msg.content : "";
        })
        .join("\n");

      const result = scoreInjection(content);
      const score = result.score;
      ctx.metadata.injectionScore = score;
      ctx.metadata.injectionThreshold = limit;

      if (score >= limit) {
        ctx.metadata.statusCode = 403;
        ctx.metadata.errorMessage = `Request blocked: injection score ${score.toFixed(2)} exceeds threshold ${limit}`;
        ctx.metadata.blockedBy = "injection";
        return "block";
      }

      return "continue";
    },
  };
}
