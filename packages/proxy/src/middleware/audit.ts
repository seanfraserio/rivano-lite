import type { PipelineContext, PipelineResult, AuditEntry, Trace, Span } from "@rivano/core";
import { estimateCost } from "@rivano/core";
import type { Middleware } from "../pipeline.js";
import { appendFileSync } from "node:fs";

interface AuditConfig {
  output?: "stdout" | "file";
  path?: string;
  onTrace?: (trace: Trace) => void;
}

export function createAuditMiddleware(config?: AuditConfig): Middleware {
  const output = config?.output ?? "stdout";
  const filePath = config?.path ?? "rivano-audit.jsonl";

  function deriveAction(ctx: PipelineContext): AuditEntry["action"] {
    const lastBlock = ctx.decisions.find((d) => d.result === "block");
    if (lastBlock) return "blocked";

    if (ctx.metadata.redacted) return "redacted";

    const hasWarning = ctx.decisions.some(
      (d) => d.reason && d.reason.startsWith("Warning"),
    );
    if (hasWarning) return "warned";

    return "allowed";
  }

  return {
    name: "audit",

    async execute(ctx: PipelineContext): Promise<PipelineResult> {
      const now = Date.now();
      const latencyMs = now - ctx.startTime;

      const tokensIn = (ctx.metadata.tokensIn as number) ?? 0;
      const tokensOut = (ctx.metadata.tokensOut as number) ?? 0;
      const costUsd = tokensIn + tokensOut > 0 ? estimateCost(ctx.model, tokensIn, tokensOut) : 0;

      const entry: AuditEntry = {
        id: ctx.id,
        timestamp: now,
        traceId: ctx.id,
        provider: ctx.provider,
        model: ctx.model,
        action: deriveAction(ctx),
        reason: ctx.metadata.blockReason as string | undefined,
        latencyMs,
        tokensIn: tokensIn || undefined,
        tokensOut: tokensOut || undefined,
        costUsd: costUsd || undefined,
      };

      const line = JSON.stringify(entry);

      if (output === "file") {
        appendFileSync(filePath, line + "\n");
      } else {
        console.log(line);
      }

      // Emit trace to observer if callback is provided
      if (config?.onTrace) {
        const span: Span = {
          id: `span-${ctx.id}`,
          traceId: ctx.id,
          type: "llm_call",
          name: `${ctx.provider}/${ctx.model}`,
          input: ctx.messages,
          output: ctx.metadata.providerResponse,
          error: ctx.metadata.errorMessage as string | undefined,
          startTime: ctx.startTime,
          endTime: now,
          estimatedCostUsd: entry.costUsd,
          metadata: {
            provider: ctx.provider,
            model: ctx.model,
            action: entry.action,
            tokensIn: entry.tokensIn,
            tokensOut: entry.tokensOut,
            decisions: ctx.decisions,
            usage: {
              input_tokens: entry.tokensIn ?? 0,
              output_tokens: entry.tokensOut ?? 0,
            },
          },
        };

        const trace: Trace = {
          id: ctx.id,
          source: "proxy",
          startTime: ctx.startTime,
          endTime: now,
          totalCostUsd: entry.costUsd ?? 0,
          spans: [span],
          metadata: {
            provider: ctx.provider,
            model: ctx.model,
            action: entry.action,
          },
        };

        try {
          config.onTrace(trace);
        } catch (err) {
          // Don't let trace emission failure affect the request, but log it
          console.error("[rivano] Trace emission failed:", err);
        }
      }

      return "continue";
    },
  };
}
