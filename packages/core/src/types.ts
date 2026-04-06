export type Provider = "anthropic" | "openai" | "ollama" | "bedrock";

export type PolicyAction = "block" | "warn" | "redact" | "tag";

export interface PolicyCondition {
  contains?: string;
  regex?: string;
  injection_score?: number | { gt?: number; lt?: number; gte?: number; lte?: number };
  pii_detected?: boolean;
  length_exceeds?: number;
}

export interface Policy {
  name: string;
  on: "request" | "response";
  condition: PolicyCondition;
  action: PolicyAction;
  message?: string;
}

export interface ProxyConfig {
  port: number;
  default_provider: Provider;
  cache: {
    enabled: boolean;
    ttl: number;
  };
  rate_limit: {
    requests_per_minute: number;
    burst?: number;
  };
  policies: Policy[];
}

export interface ProviderConfig {
  api_key?: string;
  base_url?: string;
  models?: string[];
}

export interface ObserverConfig {
  port: number;
  storage: "sqlite";
  retention_days: number;
  evaluators: string[];
}

export interface AgentConfig {
  name: string;
  description?: string;
  model: {
    provider: Provider;
    name: string;
    temperature?: number;
    max_tokens?: number;
  };
  system_prompt: string;
  tools?: string[];
  memory?: boolean;
}

export interface RivanoConfig {
  version: string;
  providers: Record<string, ProviderConfig>;
  proxy: ProxyConfig;
  observer: ObserverConfig;
  agents: AgentConfig[];
}

export type SpanType =
  | "llm_call"
  | "tool_call"
  | "reasoning"
  | "retrieval"
  | "custom";

export interface Span {
  id: string;
  traceId: string;
  parentSpanId?: string;
  type: SpanType;
  name: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  startTime: number;
  endTime?: number;
  estimatedCostUsd?: number;
  metadata?: Record<string, unknown>;
}

export interface Trace {
  id: string;
  spans: Span[];
  startTime: number;
  endTime?: number;
  totalCostUsd?: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

export type PipelineResult = "continue" | "block" | "short-circuit";

export interface PipelineContext {
  id: string;
  provider: Provider;
  model: string;
  agentName?: string;
  messages: unknown[];
  decisions: Array<{
    middleware: string;
    result: PipelineResult;
    reason?: string;
  }>;
  startTime: number;
  metadata: Record<string, unknown>;
}

export interface AuditEntry {
  id: string;
  timestamp: number;
  traceId?: string;
  provider: Provider;
  model: string;
  action: "allowed" | "blocked" | "redacted" | "warned";
  reason?: string;
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
}
