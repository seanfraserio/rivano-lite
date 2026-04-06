import type { PipelineContext, PipelineResult, AuditEntry } from "@rivano/core";
import type { Middleware } from "../pipeline.js";
import { appendFileSync } from "node:fs";

interface AuditConfig {
  output?: "stdout" | "file";
  path?: string;
}

export function createAuditMiddleware(config?: AuditConfig): Middleware {
  const output = config?.output ?? "stdout";
  const filePath = config?.path ?? "rivano-audit.jsonl";

  function deriveAction(ctx: PipelineContext): AuditEntry["action"] {
    const lastBlock = ctx.decisions.find((d) => d.result === "block");
    if (lastBlock) return "blocked";

    if (ctx.metadata.redacted) return "redacted";

    const hasWarning = ctx.decisions.some(
      (d) => d.reason && d.reason.startsWith("Warning from"),
    );
    if (hasWarning) return "warned";

    return "allowed";
  }

  return {
    name: "audit",

    async execute(ctx: PipelineContext): Promise<PipelineResult> {
      const now = Date.now();
      const latencyMs = now - ctx.startTime;

      const entry: AuditEntry = {
        id: ctx.id,
        timestamp: now,
        traceId: ctx.metadata.traceId as string | undefined,
        provider: ctx.provider,
        model: ctx.model,
        action: deriveAction(ctx),
        reason: ctx.metadata.blockReason as string | undefined,
        latencyMs,
        tokensIn: ctx.metadata.tokensIn as number | undefined,
        tokensOut: ctx.metadata.tokensOut as number | undefined,
        costUsd: ctx.metadata.costUsd as number | undefined,
      };

      const line = JSON.stringify(entry);

      if (output === "file") {
        appendFileSync(filePath, line + "\n");
      } else {
        console.log(line);
      }

      return "continue";
    },
  };
}
