import type { Policy, PipelineContext, PipelineResult } from "@rivano/core";
import { evaluatePolicies, redactPii } from "@rivano/core";
import type { Middleware } from "../pipeline.js";

export function createPolicyMiddleware(
  policies: Policy[],
  phase: "request" | "response",
): Middleware {
  const phasePolicies = policies.filter((p) => p.on === phase);

  return {
    name: `policy-${phase}`,

    async execute(ctx: PipelineContext): Promise<PipelineResult> {
      if (phasePolicies.length === 0) {
        return "continue";
      }

      // Build the evaluation context from pipeline state
      const text = ctx.messages
        .map((m) => {
          const msg = m as { content?: string };
          return typeof msg.content === "string" ? msg.content : "";
        })
        .join("\n");

      const evalCtx = {
        text,
        injectionScore: (ctx.metadata.injectionScore as number) ?? 0,
        piiDetected: (ctx.metadata.piiDetected as boolean) ?? false,
      };

      const result = evaluatePolicies(phasePolicies, evalCtx);

      if (result.action === "continue") {
        return "continue";
      }

      switch (result.action) {
        case "block":
          ctx.metadata.blockedBy = result.matchedPolicy?.name;
          ctx.metadata.blockReason = result.message;
          ctx.metadata.statusCode = 403;
          ctx.metadata.errorMessage =
            result.message ?? `Blocked by policy: ${result.matchedPolicy?.name}`;
          return "block";

        case "redact":
          if (phase === "request") {
            ctx.messages = ctx.messages.map((m) => {
              const msg = m as { content?: string; role?: string };
              if (typeof msg.content === "string") {
                return { ...msg, content: redactPii(msg.content) };
              }
              return m;
            });
          }
          break;

        case "warn":
          ctx.decisions.push({
            middleware: `policy-${phase}`,
            result: "continue",
            reason: `Warning: ${result.message}`,
          });
          break;

        case "tag":
          if (!ctx.metadata.tags) ctx.metadata.tags = [];
          (ctx.metadata.tags as string[]).push(result.matchedPolicy?.name ?? "unknown");
          break;
      }

      return "continue";
    },
  };
}
