import type { Trace } from "@rivano/core";

export interface EvaluatorResult {
  score: number;
  breakdown: Array<{ label: string; value: number }>;
  raw: Record<string, unknown>;
}

const MIN_LATENCY_MS = 1_000;
const MAX_LATENCY_MS = 30_000;

export function evaluateLatency(trace: Trace): EvaluatorResult {
  const totalMs = trace.endTime
    ? trace.endTime - trace.startTime
    : trace.spans.reduce((max, s) => {
        const end = s.endTime ?? s.startTime;
        return Math.max(max, end);
      }, 0) - trace.startTime;

  let slowestSpan = { name: "unknown", ms: 0 };
  let totalSpanMs = 0;

  for (const span of trace.spans) {
    const spanMs = (span.endTime ?? span.startTime) - span.startTime;
    totalSpanMs += spanMs;
    if (spanMs > slowestSpan.ms) {
      slowestSpan = { name: span.name, ms: spanMs };
    }
  }

  const avgSpanMs = trace.spans.length > 0 ? Math.round(totalSpanMs / trace.spans.length) : 0;

  let score: number;
  if (totalMs <= MIN_LATENCY_MS) {
    score = 1.0;
  } else if (totalMs >= MAX_LATENCY_MS) {
    score = 0;
  } else {
    score = 1 - (totalMs - MIN_LATENCY_MS) / (MAX_LATENCY_MS - MIN_LATENCY_MS);
  }

  return {
    score: Math.round(score * 1000) / 1000,
    breakdown: [
      { label: "totalMs", value: totalMs },
      { label: "avgSpanMs", value: avgSpanMs },
      { label: "slowestSpanMs", value: slowestSpan.ms },
    ],
    raw: { totalMs, avgSpanMs, slowestSpan },
  };
}
