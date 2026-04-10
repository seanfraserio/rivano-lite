import { useEffect, useState, useCallback } from "react";
import { api } from "../../lib/api";
import { Card } from "../shared/Card";

// --- Types ---

interface Provider {
  name: string;
  type: string;
  base_url?: string;
  api_key?: string;
  models?: string[];
  enabled?: boolean;
}

interface Policy {
  name: string;
  phase: "request" | "response";
  condition: string;
  action: "block" | "warn" | "redact" | "tag";
  description?: string;
}

interface CacheConfig {
  enabled: boolean;
  ttl_seconds: number;
}

interface RateLimitConfig {
  requests_per_minute: number;
  burst: number;
}

/** Non-visual config fields preserved from original load */
interface PreservedConfig {
  proxyPort: number;
  defaultProvider: string;
  observerPort: number;
  observerRetentionDays: number;
  evaluators: string[];
  agents: unknown[];
}

interface ProxyConfig {
  providers?: Provider[];
  policies?: Policy[];
  cache?: CacheConfig;
  rate_limit?: RateLimitConfig;
  _preserved?: PreservedConfig;
}

type Mode = "visual" | "yaml";

interface Toast {
  message: string;
  type: "success" | "error" | "info";
}

// --- Helpers ---

const DEFAULT_URLS: Record<string, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
  ollama: "http://localhost:11434",
  bedrock: "",
};

const ACTION_STYLES: Record<string, string> = {
  block: "bg-error/20 text-error",
  warn: "bg-warning/20 text-warning",
  redact: "bg-info/20 text-info",
  tag: "bg-text-muted/20 text-text-muted",
};

/**
 * Extract provider API keys from raw YAML on disk (simple line parser).
 * Returns { providerName: "real-key-value" } for providers that have api_key set.
 */
