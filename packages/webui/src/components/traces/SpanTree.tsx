import { useState } from "react";

interface Span {
  id: string;
  parentSpanId?: string;
  type: string;
  name: string;
  startTime: number;
  endTime?: number;
  estimatedCostUsd?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

function formatValue(val: unknown): string {
  if (val === undefined || val === null) return "";
  if (typeof val === "string") return val;
  return JSON.stringify(val, null, 2);
}

interface Props {
  spans: Span[];
  traceStartTime: number;
  traceDuration: number;
}

const SPAN_COLORS: Record<string, { bg: string; text: string }> = {
  llm_call: { bg: "bg-info/20", text: "text-info" },
  tool_call: { bg: "bg-purple-500/20", text: "text-purple-400" },
  reasoning: { bg: "bg-warning/20", text: "text-warning" },
  retrieval: { bg: "bg-success/20", text: "text-success" },
  custom: { bg: "bg-text-muted/20", text: "text-text-muted" },
};

const SPAN_BAR_COLORS: Record<string, string> = {
  llm_call: "bg-info",
  tool_call: "bg-purple-500",
  reasoning: "bg-warning",
  retrieval: "bg-success",
  custom: "bg-text-muted",
};

function formatDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function SpanRow({
  span,
  allSpans,
  depth,
  traceStartTime,
  traceDuration,
  hasChildren,
}: {
  span: Span;
  allSpans: Span[];
  depth: number;
  traceStartTime: number;
  traceDuration: number;
  hasChildren: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);

  const duration = (span.endTime || span.startTime) - span.startTime;
  const offset = span.startTime - traceStartTime;
  const widthPct = traceDuration > 0 ? (duration / traceDuration) * 100 : 0;
  const leftPct = traceDuration > 0 ? (offset / traceDuration) * 100 : 0;

  const colors = SPAN_COLORS[span.type] || SPAN_COLORS.custom;
  const barColor = SPAN_BAR_COLORS[span.type] || SPAN_BAR_COLORS.custom;

  return (
    <div>
      <div
        className="flex items-center gap-2 py-1.5 px-2 hover:bg-bg-hover/50 rounded cursor-pointer group"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => setDetailOpen((d) => !d)}
      >
        {/* Expand/collapse toggle */}
        <button
          className={`w-4 h-4 flex items-center justify-center flex-shrink-0 ${
            hasChildren ? "text-text-muted hover:text-text-secondary" : "invisible"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          <svg
            className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Type badge */}
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${colors.bg} ${colors.text}`}
        >
          {span.type}
        </span>

        {/* Span name */}
        <span className="text-xs text-text-primary truncate min-w-0 flex-shrink">
          {span.name}
        </span>

        {/* Duration bar */}
        <div className="flex-1 min-w-[120px] h-4 relative flex-shrink-0">
          <div
            className={`absolute top-1.5 h-1 rounded-full ${barColor} opacity-70`}
            style={{
              left: `${leftPct}%`,
              width: `${Math.max(widthPct, 0.5)}%`,
            }}
          />
        </div>

        {/* Duration text */}
        <span className="text-xs text-text-secondary tabular-nums flex-shrink-0 w-16 text-right">
          {formatDuration(duration)}
        </span>

        {/* Cost */}
        {span.estimatedCostUsd != null && span.estimatedCostUsd > 0 && (
          <span className="text-xs text-text-muted tabular-nums flex-shrink-0 w-16 text-right">
            ${span.estimatedCostUsd.toFixed(4)}
          </span>
        )}
      </div>

      {/* Detail panel */}
      {detailOpen && (span.input || span.output) && (
        <div
          className="mx-2 mb-1 bg-bg-primary border border-border-light rounded-md overflow-hidden"
          style={{ marginLeft: `${24 + depth * 16}px` }}
        >
          {span.input && (
            <div className="p-3 border-b border-border-light">
              <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Input</p>
              <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                {formatValue(span.input)}
              </pre>
            </div>
          )}
          {span.output && (
            <div className="p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Output</p>
              <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                {formatValue(span.output)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Children */}
      {expanded && hasChildren && (
        <SpanChildren
          allSpans={allSpans}
          parentId={span.id}
          depth={depth + 1}
          traceStartTime={traceStartTime}
          traceDuration={traceDuration}
        />
      )}
    </div>
  );
}

function SpanChildren({
  allSpans,
  parentId,
  depth,
  traceStartTime,
  traceDuration,
}: {
  allSpans: Span[];
  parentId?: string;
  depth: number;
  traceStartTime: number;
  traceDuration: number;
}) {
  const children = allSpans.filter((s) =>
    parentId ? s.parentSpanId === parentId : !s.parentSpanId
  );

  return (
    <>
      {children.map((span) => {
        const hasChildren = allSpans.some((s) => s.parentSpanId === span.id);
        return (
          <SpanRow
            key={span.id}
            span={span}
            allSpans={allSpans}
            depth={depth}
            traceStartTime={traceStartTime}
            traceDuration={traceDuration}
            hasChildren={hasChildren}
          />
        );
      })}
    </>
  );
}

export function SpanTree({ spans, traceStartTime, traceDuration }: Props) {
  if (spans.length === 0) {
    return (
      <p className="text-sm text-text-muted py-4 text-center">No spans recorded</p>
    );
  }

  return (
    <div className="py-1">
      <SpanChildren
        allSpans={spans}
        parentId={undefined}
        depth={0}
        traceStartTime={traceStartTime}
        traceDuration={traceDuration}
      />
    </div>
  );
}
