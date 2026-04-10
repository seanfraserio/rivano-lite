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

interface ProxyConfig {
  providers?: Provider[];
  policies?: Policy[];
  cache?: CacheConfig;
  rate_limit?: RateLimitConfig;
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
 * Safely serialize a string as a YAML scalar value.
 */
function yamlScalar(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

/**
 * Splice a new providers section into existing raw YAML.
 * Replaces the `providers:` block while preserving everything else.
 */
function mergeProvidersIntoYaml(rawYaml: string, providers: Provider[]): string {
  const lines = rawYaml.split("\n");
  const result: string[] = [];
  let skipUntilNextTopLevel = false;

  for (const line of lines) {
    if (!skipUntilNextTopLevel && /^providers\s*:/.test(line)) {
      skipUntilNextTopLevel = true;
      continue;
    }
    if (skipUntilNextTopLevel) {
      if (line.trim().length > 0 && !/^\s/.test(line)) {
        skipUntilNextTopLevel = false;
        result.push(line);
      }
      continue;
    }
    result.push(line);
  }

  // Remove trailing blank lines
  while (result.length > 0 && result[result.length - 1].trim() === "") {
    result.pop();
  }

  // Build new providers section and prepend it
  const providerLines: string[] = [];
  if (providers.length === 0) {
    providerLines.push("providers: {}");
  } else {
    providerLines.push("providers:");
    for (const p of providers) {
      providerLines.push(`  ${p.name}:`);
      if (p.api_key && !p.api_key.startsWith("****")) {
        providerLines.push(`    api_key: ${yamlScalar(p.api_key)}`);
      }
      if (p.base_url) providerLines.push(`    base_url: ${yamlScalar(p.base_url)}`);
      if (p.models?.length) {
        providerLines.push("    models:");
        for (const m of p.models) providerLines.push(`      - ${m}`);
      }
    }
  }
  providerLines.push("");

  // Find where to insert — providers should be at the top (after version line)
  const versionIdx = result.findIndex((l) => /^version\s*:/.test(l));
  const insertAt = versionIdx >= 0 ? versionIdx + 1 : 0;
  // Skip blank lines after version
  let actualInsert = insertAt;
  while (actualInsert < result.length && result[actualInsert].trim() === "") {
    actualInsert++;
  }

  result.splice(actualInsert, 0, ...providerLines);

  return result.join("\n") + "\n";
}

/**
 * Splice a new policies list into the proxy section of existing raw YAML.
 * Replaces the `policies:` block under `proxy:` while preserving everything else.
 */
function mergePoliciesIntoYaml(rawYaml: string, policies: Policy[]): string {
  const lines = rawYaml.split("\n");
  const result: string[] = [];
  let inProxy = false;
  let skipPolicies = false;
  let policiesIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track if we're inside the proxy: block
    if (/^proxy\s*:/.test(line)) {
      inProxy = true;
      result.push(line);
      continue;
    }
    if (inProxy && /^\S/.test(line) && line.trim().length > 0) {
      inProxy = false;
    }

    // Find policies: under proxy:
    if (inProxy && !skipPolicies && /^\s+policies\s*:/.test(line)) {
      skipPolicies = true;
      policiesIndent = line.search(/\S/);
      // Don't push this line — we'll regenerate it
      continue;
    }

    if (skipPolicies) {
      // Skip lines that are more indented than the policies key, or blank
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const indent = line.search(/\S/);
      if (indent > policiesIndent) continue;
      // We've hit something at the same or lower indent — stop skipping
      skipPolicies = false;
      // Fall through to push this line
    }

    result.push(line);
  }

  // Now insert the policies block right before the end of the proxy section
  // Find the proxy: line and the next top-level key after it
  let proxyLineIdx = -1;
  let nextTopLevelAfterProxy = result.length;
  for (let i = 0; i < result.length; i++) {
    if (/^proxy\s*:/.test(result[i])) {
      proxyLineIdx = i;
    } else if (proxyLineIdx >= 0 && /^\S/.test(result[i]) && result[i].trim().length > 0) {
      nextTopLevelAfterProxy = i;
      break;
    }
  }

  // Build policies YAML
  const policyLines: string[] = [];
  if (policies.length === 0) {
    policyLines.push("  policies: []");
  } else {
    policyLines.push("  policies:");
    for (const p of policies) {
      policyLines.push(`    - name: ${p.name}`);
      policyLines.push(`      on: ${p.phase}`);
      try {
        const cond = JSON.parse(p.condition);
        policyLines.push("      condition:");
        for (const [k, v] of Object.entries(cond)) {
          if (typeof v === "object" && v !== null) {
            policyLines.push(`        ${k}:`);
            for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
              policyLines.push(`          ${sk}: ${sv}`);
            }
          } else {
            policyLines.push(`        ${k}: ${v}`);
          }
        }
      } catch {
        policyLines.push(`      condition: {}`);
      }
      policyLines.push(`      action: ${p.action}`);
      if (p.description) policyLines.push(`      message: ${yamlScalar(p.description)}`);
    }
  }

