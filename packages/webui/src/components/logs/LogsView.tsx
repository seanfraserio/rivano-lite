import { useEffect, useRef, useState } from "react";

interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

const LEVEL_STYLES: Record<string, string> = {
  info: "text-text-secondary",
  warn: "text-warning",
  error: "text-error",
};

const LEVEL_BADGE_STYLES: Record<string, string> = {
  info: "bg-info/20 text-info",
  warn: "bg-warning/20 text-warning",
  error: "bg-error/20 text-error",
};

const MAX_LINES = 500;

type LevelFilter = "all" | "info" | "warn" | "error";

export function LogsView() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let lastTimestamp = "";

    async function poll() {
      try {
        const url = lastTimestamp
          ? `/api/logs?since=${encodeURIComponent(lastTimestamp)}`
          : "/api/logs";
        const res = await fetch(url);
        if (!res.ok) throw new Error("fetch failed");
        const data = await res.json();
        const entries: LogEntry[] = data.logs ?? [];
        if (!active || entries.length === 0) {
          if (active) setConnected(true);
          return;
        }

        lastTimestamp = entries[entries.length - 1].timestamp;
        setConnected(true);
        setLogs((prev) => {
          const merged = [...prev, ...entries];
          return merged.length > MAX_LINES
            ? merged.slice(merged.length - MAX_LINES)
            : merged;
        });
      } catch {
        if (!active) return;
        setConnected(false);
      }
    }

    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  function handleScroll() {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    if (autoScroll && !atBottom) {
      setAutoScroll(false);
    }
  }

  function clearLogs() {
    setLogs([]);
  }

  const filtered = logs.filter((entry) => {
    if (levelFilter !== "all" && entry.level !== levelFilter) return false;
    if (search && !entry.message.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <div className="p-6 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Logs</h1>
          <p className="text-xs text-text-muted mt-0.5">
            Streaming logs from proxy and observer services
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
            connected
              ? "bg-success/20 text-success"
              : "bg-error/20 text-error"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              connected ? "bg-success animate-pulse" : "bg-error"
            }`}
          />
          {connected ? "Connected" : "Disconnected"}
        </span>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex rounded-md overflow-hidden border border-border">
          {(["all", "info", "warn", "error"] as const).map((level) => (
            <button
              key={level}
              onClick={() => setLevelFilter(level)}
              className={`px-3 py-1.5 text-xs transition-colors ${
                levelFilter === level
                  ? "bg-rivano-500/20 text-rivano-300 font-medium"
                  : "bg-bg-card text-text-muted hover:text-text-secondary"
              }`}
            >
              {level === "all" ? "All" : level.toUpperCase()}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search logs..."
          className="bg-bg-primary border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-rivano-500 flex-1 max-w-xs"
        />

        <button
          onClick={clearLogs}
          className="px-3 py-1.5 bg-bg-hover border border-border text-text-secondary hover:text-text-primary text-xs rounded-md transition-colors"
        >
          Clear
        </button>

        <button
          onClick={() => {
            setAutoScroll((v) => !v);
            if (!autoScroll && scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
          }}
          className={`px-3 py-1.5 border text-xs rounded-md transition-colors ${
            autoScroll
              ? "bg-rivano-500/15 border-rivano-500/30 text-rivano-300"
              : "bg-bg-hover border-border text-text-muted hover:text-text-secondary"
          }`}
        >
          Auto-scroll {autoScroll ? "ON" : "OFF"}
        </button>
      </div>

      {/* Log Output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 bg-bg-primary font-mono text-xs rounded-lg border border-border overflow-y-auto p-3"
      >
        {filtered.length === 0 ? (
          <p className="text-text-muted text-center py-8">
            {logs.length === 0
              ? "Waiting for log entries..."
              : "No logs match the current filter."}
          </p>
        ) : (
          <div className="space-y-px">
            {filtered.map((entry, i) => (
              <div key={i} className="flex gap-2 py-0.5 leading-relaxed">
                <span className="text-text-muted flex-shrink-0 select-none">
                  {formatTimestamp(entry.timestamp)}
                </span>
                <span
                  className={`flex-shrink-0 w-12 text-right uppercase font-medium ${
                    LEVEL_STYLES[entry.level] || "text-text-secondary"
                  }`}
                >
                  {entry.level}
                </span>
                <span
                  className={
                    LEVEL_STYLES[entry.level] || "text-text-secondary"
                  }
                >
                  {entry.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-2 text-xs text-text-muted">
        <span>{filtered.length} entries shown</span>
        <span>{logs.length} / {MAX_LINES} buffer</span>
      </div>
    </div>
  );
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}
