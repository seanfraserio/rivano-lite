import { useEffect, useState } from "react";
import { api, type TraceListItem } from "../../lib/api";
import { SpanTree } from "./SpanTree";

interface Props {
  traceId: string;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

function formatDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function TraceDetail({ traceId }: Props) {
  const [trace, setTrace] = useState<TraceListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .trace(traceId)
      .then((t) => {
        if (!cancelled) {
          setTrace(t);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load trace");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [traceId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-5 h-5 border-2 border-rivano-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !trace) {
    return (
      <div className="p-4">
        <div className="bg-error/10 border border-error/30 rounded-lg p-3 text-error text-sm">
          {error || "Trace not found"}
        </div>
      </div>
    );
  }

  const duration = (trace.endTime || trace.startTime) - trace.startTime;
  const totalCost = trace.totalCostUsd ?? trace.spans.reduce((sum, s) => sum + (s.estimatedCostUsd || 0), 0);

  // Count spans by type
  const spansByType: Record<string, number> = {};
  for (const span of trace.spans) {
    spansByType[span.type] = (spansByType[span.type] || 0) + 1;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border-light flex-shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-primary">Trace Detail</h2>
          {trace.source && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-bg-hover text-text-secondary">
              {trace.source}
            </span>
          )}
        </div>
        <p className="font-mono text-xs text-text-muted mt-1">{trace.id}</p>
        <p className="text-[11px] text-text-muted mt-0.5">
          {formatTimestamp(trace.startTime)}
          {trace.endTime && ` - ${formatTimestamp(trace.endTime)}`}
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3 px-4 py-3 border-b border-border-light flex-shrink-0">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-muted">Duration</p>
          <p className="text-sm font-medium text-text-primary tabular-nums mt-0.5">
            {formatDuration(duration)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-muted">Cost</p>
          <p className="text-sm font-medium text-text-primary tabular-nums mt-0.5">
            ${totalCost.toFixed(4)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-muted">Spans</p>
          <p className="text-sm font-medium text-text-primary tabular-nums mt-0.5">
            {trace.spans.length}
          </p>
        </div>
      </div>

      {/* Span type breakdown */}
      {Object.keys(spansByType).length > 0 && (
        <div className="px-4 py-2 border-b border-border-light flex-shrink-0 flex items-center gap-3">
          {Object.entries(spansByType).map(([type, count]) => (
            <span key={type} className="text-[11px] text-text-muted">
              <span className="text-text-secondary">{count}</span> {type}
            </span>
          ))}
        </div>
      )}

      {/* Span tree */}
      <div className="flex-1 overflow-y-auto px-2">
        <SpanTree
          spans={trace.spans}
          traceStartTime={trace.startTime}
          traceDuration={duration}
        />
      </div>
    </div>
  );
}