function extractKeysFromYaml(rawYaml: string): Record<string, string> {
  const keys: Record<string, string> = {};
  const lines = rawYaml.split("\n");
  let currentProvider = "";
  let inProviders = false;

  for (const line of lines) {
    if (/^providers:/.test(line)) { inProviders = true; continue; }
    if (inProviders && /^\S/.test(line)) { inProviders = false; continue; }
    if (!inProviders) continue;

    const providerMatch = line.match(/^ {2}(\w+):$/);
    if (providerMatch) { currentProvider = providerMatch[1]; continue; }

    const keyMatch = line.match(/^ {4}api_key:\s*(.+)/);
    if (keyMatch && currentProvider) {
      keys[currentProvider] = keyMatch[1].replace(/^["']|["']$/g, "");
    }
  }
  return keys;
}

/**
 * Merge visual-mode changes into the raw YAML, preserving API keys
 * that are masked in the UI but present in the file.
 */
function mergeVisualIntoYaml(rawYaml: string, config: ProxyConfig): string {
  const realKeys = extractKeysFromYaml(rawYaml);

  const merged: ProxyConfig = {
    ...config,
    providers: config.providers?.map((p) => {
      if (p.api_key?.startsWith("****") && realKeys[p.name]) {
        return { ...p, api_key: realKeys[p.name] };
      }
      return p;
    }),
  };

  return configToRivanoYaml(merged);
}

function configToRivanoYaml(config: ProxyConfig): string {
  const p = config._preserved;
  const lines: string[] = ['version: "1"', ""];

  // Providers (object format, not array)
  lines.push("providers:");
  if (config.providers?.length) {
    for (const prov of config.providers) {
      lines.push(`  ${prov.name}:`);
      if (prov.api_key && !prov.api_key.startsWith("****")) {
        lines.push(`    api_key: "${prov.api_key}"`);
      }
      if (prov.base_url) lines.push(`    base_url: "${prov.base_url}"`);
      if (prov.models?.length) {
        lines.push("    models:");
        for (const m of prov.models) lines.push(`      - ${m}`);
      }
    }
  } else {
    lines.push("  {}");
  }

  // Proxy — preserve port and default_provider from original config
  lines.push("");
  lines.push("proxy:");
  lines.push(`  port: ${p?.proxyPort ?? 4000}`);
  lines.push(`  default_provider: ${p?.defaultProvider ?? config.providers?.[0]?.name ?? "anthropic"}`);
  lines.push("  cache:");
  lines.push(`    enabled: ${config.cache?.enabled ?? false}`);
  lines.push(`    ttl: ${config.cache?.ttl_seconds ?? 3600}`);
  lines.push("  rate_limit:");
  lines.push(`    requests_per_minute: ${config.rate_limit?.requests_per_minute ?? 60}`);
  if (config.rate_limit?.burst) {
    lines.push(`    burst: ${config.rate_limit.burst}`);
  }

  // Policies
  if (config.policies?.length) {
    lines.push("  policies:");
    for (const pol of config.policies) {
      lines.push(`    - name: ${pol.name}`);
      lines.push(`      on: ${pol.phase}`);
      try {
        const cond = JSON.parse(pol.condition);
        lines.push("      condition:");
        for (const [k, v] of Object.entries(cond)) {
          lines.push(`        ${k}: ${v}`);
        }
      } catch {
        lines.push(`      condition: {}`);
      }
      lines.push(`      action: ${pol.action}`);
      if (pol.description) lines.push(`      message: "${pol.description}"`);
    }
  } else {
    lines.push("  policies: []");
  }

  // Observer — preserve from original config
  lines.push("");
  lines.push("observer:");
  lines.push(`  port: ${p?.observerPort ?? 4100}`);
  lines.push("  storage: sqlite");
  lines.push(`  retention_days: ${p?.observerRetentionDays ?? 30}`);
  lines.push("  evaluators:");
  for (const ev of (p?.evaluators ?? ["latency", "cost"])) {
    lines.push(`    - ${ev}`);
  }

  // Agents — preserve from original config
  lines.push("");
  if (p?.agents?.length) {
    lines.push("agents:");
    // Re-serialize agents as YAML
    for (const agent of p.agents as Array<Record<string, unknown>>) {
      lines.push(`  - name: ${agent.name}`);
      if (agent.description) lines.push(`    description: "${agent.description}"`);
      if (agent.model) {
        const model = agent.model as Record<string, unknown>;
        lines.push("    model:");
        lines.push(`      provider: ${model.provider}`);
        lines.push(`      name: ${model.name}`);
        if (model.temperature != null) lines.push(`      temperature: ${model.temperature}`);
        if (model.max_tokens != null) lines.push(`      max_tokens: ${model.max_tokens}`);
      }
      if (agent.system_prompt) lines.push(`    system_prompt: "${agent.system_prompt}"`);
    }
  } else {
    lines.push("agents: []");
  }

  return lines.join("\n") + "\n";
}

// --- Sub-components ---

function ActionBadge({ action }: { action: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ACTION_STYLES[action] || ACTION_STYLES.tag}`}
    >
      {action}
    </span>
  );
}

function ProviderCard({ provider }: { provider: Provider }) {
  const url = provider.base_url || DEFAULT_URLS[provider.type] || "custom";
  return (
    <div className="flex items-center justify-between py-3 border-b border-border-light last:border-0">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">
            {provider.name}
          </span>
          <span className="text-xs text-text-muted bg-bg-hover px-1.5 py-0.5 rounded">
            {provider.type}
          </span>
        </div>
        <p className="text-xs text-text-muted font-mono">{url}</p>
        {provider.models?.length ? (
          <div className="flex gap-1 flex-wrap">
            {provider.models.map((m) => (
              <span
                key={m}
                className="text-[10px] text-text-secondary bg-bg-primary px-1.5 py-0.5 rounded"
              >
                {m}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
          provider.enabled !== false
            ? "bg-success/20 text-success"
            : "bg-text-muted/20 text-text-muted"
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            provider.enabled !== false ? "bg-success" : "bg-text-muted"
          }`}
        />
        {provider.enabled !== false ? "active" : "disabled"}
      </span>
    </div>
  );
}

