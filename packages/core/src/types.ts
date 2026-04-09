export type Provider = "anthropic" | "openai" | "ollama" | "bedrock";

export type PolicyAction = "block" | "warn" | "redact" | "tag";

/** Past-tense version of PolicyAction for audit entries describing completed actions */
export type AuditAction = "allowed" | "blocked" | "redacted" | "warned";

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

export interface PipelineMetadata {
  ip?: string;
  path?: string;
  model?: string;
  statusCode?: number;
  errorMessage?: string;
  blockedBy?: string;
  blockReason?: string;
  injectionScore?: number;
  injectionThreshold?: number;
  cacheHit?: boolean;
  cacheKey?: string;
  cacheStats?: { hits: number; misses: number; size: number };
  rateLimitExceeded?: boolean;
  providerResponse?: unknown;
  tokensIn?: number;
  tokensOut?: number;
  redacted?: boolean;
  tags?: string[];
  usage?: { input_tokens: number; output_tokens: number };
  action?: string;
  [key: string]: unknown;
}

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
  metadata?: PipelineMetadata;
}

export interface Trace {
  id: string;
  spans: Span[];
  startTime: number;
  endTime?: number;
  totalCostUsd?: number;
  source?: string;
  metadata?: PipelineMetadata;
}

export type PipelineResult = "continue" | "block" | "short-circuit";

export interface ChatMessage {
  role: string;
  content?: string;
  [key: string]: unknown;
}

export interface PipelineContext {
  id: string;
  provider: Provider;
  model: string;
  agentName?: string;
  messages: ChatMessage[];
  decisions: Array<{ middleware: string; result: PipelineResult; reason?: string }>;
  startTime: number;
  metadata: PipelineMetadata;
}

export interface AuditEntry {
  id: string;
  timestamp: number;
  traceId?: string;
  provider: Provider;
  model: string;
  action: AuditAction;
  reason?: string;
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
}
