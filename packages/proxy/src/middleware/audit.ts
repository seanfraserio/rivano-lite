import type { PipelineContext, PipelineResult, AuditEntry, Trace, Span } from "@rivano/core";
import type { Middleware } from "../pipeline.js";
import { appendFileSync } from "node:fs";

const MODEL_PRICING: Record<string, { inPer1M: number; outPer1M: number }> = {
  "claude-opus-4-6": { inPer1M: 15, outPer1M: 75 },
  "claude-sonnet-4-5": { inPer1M: 3, outPer1M: 15 },
  "claude-haiku-4-5": { inPer1M: 0.8, outPer1M: 4 },
  "gpt-4o": { inPer1M: 2.5, outPer1M: 10 },
  "gpt-4o-mini": { inPer1M: 0.15, outPer1M: 0.6 },
  "o3-mini": { inPer1M: 1.1, outPer1M: 4.4 },
};
const DEFAULT_PRICING = { inPer1M: 1, outPer1M: 3 };

function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  return Math.round(((tokensIn / 1_000_000) * p.inPer1M + (tokensOut / 1_000_000) * p.outPer1M) * 1_000_000) / 1_000_000;
}

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
        } catch {
          // Don't let trace emission failure affect the request
        }
      }

      return "continue";
    },
  };
}