function AddProviderForm({
  onAdd,
  onCancel,
}: {
  onAdd: (p: Provider) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState("anthropic");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  const inputCls =
    "w-full bg-bg-primary border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-rivano-500";

  return (
    <div className="space-y-3 pt-3 border-t border-border-light">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-text-muted block mb-1">Provider Type</label>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              if (!name) setName(e.target.value);
            }}
            className={inputCls}
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="ollama">Ollama</option>
            <option value="bedrock">AWS Bedrock</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-text-muted block mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. anthropic-prod"
            className={inputCls}
          />
        </div>
      </div>
      <div>
        <label className="text-xs text-text-muted block mb-1">Base URL</label>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={DEFAULT_URLS[type] || "https://..."}
          className={inputCls}
        />
      </div>
      <div>
        <label className="text-xs text-text-muted block mb-1">API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          className={inputCls}
        />
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 bg-bg-hover border border-border text-text-secondary text-sm rounded-md hover:text-text-primary transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            if (!name.trim()) return;
            onAdd({
              name: name.trim(),
              type,
              base_url: baseUrl || undefined,
              api_key: apiKey || undefined,
              enabled: true,
            });
          }}
          className="px-3 py-1.5 bg-rivano-500 hover:bg-rivano-600 text-white text-sm rounded-md transition-colors"
        >
          Add Provider
        </button>
      </div>
    </div>
  );
}

function AddPolicyForm({
  onAdd,
  onCancel,
}: {
  onAdd: (p: Policy) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<"request" | "response">("request");
  const [condition, setCondition] = useState("");
  const [action, setAction] = useState<Policy["action"]>("block");

  const inputCls =
    "w-full bg-bg-primary border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-rivano-500";

  return (
    <div className="space-y-3 pt-3 border-t border-border-light">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-text-muted block mb-1">Policy Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. block-pii-leak"
            className={inputCls}
          />
        </div>
        <div>
          <label className="text-xs text-text-muted block mb-1">Phase</label>
          <select
            value={phase}
            onChange={(e) => setPhase(e.target.value as "request" | "response")}
            className={inputCls}
          >
            <option value="request">request</option>
            <option value="response">response</option>
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs text-text-muted block mb-1">Condition</label>
        <input
          type="text"
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          placeholder='e.g. body contains "SSN"'
          className={inputCls}
        />
      </div>
      <div>
        <label className="text-xs text-text-muted block mb-1">Action</label>
        <select
          value={action}
          onChange={(e) => setAction(e.target.value as Policy["action"])}
          className={inputCls}
        >
          <option value="block">block</option>
          <option value="warn">warn</option>
          <option value="redact">redact</option>
          <option value="tag">tag</option>
        </select>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 bg-bg-hover border border-border text-text-secondary text-sm rounded-md hover:text-text-primary transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            if (!name.trim() || !condition.trim()) return;
            onAdd({ name: name.trim(), phase, condition: condition.trim(), action });
          }}
          className="px-3 py-1.5 bg-rivano-500 hover:bg-rivano-600 text-white text-sm rounded-md transition-colors"
        >
          Add Policy
        </button>
      </div>
    </div>
  );
}

