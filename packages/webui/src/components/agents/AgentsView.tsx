import { useEffect, useState } from "react";
import { api, type SystemStatus } from "../../lib/api";
import { Card } from "../shared/Card";

interface AgentConfig {
  name: string;
  description: string;
  provider: string;
  model: string;
  temperature: number;
  max_tokens: number;
  system_prompt: string;
}

interface AgentStatus extends AgentConfig {
  deployedAt: string;
  status: "deployed" | "pending";
}

const EMPTY_AGENT: AgentConfig = {
  name: "",
  description: "",
  provider: "anthropic",
  model: "",
  temperature: 1.0,
  max_tokens: 4096,
  system_prompt: "",
};

const PROVIDERS = ["anthropic", "openai", "ollama", "bedrock"] as const;

/**
 * Safely serialize a string as a YAML scalar value.
 * Uses double-quoted style with proper escaping for special characters.
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
 * Merge agent changes back into raw YAML, replacing the agents section
 * while preserving everything else (providers, proxy config, API keys).
 */
function mergeAgentsIntoYaml(rawYaml: string, agents: AgentConfig[]): string {
  const lines = rawYaml.split("\n");
  const result: string[] = [];
  let inAgents = false;

  for (const line of lines) {
    // Match "agents:" as a top-level key (possibly with inline value like "agents: []")
    const agentsHeaderMatch = line.match(/^agents\s*:\s*(.*)/);
    if (agentsHeaderMatch && !inAgents) {
      const inlineValue = agentsHeaderMatch[1].trim();
      // If "agents: []" or "agents:" with no inline content, start skipping
      if (inlineValue === "" || inlineValue === "[]") {
        inAgents = true;
        continue; // skip the agents: header line
      }
      // If "agents:" has an unexpected inline value, still skip this line
      // because we'll replace the whole section
      inAgents = true;
      continue;
    }
    if (inAgents) {
      // Lines within the agents section are indented (start with whitespace or "- ")
      // A non-blank, non-indented line means the agents section has ended
      if (line.trim().length > 0 && !/^\s/.test(line)) {
        inAgents = false;
        result.push(line);
      }
      // Skip all lines within the old agents section
      continue;
    }
    result.push(line);
  }

  // Remove trailing blank lines
  while (result.length > 0 && result[result.length - 1].trim() === "") {
    result.pop();
  }

  // Append new agents section
  result.push("");
  if (agents.length === 0) {
    result.push("agents: []");
  } else {
    result.push("agents:");
    for (const a of agents) {
      result.push(`  - name: ${yamlScalar(a.name)}`);
      if (a.description) result.push(`    description: ${yamlScalar(a.description)}`);
      result.push(`    model:`);
      result.push(`      provider: ${a.provider}`);
      result.push(`      name: ${yamlScalar(a.model)}`);
      result.push(`      temperature: ${a.temperature}`);
      result.push(`      max_tokens: ${a.max_tokens}`);
      result.push(`    system_prompt: ${yamlScalar(a.system_prompt)}`);
    }
  }
  result.push("");

  return result.join("\n");
}

