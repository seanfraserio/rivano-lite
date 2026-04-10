interface Props {
  status: "running" | "stopped" | "error" | "unknown";
  label?: string;
}

const styles: Record<string, string> = {
  running: "bg-success/20 text-success",
  stopped: "bg-text-muted/20 text-text-muted",
  error: "bg-error/20 text-error",
  unknown: "bg-warning/20 text-warning",
};

export function StatusBadge({ status, label }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium ${styles[status] || styles.unknown}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${status === "running" ? "bg-success animate-pulse" : status === "error" ? "bg-error" : "bg-text-muted"}`}
      />
      {label || status}
    </span>
  );
}