function ToastMessage({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const bg =
    toast.type === "success"
      ? "bg-success/15 border-success/30 text-success"
      : toast.type === "error"
        ? "bg-error/15 border-error/30 text-error"
        : "bg-info/15 border-info/30 text-info";

  return (
    <div
      className={`fixed top-4 right-4 z-50 border rounded-lg px-4 py-3 text-sm shadow-lg ${bg}`}
    >
      {toast.message}
    </div>
  );
}

// --- Visual Mode ---

function VisualMode({
  config,
  onChange,
}: {
  config: ProxyConfig;
  onChange: (c: ProxyConfig) => void;
}) {
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [showAddPolicy, setShowAddPolicy] = useState(false);

  return (
    <div className="space-y-6">
      {/* Providers */}
      <Card
        title="Providers"
        action={
          !showAddProvider ? (
            <button
              type="button"
              onClick={() => setShowAddProvider(true)}
              className="text-xs text-rivano-400 hover:text-rivano-300 transition-colors"
            >
              + Add Provider
            </button>
          ) : null
        }
      >
        {config.providers?.length ? (
          <div>
            {config.providers.map((p) => (
              <ProviderCard key={p.name} provider={p} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            No providers configured. Add one to start proxying AI requests.
          </p>
        )}
        {showAddProvider && (
          <AddProviderForm
            onAdd={(p) => {
              onChange({
                ...config,
                providers: [...(config.providers || []), p],
              });
              setShowAddProvider(false);
            }}
            onCancel={() => setShowAddProvider(false)}
          />
        )}
      </Card>

      {/* Policies */}
      <Card
        title="Policies"
        action={
          !showAddPolicy ? (
            <button
              type="button"
              onClick={() => setShowAddPolicy(true)}
              className="text-xs text-rivano-400 hover:text-rivano-300 transition-colors"
            >
              + Add Policy
            </button>
          ) : null
        }
      >
        {config.policies?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-text-muted border-b border-border-light">
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium">Phase</th>
                  <th className="pb-2 font-medium">Condition</th>
                  <th className="pb-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {config.policies.map((p) => (
                  <tr
                    key={p.name}
                    className="border-b border-border-light last:border-0"
                  >
                    <td className="py-2.5 text-text-primary font-medium">
                      {p.name}
                    </td>
                    <td className="py-2.5 text-text-secondary">{p.phase}</td>
                    <td className="py-2.5 text-text-secondary font-mono text-xs">
                      {p.condition}
                    </td>
                    <td className="py-2.5">
                      <ActionBadge action={p.action} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            No policies configured. Add policies to enforce guardrails on AI traffic.
          </p>
        )}
        {showAddPolicy && (
          <AddPolicyForm
            onAdd={(p) => {
              onChange({
                ...config,
                policies: [...(config.policies || []), p],
              });
              setShowAddPolicy(false);
            }}
            onCancel={() => setShowAddPolicy(false)}
          />
        )}
      </Card>

      {/* Cache & Rate Limiting */}
      <div className="grid grid-cols-2 gap-4">
        <Card title="Cache">
          <div className="space-y-4">
            <label className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Enabled</span>
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...config,
                    cache: {
                      ...(config.cache || { enabled: false, ttl_seconds: 300 }),
                      enabled: !config.cache?.enabled,
                    },
                  })
                }
                className={`relative w-9 h-5 rounded-full transition-colors ${
                  config.cache?.enabled
                    ? "bg-rivano-500"
                    : "bg-border"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    config.cache?.enabled ? "translate-x-4" : ""
                  }`}
                />
              </button>
            </label>
            <div>
              <label className="text-xs text-text-muted block mb-1">
                TTL (seconds)
              </label>
              <input
                type="number"
                value={config.cache?.ttl_seconds ?? 300}
                onChange={(e) =>
                  onChange({
                    ...config,
                    cache: {
                      enabled: config.cache?.enabled ?? false,
                      ttl_seconds: parseInt(e.target.value) || 0,
                    },
                  })
                }
                className="w-full bg-bg-primary border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-rivano-500"
              />
            </div>
          </div>
        </Card>

        <Card title="Rate Limiting">
          <div className="space-y-4">
            <div>
              <label className="text-xs text-text-muted block mb-1">
                Requests / minute
              </label>
              <input
                type="number"
                value={config.rate_limit?.requests_per_minute ?? 60}
                onChange={(e) =>
                  onChange({
                    ...config,
                    rate_limit: {
                      requests_per_minute: parseInt(e.target.value) || 0,
                      burst: config.rate_limit?.burst ?? 10,
                    },
                  })
                }
                className="w-full bg-bg-primary border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-rivano-500"
              />
            </div>
            <div>
              <label className="text-xs text-text-muted block mb-1">Burst</label>
              <input
                type="number"
                value={config.rate_limit?.burst ?? 10}
                onChange={(e) =>
                  onChange({
                    ...config,
                    rate_limit: {
                      requests_per_minute:
                        config.rate_limit?.requests_per_minute ?? 60,
                      burst: parseInt(e.target.value) || 0,
                    },
                  })
                }
                className="w-full bg-bg-primary border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-rivano-500"
              />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// --- YAML Mode ---

function YamlMode({
  yaml,
  onChange,
}: {
  yaml: string;
  onChange: (y: string) => void;
}) {
  return (
    <div className="relative">
      <textarea
        value={yaml}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="w-full min-h-[500px] bg-bg-primary border border-border rounded-lg p-4 pl-14 font-mono text-sm text-text-secondary leading-6 resize-y focus:outline-none focus:border-rivano-500"
      />
      {/* Line numbers overlay */}
      <div
        className="absolute top-0 left-0 w-10 min-h-[500px] pt-4 pr-2 text-right font-mono text-xs text-text-muted/50 leading-6 select-none pointer-events-none border-r border-border-light"
        aria-hidden="true"
      >
        {yaml.split("\n").map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
    </div>
  );
}

// --- Main View ---

export function ProxyConfigView() {
  const [mode, setMode] = useState<Mode>("visual");
  const [config, setConfig] = useState<ProxyConfig>({});
  const [yaml, setYaml] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = useCallback((message: string, type: Toast["type"]) => {
    setToast({ message, type });
  }, []);

  // Transform API response (object-shaped) to component format (array-shaped)
  function transformApiConfig(data: Record<string, unknown>): ProxyConfig {
    const providers: Provider[] = [];
    const rawProviders = (data.providers ?? {}) as Record<string, Record<string, unknown>>;
    for (const [name, cfg] of Object.entries(rawProviders)) {
      providers.push({
        name,
        type: name,
        api_key: cfg.api_key as string | undefined,
        base_url: cfg.base_url as string | undefined,
        models: cfg.models as string[] | undefined,
        enabled: true,
      });
    }

    const proxy = (data.proxy ?? {}) as Record<string, unknown>;
    const rawPolicies = (proxy.policies ?? []) as Array<Record<string, unknown>>;
    const policies: Policy[] = rawPolicies.map((p) => ({
      name: p.name as string,
      phase: (p.on as "request" | "response") ?? "request",
      condition: JSON.stringify(p.condition ?? {}),
      action: p.action as Policy["action"],
      description: p.message as string | undefined,
    }));

    const cache = proxy.cache as Record<string, unknown> | undefined;
    const rateLimit = proxy.rate_limit as Record<string, unknown> | undefined;

    const observer = (data.observer ?? {}) as Record<string, unknown>;
    const agents = (data.agents ?? []) as unknown[];

    return {
      providers,
      policies,
      cache: cache ? {
        enabled: (cache.enabled as boolean) ?? false,
        ttl_seconds: (cache.ttl as number) ?? 3600,
      } : { enabled: false, ttl_seconds: 3600 },
      rate_limit: rateLimit ? {
        requests_per_minute: (rateLimit.requests_per_minute as number) ?? 60,
        burst: (rateLimit.burst as number) ?? 10,
      } : { requests_per_minute: 60, burst: 10 },
      _preserved: {
        proxyPort: (proxy.port as number) ?? 4000,
        defaultProvider: (proxy.default_provider as string) ?? "anthropic",
        observerPort: (observer.port as number) ?? 4100,
        observerRetentionDays: (observer.retention_days as number) ?? 30,
        evaluators: (observer.evaluators as string[]) ?? ["latency", "cost"],
        agents,
      },
    };
  }

  // Load config on mount — use raw YAML to preserve API keys
  useEffect(() => {
    async function load() {
      try {
        const { yaml: rawYaml } = await api.configRaw();
        setYaml(rawYaml);
        // Also parse for visual mode
        const data = await api.config();
        const parsed = transformApiConfig(data);
        setConfig(parsed);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load config");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Sync visual -> yaml when switching modes
  async function switchMode(next: Mode) {
    if (next === "yaml" && mode === "visual") {
      // Try to load current raw YAML from server, fall back to generated
      try {
        const raw = await fetch("/api/config/raw").then((r) => r.json());
        setYaml(raw.yaml || configToRivanoYaml(config));
      } catch {
        setYaml(configToRivanoYaml(config));
      }
    }
    setMode(next);
  }

  async function handleValidate() {
    setValidating(true);
    try {
      const currentYaml = mode === "yaml" ? yaml : configToRivanoYaml(config);
      const result = await api.validateConfig(currentYaml);
      if (result.valid) {
        showToast("Configuration is valid", "success");
      } else {
        showToast(
          `Validation failed: ${result.errors?.join(", ") || "unknown error"}`,
          "error"
        );
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Validation request failed",
        "error"
      );
    } finally {
      setValidating(false);
    }
  }

  async function handleApply() {
    setSaving(true);
    try {
      let currentYaml: string;
      if (mode === "yaml") {
        currentYaml = yaml;
      } else {
        // Visual mode: check if any providers have masked keys
        const hasMaskedKeys = config.providers?.some(
          (p) => p.api_key?.startsWith("****")
        );
        if (hasMaskedKeys) {
          // Merge visual changes into raw YAML to preserve real API keys
          const { yaml: rawYaml } = await api.configRaw();
          currentYaml = mergeVisualIntoYaml(rawYaml, config);
        } else {
          currentYaml = configToRivanoYaml(config);
        }
      }
      await api.saveConfig(currentYaml);
      showToast("Config saved — reloading...", "success");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to save config",
        "error"
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="text-sm text-text-muted animate-pulse">
          Loading configuration...
        </div>
      </div>
    );
  }

  if (error && !config.providers) {
    return (
      <div className="p-6">
        <div className="bg-error/10 border border-error/30 rounded-lg p-4 text-error">
          <p className="font-medium">Connection Error</p>
          <p className="text-sm mt-1 text-error/80">{error}</p>
          <p className="text-xs mt-2 text-text-muted">
            Make sure the Rivano proxy service is running.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {toast && (
        <ToastMessage toast={toast} onDismiss={() => setToast(null)} />
      )}

      {/* Header + Controls */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">
            Proxy Config
          </h1>
          <p className="text-sm text-text-secondary mt-0.5">
            Configure providers, policies, cache, and rate limits
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Mode Toggle */}
          <div className="flex bg-bg-secondary rounded-md border border-border p-0.5">
            <button
              type="button"
              onClick={() => switchMode("visual")}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                mode === "visual"
                  ? "bg-bg-hover text-text-primary font-medium"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              Visual
            </button>
            <button
              type="button"
              onClick={() => switchMode("yaml")}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                mode === "yaml"
                  ? "bg-bg-hover text-text-primary font-medium"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              YAML
            </button>
          </div>

          {/* Validate */}
          <button
            type="button"
            onClick={handleValidate}
            disabled={validating}
            className="px-3 py-1.5 bg-bg-hover border border-border text-text-secondary text-sm rounded-md hover:text-text-primary transition-colors disabled:opacity-50"
          >
            {validating ? "Validating..." : "Validate"}
          </button>

          {/* Apply */}
          <button
            type="button"
            onClick={handleApply}
            disabled={saving}
            className="px-3 py-1.5 bg-rivano-500 hover:bg-rivano-600 text-white text-sm rounded-md transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Apply"}
          </button>
        </div>
      </div>

      {/* Content */}
      {mode === "visual" ? (
        <VisualMode config={config} onChange={setConfig} />
      ) : (
        <YamlMode yaml={yaml} onChange={setYaml} />
      )}
    </div>
  );
}
