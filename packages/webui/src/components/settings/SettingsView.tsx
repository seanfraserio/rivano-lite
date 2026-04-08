import { useEffect, useState } from "react";
import { api, type HealthStatus } from "../../lib/api";
import { Card } from "../shared/Card";

/** Build auth headers from localStorage for raw fetch calls */
function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const apiKey = localStorage.getItem("rivano_api_key");
  if (!apiKey) return {};
  return { Authorization: `Bearer ${apiKey}` };
}

interface EnvKey {
  key: string;
  masked: string;
  hasValue: boolean;
}

interface StorageInfo {
  dbPath: string;
  dbSizeBytes: number;
  dbSizeMB: number;
}

export function SettingsView() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [envKeys, setEnvKeys] = useState<EnvKey[]>([]);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [configPath, setConfigPath] = useState("");
  const [dataDir, setDataDir] = useState("");
  const [retentionDays, setRetentionDays] = useState(30);

  // Key form
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState(
    typeof window !== "undefined" ? (localStorage.getItem("rivano_api_key") ?? "") : ""
  );

  function saveApiKey() {
    if (!apiKeyInput.trim()) return;
    api.setApiKey(apiKeyInput.trim());
    setMessage({ type: "ok", text: "API key saved." });
    setTimeout(() => setMessage(null), 2000);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [h, status, env, stor] = await Promise.all([
        api.health().catch(() => null),
        api.status().catch(() => null),
        fetch("/api/env", { headers: authHeaders() })
          .then((r) => r.json())
          .catch(() => ({ keys: [] })),
        fetch("/api/storage", { headers: authHeaders() })
          .then((r) => r.json())
          .catch(() => null),
      ]);
      if (h) setHealth(h);
      if (status) {
        setConfigPath(status.config);
        setDataDir(status.dataDir);
        setRetentionDays(status.observer.retentionDays || 30);
      }
      setEnvKeys(env.keys || []);
      setStorage(stor);
    } catch {
      // Partial load is OK
    }
  }

  function toggleReveal(key: string) {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function saveEnvVar() {
    if (!newKey.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/env", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ key: newKey.trim(), value: newValue }),
      });
      const data = await res.json();
      if (data.ok) {
        setMessage({ type: "ok", text: `${newKey} saved successfully.` });
        setNewKey("");
        setNewValue("");
        const env = await fetch("/api/env", { headers: authHeaders() }).then((r) => r.json());
        setEnvKeys(env.keys || []);
      } else {
        setMessage({ type: "error", text: data.error || "Failed to save" });
      }
    } catch {
      setMessage({ type: "error", text: "Connection error" });
    }
    setSaving(false);
    setTimeout(() => setMessage(null), 3000);
  }

  async function removeEnvVar(key: string) {
    try {
      const res = await fetch("/api/env", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ key }),
      });
      const data = await res.json();
      if (data.ok) {
        setMessage({ type: "ok", text: `${key} removed.` });
        const env = await fetch("/api/env", { headers: authHeaders() }).then((r) => r.json());
        setEnvKeys(env.keys || []);
      }
    } catch {
      setMessage({ type: "error", text: "Failed to remove key" });
    }
    setTimeout(() => setMessage(null), 3000);
  }

  async function purgeTraces() {
    if (!confirm("Delete traces older than the retention period?")) return;
    try {
      const res = await fetch("/api/traces", { method: "DELETE", headers: authHeaders() });
      const data = await res.json();
      setMessage({ type: "ok", text: `Purged ${data.deleted} old traces.` });
      const stor = await fetch("/api/storage", { headers: authHeaders() })
        .then((r) => r.json())
        .catch(() => null);
      setStorage(stor);
    } catch {
      setMessage({ type: "error", text: "Purge failed" });
    }
    setTimeout(() => setMessage(null), 3000);
  }

  function formatUptime(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600)
      return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Settings</h1>
        <p className="text-sm text-text-secondary mt-0.5">
          System configuration and management
        </p>
      </div>

      {/* Toast */}
      {message && (
        <div
          className={`px-4 py-2 rounded-md text-sm ${
            message.type === "ok"
              ? "bg-success/15 text-success border border-success/30"
              : "bg-error/15 text-error border border-error/30"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* API Authentication */}
      <Card title="API Authentication" subtitle="Required for config changes when RIVANO_API_KEY is set">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <input
              type="password"
              placeholder="Enter your API key"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveApiKey()}
              className="flex-1 bg-bg-primary border border-border rounded-md px-3 py-2 text-sm font-mono text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-rivano-500"
            />
            <button
              onClick={saveApiKey}
              className="px-4 py-2 bg-rivano-500 hover:bg-rivano-600 text-white text-sm rounded-md transition-colors"
            >
              {api.hasApiKey() ? "Update" : "Connect"}
            </button>
            {api.hasApiKey() && (
              <button
                onClick={() => { api.clearApiKey(); setApiKeyInput(""); }}
                className="px-3 py-2 bg-bg-hover border border-border text-error/80 hover:text-error text-xs rounded-md transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          <p className="text-xs text-text-muted">
            {api.hasApiKey()
              ? "✓ API key stored in browser. All requests will include authentication."
              : "No API key set. If RIVANO_API_KEY is configured on the server, you need to provide it here to make changes."}
          </p>
        </div>
      </Card>

      {/* System Info */}
      <Card title="System Info">
        <div className="space-y-2.5">
          <InfoRow label="Config file" value={configPath || "~/.rivano/config.yaml"} />
          <InfoRow label="Data directory" value={dataDir || "~/.rivano/data"} />
          <InfoRow label="Version" value={health?.version || "unknown"} />
          <InfoRow
            label="Uptime"
            value={
              health
                ? formatUptime((health as Record<string, unknown> & HealthStatus).uptime as number || 0)
                : "--"
            }
          />
          <InfoRow
            label="Proxy"
            value={
              health?.services.proxy === "running"
                ? "Running"
                : "Stopped"
            }
          />
          <InfoRow
            label="Observer"
            value={
              health?.services.observer === "running"
                ? "Running"
                : "Stopped"
            }
          />
        </div>
      </Card>

      {/* API Keys */}
      <Card
        title="API Keys"
        subtitle="Stored in ~/.rivano/.env"
      >
        <div className="space-y-3">
          {/* Existing keys */}
          {envKeys.length > 0 && (
            <div className="space-y-2">
              {envKeys.map((env) => (
                <div
                  key={env.key}
                  className="flex items-center gap-2 py-2 px-3 bg-bg-primary rounded-md"
                >
                  <span className="font-mono text-xs text-text-muted w-44 flex-shrink-0 truncate">
                    {env.key}
                  </span>
                  <span className="flex-1 font-mono text-xs text-text-secondary truncate">
                    {revealedKeys.has(env.key) ? env.masked : maskFull(env.masked)}
                  </span>
                  <button
                    onClick={() => toggleReveal(env.key)}
                    className="px-2 py-1 bg-bg-hover border border-border text-text-muted hover:text-text-secondary text-xs rounded-md transition-colors flex-shrink-0"
                    title={revealedKeys.has(env.key) ? "Hide" : "Reveal"}
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                    >
                      {revealedKeys.has(env.key) ? (
                        <>
                          <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                          <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </>
                      ) : (
                        <>
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </>
                      )}
                    </svg>
                  </button>
                  <button
                    onClick={() => removeEnvVar(env.key)}
                    className="px-2 py-1 bg-bg-hover border border-border text-error/60 hover:text-error text-xs rounded-md transition-colors flex-shrink-0"
                    title="Remove"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add key form */}
          <div className="flex gap-2 pt-1">
            <input
              type="text"
              placeholder="KEY_NAME"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && saveEnvVar()}
              className="bg-bg-primary border border-border rounded-md px-3 py-2 text-sm font-mono text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-rivano-500 w-44"
            />
            <input
              type="password"
              placeholder="value"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveEnvVar()}
              className="flex-1 bg-bg-primary border border-border rounded-md px-3 py-2 text-sm font-mono text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-rivano-500"
            />
            <button
              onClick={saveEnvVar}
              disabled={saving || !newKey.trim()}
              className="px-4 py-2 bg-rivano-500 hover:bg-rivano-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-md transition-colors"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>

          <p className="text-xs text-text-muted">
            Common keys: ANTHROPIC_API_KEY, OPENAI_API_KEY
          </p>
        </div>
      </Card>

      {/* Data Management */}
      <Card title="Data Management">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary">Trace Retention</p>
              <p className="text-xs text-text-muted mt-0.5">
                Currently retaining traces for {retentionDays} days
              </p>
            </div>
            <button
              onClick={purgeTraces}
              className="px-3 py-1.5 bg-bg-hover border border-border text-error/80 hover:text-error text-xs rounded-md transition-colors"
            >
              Purge Old Data
            </button>
          </div>

          <div className="border-t border-border-light" />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary">Export Data</p>
              <p className="text-xs text-text-muted mt-0.5">
                Run{" "}
                <code className="font-mono text-xs bg-bg-primary px-1 rounded">
                  rivano export
                </code>{" "}
                to create a portable backup
              </p>
            </div>
            <button className="px-3 py-1.5 bg-bg-hover border border-border text-text-secondary hover:text-text-primary text-xs rounded-md transition-colors">
              Export All Data
            </button>
          </div>

          <div className="border-t border-border-light" />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary">Storage Used</p>
              <p className="text-xs text-text-muted mt-0.5">
                SQLite database in {dataDir || "~/.rivano/data"}
              </p>
            </div>
            <span className="text-sm text-text-secondary tabular-nums">
              {storage ? `${storage.dbSizeMB} MB` : "--"}
            </span>
          </div>
        </div>
      </Card>

      {/* Upgrade to Rivano Cloud */}
      <div className="rounded-lg p-px bg-gradient-to-r from-rivano-500 to-rivano-700">
        <div className="bg-bg-card rounded-[7px] p-5">
          <div className="flex items-start justify-between">
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">
                  Upgrade to Rivano Cloud
                </h3>
                <p className="text-xs text-text-muted mt-0.5">
                  Enterprise features for production deployments
                </p>
              </div>
              <ul className="space-y-1.5">
                <FeatureItem text="Role-based access control (RBAC)" />
                <FeatureItem text="ML-powered anomaly detection" />
                <FeatureItem text="Real-time alerts and notifications" />
                <FeatureItem text="Fully managed hosting and scaling" />
              </ul>
            </div>
            <a
              href="https://rivano.ai"
              target="_blank"
              rel="noopener"
              className="px-4 py-2 bg-rivano-500 hover:bg-rivano-600 text-white text-sm rounded-md transition-colors flex-shrink-0 ml-4"
            >
              Learn More
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-text-muted">{label}</span>
      <span className="text-text-secondary font-mono">{value}</span>
    </div>
  );
}

function FeatureItem({ text }: { text: string }) {
  return (
    <li className="flex items-center gap-2 text-xs text-text-secondary">
      <svg
        className="w-3.5 h-3.5 text-rivano-400 flex-shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <path d="M20 6L9 17l-5-5" />
      </svg>
      {text}
    </li>
  );
}

function maskFull(masked: string): string {
  // Show only last 4 chars, rest as dots
  if (!masked) return "****";
  return "****" + masked.slice(-4);
}
