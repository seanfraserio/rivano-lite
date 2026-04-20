import type { Span, Trace } from "@rivano/core";
import { estimateCost } from "@rivano/core";
import type { EvaluatorResult } from "./latency.js";

export function estimateSpanCost(span: Span): number {
  const metadata = span.metadata as Record<string, unknown> | undefined;
  if (!metadata) return 0;

  const usage = metadata.usage as Record<string, unknown> | undefined;
  if (!usage) return 0;

  const inputTokens = (usage.input_tokens as number) ?? 0;
  const outputTokens = (usage.output_tokens as number) ?? 0;

  if (inputTokens === 0 && outputTokens === 0) return 0;

  const model = (metadata.model as string) ?? "";
  return estimateCost(model, inputTokens, outputTokens);
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
