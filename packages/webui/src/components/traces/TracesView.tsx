import { useEffect, useState, useCallback } from "react";
import { api, type TraceListItem, type TraceStats } from "../../lib/api";
import { TraceDetail } from "./TraceDetail";

const PAGE_SIZE = 25;

const TIME_RANGES = [
  { label: "1h", ms: 3600_000 },
  { label: "6h", ms: 21600_000 },
  { label: "24h", ms: 86400_000 },
  { label: "7d", ms: 604800_000 },
  { label: "All", ms: 0 },
] as const;

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function TracesView() {
  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<TraceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Filters
  const [source, setSource] = useState("");
  const [timeRange, setTimeRange] = useState<(typeof TIME_RANGES)[number]>(TIME_RANGES[4]);
  const [offset, setOffset] = useState(0);

  // Unique sources from loaded traces
  const [sources, setSources] = useState<string[]>([]);

  const loadTraces = useCallback(
    async (append = false) => {
      try {
        if (!append) setLoading(true);

        const params: { limit: number; offset: number; source?: string } = {
          limit: PAGE_SIZE,
          offset: append ? offset : 0,
        };
        if (source) params.source = source;

        const result = await api.traces(params);

        // Filter by time range client-side (server may not support it)
        let filtered = result.traces;
        if (timeRange.ms > 0) {
          const cutoff = Date.now() - timeRange.ms;
          filtered = filtered.filter((t) => t.startTime >= cutoff);
        }

        if (append) {
          setTraces((prev) => [...prev, ...filtered]);
        } else {
          setTraces(filtered);
        }
        setTotal(result.total);
        setError(null);

        // Build source list from all seen traces
        const allTraces = append ? [...traces, ...filtered] : filtered;
        const uniqueSources = Array.from(
          new Set(allTraces.map((t) => t.source).filter(Boolean) as string[])
        );
        setSources(uniqueSources);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load traces");
      } finally {
        setLoading(false);
      }
    },
    [source, timeRange, offset, traces]
  );

  useEffect(() => {
    setOffset(0);
    loadTraces(false);
    api.traceStats().then(setStats).catch(() => {});
  }, [source, timeRange]);

  const loadMore = () => {
    const nextOffset = offset + PAGE_SIZE;
    setOffset(nextOffset);
    loadTraces(true);
  };

  const hasMore = traces.length < total;

  return (
    <div className="flex h-full">
      {/* Left panel - Trace list */}
      <div className="w-[380px] flex-shrink-0 border-r border-border flex flex-col bg-bg-secondary/50">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border-light flex-shrink-0">
          <div className="flex items-center justify-between">
            <h1 className="text-sm font-semibold text-text-primary">Traces</h1>
            {stats && (
              <span className="text-xs text-text-muted tabular-nums">
                {stats.totalTraces.toLocaleString()} total
              </span>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="px-4 py-2 border-b border-border-light flex items-center gap-2 flex-shrink-0">
          {/* Source dropdown */}
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="bg-bg-primary border border-border rounded px-2 py-1 text-xs text-text-secondary focus:outline-none focus:border-rivano-500 min-w-0"
          >
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {/* Time range */}
          <div className="flex rounded overflow-hidden border border-border ml-auto">
            {TIME_RANGES.map((range) => (
              <button
                key={range.label}
                onClick={() => setTimeRange(range)}
                className={`px-2 py-1 text-[11px] transition-colors ${
                  timeRange.label === range.label
                    ? "bg-rivano-500/20 text-rivano-300"
                    : "text-text-muted hover:text-text-secondary hover:bg-bg-hover"
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        {/* Trace list */}
        <div className="flex-1 overflow-y-auto">
          {loading && traces.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 border-2 border-rivano-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error && traces.length === 0 ? (
            <div className="p-4">
              <div className="bg-error/10 border border-error/30 rounded-lg p-3 text-error text-sm">
                {error}
              </div>
            </div>
          ) : traces.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <svg
                className="w-8 h-8 text-text-muted/50 mb-2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
              <p className="text-sm text-text-muted">No traces yet</p>
              <p className="text-xs text-text-muted/70 mt-1 text-center">
                Send requests through the proxy to start seeing traces
              </p>
            </div>
          ) : (
            <>
              {traces.map((trace) => {
                const duration = (trace.endTime || trace.startTime) - trace.startTime;
                const cost =
                  trace.totalCostUsd ??
                  trace.spans.reduce((sum, s) => sum + (s.estimatedCostUsd || 0), 0);
                const isSelected = selectedId === trace.id;

                // Derive action from first span's metadata
                const action = (trace.spans[0]?.metadata as Record<string, unknown> | undefined)?.action as string | undefined;
                const isBlocked = action === "blocked";
                const isWarned = action === "warned";

                return (
                  <button
                    key={trace.id}
                    onClick={() => setSelectedId(trace.id)}
                    className={`w-full text-left px-4 py-2.5 border-b transition-colors ${
                      isSelected
                        ? isBlocked
                          ? "bg-error/10 border-l-2 border-l-error"
                          : "bg-rivano-500/10 border-l-2 border-l-rivano-400"
                        : isBlocked
                          ? "bg-error/5 border-b-error/20 hover:bg-error/10"
                          : "border-b-border-light hover:bg-bg-hover/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`font-mono text-xs ${isBlocked ? "text-error" : "text-text-primary"}`}>
                          {trace.id.slice(0, 8)}
                        </span>
                        {isBlocked && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-error/20 text-error font-medium">
                            blocked
                          </span>
                        )}
                        {isWarned && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-warning/20 text-warning font-medium">
                            warned
                          </span>
                        )}
                        {trace.source && !isBlocked && !isWarned && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-bg-hover text-text-muted truncate max-w-[80px]">
                            {trace.source}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-text-muted flex-shrink-0">
                        {timeAgo(trace.startTime)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-[11px] text-text-muted tabular-nums">
                        {trace.spans.length} span{trace.spans.length !== 1 ? "s" : ""}
                      </span>
                      <span className={`text-[11px] tabular-nums ${isBlocked ? "text-error/70" : "text-text-secondary"}`}>
                        {formatDuration(duration)}
                      </span>
                      {cost > 0 && (
                        <span className="text-[11px] text-text-muted tabular-nums">
                          ${cost.toFixed(4)}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}

              {/* Load more */}
              {hasMore && (
                <div className="p-3 text-center">
                  <button
                    onClick={loadMore}
                    className="px-3 py-1.5 text-xs text-rivano-300 hover:text-rivano-200 bg-rivano-500/10 hover:bg-rivano-500/20 rounded transition-colors"
                  >
                    Load more
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Right panel - Trace detail */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedId ? (
          <TraceDetail traceId={selectedId} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <svg
              className="w-10 h-10 opacity-30 mb-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
            >
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
            <p className="text-sm">Select a trace to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}