export function AgentsView() {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [form, setForm] = useState<AgentConfig>({ ...EMPTY_AGENT });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [statusRes, configRes] = await Promise.all([
        api.status(),
        api.config(),
      ]);
      const agentList: AgentStatus[] = (statusRes.agents || []).map((a) => ({
        name: a.name,
        description: "",
        provider: a.provider,
        model: a.model,
        temperature: 1.0,
        max_tokens: 4096,
        system_prompt: "",
        deployedAt: a.deployedAt,
        status: "deployed" as const,
      }));

      // Merge with config data if available
      // API returns agents as { name, model: { provider, name, temperature, max_tokens }, system_prompt }
      const rawAgents = (configRes as { agents?: Array<Record<string, unknown>> }).agents;
      if (Array.isArray(rawAgents)) {
        for (const raw of rawAgents) {
          const m = (raw.model ?? {}) as Record<string, unknown>;
          const ca: AgentConfig = {
            name: raw.name as string,
            description: (raw.description as string) || "",
            provider: (m.provider as string) || "anthropic",
            model: (m.name as string) || "",
            temperature: (m.temperature as number) ?? 1.0,
            max_tokens: (m.max_tokens as number) ?? 4096,
            system_prompt: (raw.system_prompt as string) || "",
          };
          const existing = agentList.find((a) => a.name === ca.name);
          if (existing) {
            existing.description = ca.description;
            existing.provider = ca.provider;
            existing.model = ca.model;
            existing.temperature = ca.temperature;
            existing.max_tokens = ca.max_tokens;
            existing.system_prompt = ca.system_prompt;
          } else {
            agentList.push({
              ...ca,
              deployedAt: "",
              status: "pending",
            });
          }
        }
      }

      setAgents(agentList);
      setConfig(configRes);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    }
  }

  function openAddForm() {
    setForm({ ...EMPTY_AGENT });
    setEditIndex(null);
    setShowForm(true);
  }

  function openEditForm(index: number) {
    const agent = agents[index];
    setForm({
      name: agent.name,
      description: agent.description,
      provider: agent.provider,
      model: agent.model,
      temperature: agent.temperature,
      max_tokens: agent.max_tokens,
      system_prompt: agent.system_prompt,
    });
    setEditIndex(index);
    setShowForm(true);
  }

  async function saveAgent() {
    if (!form.name.trim() || !form.model.trim()) return;
    setSaving(true);
    setError(null);

    try {
      // Fetch raw YAML to preserve existing config structure and API keys
      const { yaml: rawYaml } = await api.configRaw();
      const currentConfig = config || {};
      const configAgents: AgentConfig[] = Array.isArray(
        (currentConfig as { agents?: AgentConfig[] }).agents
      )
        ? [...(currentConfig as { agents: AgentConfig[] }).agents]
        : [];

      if (editIndex !== null) {
        const oldName = agents[editIndex].name;
        const idx = configAgents.findIndex((a) => a.name === oldName);
        if (idx >= 0) {
          configAgents[idx] = { ...form };
        } else {
          configAgents.push({ ...form });
        }
      } else {
        configAgents.push({ ...form });
      }

      const mergedYaml = mergeAgentsIntoYaml(rawYaml, configAgents);
      await api.saveConfig(mergedYaml);
      setShowForm(false);
      setEditIndex(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save agent");
    } finally {
      setSaving(false);
    }
  }

  async function removeAgent(index: number) {
    setSaving(true);
    setError(null);
    try {
      const { yaml: rawYaml } = await api.configRaw();
      const currentConfig = config || {};
      const configAgents: AgentConfig[] = Array.isArray(
        (currentConfig as { agents?: AgentConfig[] }).agents
      )
        ? [...(currentConfig as { agents: AgentConfig[] }).agents]
        : [];

      const targetName = agents[index].name;
      const filtered = configAgents.filter((a) => a.name !== targetName);
      const mergedYaml = mergeAgentsIntoYaml(rawYaml, filtered);
      await api.saveConfig(mergedYaml);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove agent");
    } finally {
      setSaving(false);
    }
  }

  const deployedCount = agents.filter((a) => a.status === "deployed").length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Agents</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            {agents.length} configured, {deployedCount} deployed
          </p>
        </div>
        <button
          onClick={openAddForm}
          className="px-3 py-1.5 bg-rivano-500 hover:bg-rivano-600 text-white text-sm rounded-md transition-colors"
        >
          Add Agent
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-error/10 border border-error/30 rounded-lg p-4 text-error">
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Inline Add/Edit Form */}
      {showForm && (
        <Card
          title={editIndex !== null ? "Edit Agent" : "Add Agent"}
          action={
            <button
              onClick={() => {
                setShowForm(false);
                setEditIndex(null);
              }}
              className="text-xs text-text-muted hover:text-text-secondary"
            >
              Cancel
            </button>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-text-muted mb-1">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="my-agent"
                  className="w-full bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-rivano-500"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  placeholder="What this agent does"
                  className="w-full bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-rivano-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-text-muted mb-1">
                  Provider
                </label>
                <select
                  value={form.provider}
                  onChange={(e) =>
                    setForm({ ...form, provider: e.target.value })
                  }
                  className="w-full bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-rivano-500"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Model</label>
                <input
                  type="text"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="claude-sonnet-4-5"
                  className="w-full bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-rivano-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-text-muted mb-1">
                  Temperature: {form.temperature.toFixed(1)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={form.temperature}
                  onChange={(e) =>
                    setForm({ ...form, temperature: parseFloat(e.target.value) })
                  }
                  className="w-full accent-rivano-500"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">
                  Max Tokens
                </label>
                <input
                  type="number"
                  value={form.max_tokens}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      max_tokens: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-rivano-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-text-muted mb-1">
                System Prompt
              </label>
              <textarea
                value={form.system_prompt}
                onChange={(e) =>
                  setForm({ ...form, system_prompt: e.target.value })
                }
                rows={4}
                placeholder="You are a helpful assistant..."
                className="w-full bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-rivano-500 resize-none font-mono"
              />
            </div>

            <div className="flex justify-end">
              <button
                onClick={saveAgent}
                disabled={saving || !form.name.trim() || !form.model.trim()}
                className="px-4 py-2 bg-rivano-500 hover:bg-rivano-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-md transition-colors"
              >
                {saving
                  ? "Saving..."
                  : editIndex !== null
                    ? "Update Agent"
                    : "Deploy"}
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Agent Grid */}
      {agents.length === 0 && !showForm ? (
        <Card>
          <div className="text-center py-8">
            <p className="text-sm text-text-secondary">
              No agents configured yet
            </p>
            <p className="text-xs text-text-muted mt-1">
              Add an agent to get started with AI-powered workflows.
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {agents.map((agent, i) => (
            <div
              key={agent.name}
              className="bg-bg-card border border-border rounded-lg p-4 space-y-3"
            >
              {/* Name and status */}
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-text-primary truncate">
                    {agent.name}
                  </h3>
                  {agent.description && (
                    <p className="text-xs text-text-muted mt-0.5 truncate">
                      {agent.description}
                    </p>
                  )}
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ml-2 ${
                    agent.status === "deployed"
                      ? "bg-success/20 text-success"
                      : "bg-warning/20 text-warning"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      agent.status === "deployed"
                        ? "bg-success animate-pulse"
                        : "bg-warning"
                    }`}
                  />
                  {agent.status}
                </span>
              </div>

              {/* Provider / model badge */}
              <div>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-info/20 text-info">
                  {agent.provider} / {agent.model}
                </span>
              </div>

              {/* Config details */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-text-muted">Temperature</span>
                  <span className="text-text-secondary tabular-nums">
                    {agent.temperature.toFixed(1)}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-muted">Max Tokens</span>
                  <span className="text-text-secondary tabular-nums">
                    {agent.max_tokens.toLocaleString()}
                  </span>
                </div>
              </div>

              {/* System prompt preview */}
              {agent.system_prompt && (
                <p className="text-xs text-text-muted font-mono bg-bg-primary rounded px-2 py-1.5 truncate">
                  {agent.system_prompt.length > 100
                    ? agent.system_prompt.slice(0, 100) + "..."
                    : agent.system_prompt}
                </p>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => openEditForm(i)}
                  className="px-3 py-1.5 bg-bg-hover border border-border text-text-secondary hover:text-text-primary text-xs rounded-md transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => removeAgent(i)}
                  disabled={saving}
                  className="px-3 py-1.5 bg-bg-hover border border-border text-error/80 hover:text-error text-xs rounded-md transition-colors disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