  // Insert before the next top-level key after proxy
  result.splice(nextTopLevelAfterProxy, 0, ...policyLines);

  return result.join("\n");
}

/**
 * Extract real API keys from raw YAML to preserve them when saving.
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

function ProviderCard({
  provider,
  onRemove,
  removing,
}: {
  provider: Provider;
  onRemove: () => void;
  removing: boolean;
}) {
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
      <div className="flex items-center gap-3">
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
        <button
          type="button"
          onClick={onRemove}
          disabled={removing}
          className="px-2 py-1 bg-bg-hover border border-border text-error/80 hover:text-error text-xs rounded-md transition-colors disabled:opacity-50"
        >
          {removing ? "..." : "Remove"}
        </button>
      </div>
    </div>
  );
}

function AddProviderForm({
  onAdd,
  onCancel,
  saving,
}: {
  onAdd: (p: Provider) => void;
  onCancel: () => void;
  saving: boolean;
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
          disabled={saving}
          className="px-3 py-1.5 bg-bg-hover border border-border text-text-secondary text-sm rounded-md hover:text-text-primary transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={saving || !name.trim()}
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
          className="px-3 py-1.5 bg-rivano-500 hover:bg-rivano-600 text-white text-sm rounded-md transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Add Provider"}
        </button>
      </div>
    </div>
  );
}

function AddPolicyForm({
  onAdd,
  onCancel,
  saving,
}: {
  onAdd: (p: Policy) => void;
  onCancel: () => void;
  saving: boolean;
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
        <label className="text-xs text-text-muted block mb-1">Condition (JSON)</label>
        <input
          type="text"
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          placeholder='{"contains": "SSN"}'
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
          disabled={saving}
          className="px-3 py-1.5 bg-bg-hover border border-border text-text-secondary text-sm rounded-md hover:text-text-primary transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={saving || !name.trim() || !condition.trim()}
          onClick={() => {
            if (!name.trim() || !condition.trim()) return;
            onAdd({ name: name.trim(), phase, condition: condition.trim(), action });
          }}
          className="px-3 py-1.5 bg-rivano-500 hover:bg-rivano-600 text-white text-sm rounded-md transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Add Policy"}
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
  onCacheChange,
  onRateLimitChange,
  onAddProvider,
  onRemoveProvider,
  onAddPolicy,
  onRemovePolicy,
  saving,
}: {
  config: ProxyConfig;
  onCacheChange: (c: CacheConfig) => void;
  onRateLimitChange: (r: RateLimitConfig) => void;
  onAddProvider: (p: Provider) => void;
  onRemoveProvider: (name: string) => void;
  onAddPolicy: (p: Policy) => void;
  onRemovePolicy: (name: string) => void;
  saving: boolean;
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
              <ProviderCard
                key={p.name}
                provider={p}
                removing={saving}
                onRemove={() => onRemoveProvider(p.name)}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            No providers configured. Add one to start proxying AI requests.
          </p>
        )}
        {showAddProvider && (
          <AddProviderForm
            saving={saving}
            onAdd={(p) => {
              onAddProvider(p);
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
                  <th className="pb-2 font-medium w-20"></th>
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
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => onRemovePolicy(p.name)}
                        className="px-2 py-0.5 bg-bg-hover border border-border text-error/80 hover:text-error text-xs rounded-md transition-colors disabled:opacity-50"
                      >
                        {saving ? "..." : "Remove"}
                      </button>
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
            saving={saving}
            onAdd={(p) => {
              onAddPolicy(p);
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
                  onCacheChange({
                    ...(config.cache || { enabled: false, ttl_seconds: 300 }),
                    enabled: !config.cache?.enabled,
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
                  onCacheChange({
                    enabled: config.cache?.enabled ?? false,
                    ttl_seconds: parseInt(e.target.value) || 0,
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
                  onRateLimitChange({
                    requests_per_minute: parseInt(e.target.value) || 0,
                    burst: config.rate_limit?.burst ?? 10,
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
                  onRateLimitChange({
                    requests_per_minute:
                      config.rate_limit?.requests_per_minute ?? 60,
                    burst: parseInt(e.target.value) || 0,
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
    };
  }

  async function loadData() {
    try {
      const [rawRes, configRes] = await Promise.all([
        api.configRaw().catch(() => null),
        api.config(),
      ]);
      if (rawRes) setYaml(rawRes.yaml);
      setConfig(transformApiConfig(configRes));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load config");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  // ── Immediate-save CRUD operations (same pattern as AgentsView) ──

  async function addProvider(provider: Provider) {
    setSaving(true);
    try {
      const { yaml: rawYaml } = await api.configRaw();
      // Preserve existing real keys, add new provider
      const existingKeys = extractKeysFromYaml(rawYaml);
      const allProviders = [
        ...(config.providers || []).map((p) => {
          // Restore real keys for masked providers
          if (p.api_key?.startsWith("****") && existingKeys[p.name]) {
            return { ...p, api_key: existingKeys[p.name] };
          }
          return p;
        }),
        provider,
      ];
      const merged = mergeProvidersIntoYaml(rawYaml, allProviders);
      const validation = await api.validateConfig(merged);
      if (!validation.valid) {
        showToast(`Validation error: ${validation.errors?.join(", ") ?? "unknown"}`, "error");
        return;
      }
      await api.saveConfig(merged);
      await loadData();
      showToast(`Provider "${provider.name}" added`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to add provider", "error");
    } finally {
      setSaving(false);
    }
  }

  async function removeProvider(name: string) {
    setSaving(true);
    try {
      const { yaml: rawYaml } = await api.configRaw();
      const existingKeys = extractKeysFromYaml(rawYaml);
      const remaining = (config.providers || [])
        .filter((p) => p.name !== name)
        .map((p) => {
          if (p.api_key?.startsWith("****") && existingKeys[p.name]) {
            return { ...p, api_key: existingKeys[p.name] };
          }
          return p;
        });
      const merged = mergeProvidersIntoYaml(rawYaml, remaining);
      const validation = await api.validateConfig(merged);
      if (!validation.valid) {
        showToast(`Validation error: ${validation.errors?.join(", ") ?? "unknown"}`, "error");
        return;
      }
      await api.saveConfig(merged);
      await loadData();
      showToast(`Provider "${name}" removed`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to remove provider", "error");
    } finally {
      setSaving(false);
    }
  }

  async function addPolicy(policy: Policy) {
    setSaving(true);
    try {
      const { yaml: rawYaml } = await api.configRaw();
      const allPolicies = [...(config.policies || []), policy];
      const merged = mergePoliciesIntoYaml(rawYaml, allPolicies);
      const validation = await api.validateConfig(merged);
      if (!validation.valid) {
        showToast(`Validation error: ${validation.errors?.join(", ") ?? "unknown"}`, "error");
        return;
      }
      await api.saveConfig(merged);
      await loadData();
      showToast(`Policy "${policy.name}" added`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to add policy", "error");
    } finally {
      setSaving(false);
    }
  }

  async function removePolicy(name: string) {
    setSaving(true);
    try {
      const { yaml: rawYaml } = await api.configRaw();
      const remaining = (config.policies || []).filter((p) => p.name !== name);
      const merged = mergePoliciesIntoYaml(rawYaml, remaining);
      const validation = await api.validateConfig(merged);
      if (!validation.valid) {
        showToast(`Validation error: ${validation.errors?.join(", ") ?? "unknown"}`, "error");
        return;
      }
      await api.saveConfig(merged);
      await loadData();
      showToast(`Policy "${name}" removed`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to remove policy", "error");
    } finally {
      setSaving(false);
    }
  }

  // ── Mode switching ──

  async function switchMode(next: Mode) {
    if (next === "yaml" && mode === "visual") {
      try {
        const raw = await api.configRaw();
        setYaml(raw.yaml);
      } catch {
        // fall through with current yaml
      }
    }
    setMode(next);
  }

  // ── YAML mode + cache/rate-limit Apply ──

  async function handleApply() {
    setSaving(true);
    try {
      if (mode === "yaml") {
        await api.saveConfig(yaml);
        await loadData();
        showToast("Config saved — reloading...", "success");
      } else {
        // Visual mode Apply is only for cache + rate limit settings
        const { yaml: rawYaml } = await api.configRaw();
        // We need to update cache and rate_limit in the YAML
        // Simple approach: parse and re-save via the full config
        const existingKeys = extractKeysFromYaml(rawYaml);
        const providers = (config.providers || []).map((p) => {
          if (p.api_key?.startsWith("****") && existingKeys[p.name]) {
            return { ...p, api_key: existingKeys[p.name] };
          }
          return p;
        });

        // Replace proxy cache + rate_limit lines in raw YAML
        let updated = mergeProvidersIntoYaml(rawYaml, providers);
        updated = mergePoliciesIntoYaml(updated, config.policies || []);

        // For cache/rate-limit, we do a simple line replacement
        const lines = updated.split("\n");
        const result: string[] = [];
        let inCache = false;
        let inRateLimit = false;

        for (const line of lines) {
          if (/^\s+cache\s*:/.test(line) && !line.startsWith("    ")) {
            inCache = true;
            result.push(line);
            continue;
          }
          if (inCache) {
            if (/^\s+enabled\s*:/.test(line)) {
              result.push(`    enabled: ${config.cache?.enabled ?? false}`);
              continue;
            }
            if (/^\s+ttl\s*:/.test(line)) {
              result.push(`    ttl: ${config.cache?.ttl_seconds ?? 3600}`);
              inCache = false;
              continue;
            }
          }
          if (/^\s+rate_limit\s*:/.test(line) && !line.startsWith("    ")) {
            inRateLimit = true;
            result.push(line);
            continue;
          }
          if (inRateLimit) {
            if (/^\s+requests_per_minute\s*:/.test(line)) {
              result.push(`    requests_per_minute: ${config.rate_limit?.requests_per_minute ?? 60}`);
              continue;
            }
            if (/^\s+burst\s*:/.test(line)) {
              result.push(`    burst: ${config.rate_limit?.burst ?? 10}`);
              inRateLimit = false;
              continue;
            }
            if (/^\s+\S/.test(line) && !/^\s+burst/.test(line) && !/^\s+requests_per_minute/.test(line)) {
              inRateLimit = false;
            }
          }
          result.push(line);
        }

        const finalYaml = result.join("\n");
        const validation = await api.validateConfig(finalYaml);
        if (!validation.valid) {
          showToast(`Validation error: ${validation.errors?.join(", ") ?? "unknown"}`, "error");
          return;
        }
        await api.saveConfig(finalYaml);
        await loadData();
        showToast("Settings saved — reloading...", "success");
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to save config",
        "error"
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    setValidating(true);
    try {
      const currentYaml = mode === "yaml" ? yaml : (await api.configRaw().then((r) => r.yaml));
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

          {/* Apply — for YAML mode or cache/rate-limit changes */}
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
        <VisualMode
          config={config}
          saving={saving}
          onAddProvider={addProvider}
          onRemoveProvider={removeProvider}
          onAddPolicy={addPolicy}
          onRemovePolicy={removePolicy}
          onCacheChange={(c) => setConfig({ ...config, cache: c })}
          onRateLimitChange={(r) => setConfig({ ...config, rate_limit: r })}
        />
      ) : (
        <YamlMode yaml={yaml} onChange={setYaml} />
      )}
    </div>
  );
}
