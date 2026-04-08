import { useEffect, useState } from "react";
import { api, type HealthStatus, type SystemStatus, type TraceStats } from "../../lib/api";
import { MetricCard } from "../shared/MetricCard";
import { Card } from "../shared/Card";
import { StatusBadge } from "../shared/StatusBadge";

interface PolicySummary {
  total: number;
  allowed: number;
  blocked: number;
  redacted: number;
  warned: number;
}

interface DashboardData {
  health: HealthStatus | null;
  status: SystemStatus | null;
  stats: TraceStats | null;
  policy: PolicySummary | null;
  error: string | null;
}

export function DashboardView() {
  const [data, setData] = useState<DashboardData>({
    health: null,
    status: null,
    stats: null,
    policy: null,
    error: null,
  });

  const [authRequired, setAuthRequired] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [health, status, stats, policyRes] = await Promise.all([
          api.health(),
          api.status().catch((err) => {
            if (err instanceof Error && (err.message.includes("401") || err.message.includes("API key"))) {
              setAuthRequired(true);
            }
            return null;
          }),
          api.traceStats().catch(() => null),
          fetch("/api/policy-activity")
            .then((r) => r.json())
            .catch(() => null),
        ]);
        setData({
          health,
          status,
          stats,
          policy: policyRes?.summary ?? null,
          error: null,
        });
      } catch (err) {
        setData((d) => ({
          ...d,
          error: err instanceof Error ? err.message : "Failed to load",
        }));
      }
    }
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  if (data.error && !data.health) {
    return (
      <div className="p-6">
        <div className="bg-error/10 border border-error/30 rounded-lg p-4 text-error">
          <p className="font-medium">Connection Error</p>
          <p className="text-sm mt-1 text-error/80">{data.error}</p>
          <p className="text-xs mt-2 text-text-muted">
            Make sure all Rivano services are running.
          </p>
        </div>
      </div>
    );
  }

  const { health, status, stats, policy } = data;
  const agentCount = health?.services.agents ?? 0;

  return (
    <div className="p-6 space-y-6">
      {authRequired && !status && (
        <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
          <p className="font-medium text-warning">API Key Required</p>
          <p className="text-sm mt-1 text-text-secondary">
            Set your API key in <a href="/settings" className="text-rivano-400 hover:underline">Settings</a> to view dashboard data.
          </p>
        </div>
      )}
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Dashboard</h1>
        <p className="text-sm text-text-secondary mt-0.5">
          Rivano Lite system overview
        </p>
      </div>

      {/* Services Status */}
      <div className="grid grid-cols-3 gap-4">
        <Card title="Proxy Gateway">
          <div className="flex items-center justify-between">
            <StatusBadge
              status={health?.services.proxy === "running" ? "running" : "stopped"}
            />
            <span className="text-xs text-text-muted">
              :{status?.proxy.port || 4000}
            </span>
          </div>
          <div className="mt-3 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-text-muted">Providers</span>
              <span className="text-text-secondary">
                {status?.proxy.providers.join(", ") || "none"}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-text-muted">Policies</span>
              <span className="text-text-secondary">
                {status?.proxy.policies || 0} active
              </span>
            </div>
          </div>
        </Card>

        <Card title="Observer">
          <div className="flex items-center justify-between">
            <StatusBadge
              status={
                health?.services.observer === "running" ? "running" : "stopped"
              }
            />
            <span className="text-xs text-text-muted">
              :{status?.observer.port || 4100}
            </span>
          </div>
          <div className="mt-3 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-text-muted">Storage</span>
              <span className="text-text-secondary">
                {status?.observer.storage || "sqlite"}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-text-muted">Retention</span>
              <span className="text-text-secondary">
                {status?.observer.retentionDays || 30}d
              </span>
            </div>
          </div>
        </Card>

        <Card title="Agents">
          <div className="flex items-center justify-between">
            <StatusBadge
              status={agentCount > 0 ? "running" : "stopped"}
              label={`${agentCount} deployed`}
            />
          </div>
          {status?.agents && status.agents.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              {status.agents.slice(0, 3).map((a) => (
                <div key={a.name} className="flex justify-between text-xs">
                  <span className="text-text-secondary">{a.name}</span>
                  <span className="text-text-muted">
                    {a.provider}/{a.model}
                  </span>
                </div>
              ))}
              {status.agents.length > 3 && (
                <p className="text-[11px] text-text-muted">
                  +{status.agents.length - 3} more
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-text-muted mt-3">
              No agents configured —{" "}
              <a href="/agents" className="text-rivano-400 hover:underline">
                add one
              </a>
            </p>
          )}
        </Card>
      </div>

      {/* Metrics — 2 rows */}
      <div className="grid grid-cols-6 gap-4">
        <MetricCard
          label="Total Requests"
          value={stats?.totalTraces.toLocaleString() ?? "0"}
        />
        <MetricCard
          label="Traces Blocked"
          value={policy?.blocked ?? 0}
          className={policy?.blocked ? "border-error/30" : ""}
        />
        <MetricCard
          label="PII Redacted"
          value={policy?.redacted ?? 0}
        />
        <MetricCard
          label="Avg Latency"
          value={stats?.avgLatencyMs ?? 0}
          unit="ms"
        />
        <MetricCard
          label="Total Cost"
          value={`$${(stats?.totalCostUsd ?? 0).toFixed(4)}`}
        />
        <MetricCard
          label="Agents"
          value={agentCount}
        />
      </div>

      {/* Policy Enforcement Summary */}
      {policy && policy.total > 0 && (
        <Card title="Policy Enforcement" subtitle="Request disposition breakdown">
          <div className="flex items-center gap-6">
            <div className="flex-1">
              {/* Stacked bar */}
              <div className="flex h-3 rounded-full overflow-hidden bg-bg-primary">
                {policy.allowed > 0 && (
                  <div
                    className="bg-success"
                    style={{ width: `${(policy.allowed / policy.total) * 100}%` }}
                    title={`${policy.allowed} allowed`}
                  />
                )}
                {policy.blocked > 0 && (
                  <div
                    className="bg-error"
                    style={{ width: `${(policy.blocked / policy.total) * 100}%` }}
                    title={`${policy.blocked} blocked`}
                  />
                )}
                {policy.redacted > 0 && (
                  <div
                    className="bg-info"
                    style={{ width: `${(policy.redacted / policy.total) * 100}%` }}
                    title={`${policy.redacted} redacted`}
                  />
                )}
                {policy.warned > 0 && (
                  <div
                    className="bg-warning"
                    style={{ width: `${(policy.warned / policy.total) * 100}%` }}
                    title={`${policy.warned} warned`}
                  />
                )}
              </div>
            </div>
            <div className="flex gap-4 text-xs flex-shrink-0">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-success" />
                <span className="text-text-secondary">{policy.allowed}</span>
                <span className="text-text-muted">allowed</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-error" />
                <span className="text-text-secondary">{policy.blocked}</span>
                <span className="text-text-muted">blocked</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-info" />
                <span className="text-text-secondary">{policy.redacted}</span>
                <span className="text-text-muted">redacted</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-warning" />
                <span className="text-text-secondary">{policy.warned}</span>
                <span className="text-text-muted">warned</span>
              </span>
            </div>
          </div>
        </Card>
      )}

      {/* Quick Start */}
      {status?.proxy.providers.length === 0 && (
        <Card title="Get Started" subtitle="Connect your first AI provider">
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              Edit your configuration to add a provider, or use the proxy config
              page.
            </p>
            <div className="flex gap-2">
              <a
                href="/proxy"
                className="px-3 py-1.5 bg-rivano-500 hover:bg-rivano-600 text-white text-sm rounded-md transition-colors"
              >
                Configure Proxy
              </a>
              <a
                href="/settings"
                className="px-3 py-1.5 bg-bg-hover text-text-secondary hover:text-text-primary text-sm rounded-md border border-border transition-colors"
              >
                Settings
              </a>
            </div>
          </div>
        </Card>
      )}

      {/* Connection Snippets */}
      <Card
        title="Connect Your App"
        subtitle="Point your AI SDK at the Rivano proxy"
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-text-muted mb-1.5">TypeScript</p>
            <pre className="bg-bg-primary rounded-md p-3 text-xs text-text-secondary font-mono overflow-x-auto">
{`import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "http://localhost:4000/v1",
});`}
            </pre>
          </div>
          <div>
            <p className="text-xs text-text-muted mb-1.5">Python</p>
            <pre className="bg-bg-primary rounded-md p-3 text-xs text-text-secondary font-mono overflow-x-auto">
{`from anthropic import Anthropic

client = Anthropic(
    base_url="http://localhost:4000/v1"
)`}
            </pre>
          </div>
        </div>
      </Card>
    </div>
  );
}
