import type { Trace, Span } from "@rivano/core";
import type { EvaluatorResult } from "./latency.js";

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const PRICING_TABLE: Record<string, ModelPricing> = {
  "claude-sonnet-4-5": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-haiku-4-5": { inputPerMillion: 0.8, outputPerMillion: 4 },
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
};

const DEFAULT_PRICING: ModelPricing = { inputPerMillion: 1, outputPerMillion: 3 };

export function estimateSpanCost(span: Span): number {
  const metadata = span.metadata as Record<string, unknown> | undefined;
  if (!metadata) return 0;

  const usage = metadata.usage as Record<string, unknown> | undefined;
  if (!usage) return 0;

  const inputTokens = (usage.input_tokens as number) ?? 0;
  const outputTokens = (usage.output_tokens as number) ?? 0;

  if (inputTokens === 0 && outputTokens === 0) return 0;

  const model = (metadata.model as string) ?? "";
  const pricing = PRICING_TABLE[model] ?? DEFAULT_PRICING;

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;

  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

export function evaluateCost(trace: Trace): EvaluatorResult {
  const perSpan: Array<{ name: string; usd: number }> = [];
  let totalUsd = 0;

  for (const span of trace.spans) {
    const usd = estimateSpanCost(span);
    if (usd > 0) {
      perSpan.push({ name: span.name, usd });
    }
    totalUsd += usd;
  }

  return {
    score: totalUsd,
    breakdown: perSpan.map((s) => ({ label: s.name, value: s.usd })),
    raw: { totalUsd, perSpan },
  };
}
