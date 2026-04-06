interface Props {
  label: string;
  value: string | number;
  unit?: string;
  trend?: "up" | "down" | "flat";
  className?: string;
}

export function MetricCard({ label, value, unit, trend, className = "" }: Props) {
  return (
    <div className={`bg-bg-card border border-border rounded-lg p-4 ${className}`}>
      <p className="text-xs text-text-muted uppercase tracking-wide">{label}</p>
      <div className="flex items-baseline gap-1.5 mt-1">
        <span className="text-2xl font-semibold text-text-primary tabular-nums">
          {value}
        </span>
        {unit && <span className="text-sm text-text-secondary">{unit}</span>}
        {trend && (
          <span
            className={`text-xs ml-1 ${
              trend === "up"
                ? "text-success"
                : trend === "down"
                  ? "text-error"
                  : "text-text-muted"
            }`}
          >
            {trend === "up" ? "\u2191" : trend === "down" ? "\u2193" : "\u2192"}
          </span>
        )}
      </div>
    </div>
  );
}
