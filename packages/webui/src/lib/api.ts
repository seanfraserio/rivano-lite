const API_BASE = typeof window !== "undefined" ? "" : "http://localhost:9000";

/**
 * Retrieve the API key for authenticating requests.
 * In the browser, this is stored in localStorage after the user enters it.
 * On the server (SSR), it falls back to the environment variable.
 */
function getApiKey(): string | null {
  if (typeof window !== "undefined") {
    return localStorage.getItem("rivano_api_key");
  }
  return process.env.RIVANO_API_KEY ?? null;
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const apiKey = getApiKey();
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  // For PUT/POST with body, merge headers after content-type
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { ...headers, ...(opts?.headers as Record<string, string> | undefined) },
  });

  if (!res.ok) {
    // If we get 401 and have a key, clear it (likely expired/invalid)
    if (res.status === 401 && apiKey) {
      if (typeof window !== "undefined") {
        localStorage.removeItem("rivano_api_key");
      }
    }
    const body = await res.text().catch(() => "");
    throw new Error(`API ${path}: ${res.status} ${res.statusText}${body ? ` — ${body}` : ""}`);
  }

  return res.json();
}

export interface HealthStatus {
  status: string;
  version: string;
  services: {
    proxy: string;
    observer: string;
    agents: number;
  };
}

export interface SystemStatus {
  config: string;
  dataDir: string;
  proxy: {
    port: number;
    providers: string[];
    policies: number;
  };
  observer: {
    port: number;
    storage: string;
    retentionDays: number;
  };
  agents: Array<{
    name: string;
    provider: string;
    model: string;
    deployedAt: string;
  }>;
}

export interface TraceListItem {
  id: string;
  source?: string;
  startTime: number;
  endTime?: number;
  totalCostUsd?: number;
  spans: Array<{
    id: string;
    traceId?: string;
    parentSpanId?: string;
    type: string;
    name: string;
    input?: unknown;
    output?: unknown;
    error?: string;
    startTime: number;
    endTime?: number;
    estimatedCostUsd?: number;
    metadata?: Record<string, unknown>;
  }>;
}

export interface TraceStats {
  totalTraces: number;
  totalSpans: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  tracesPerDay: Record<string, number>;
}

export const api = {
  health: () => apiFetch<HealthStatus>("/health"),
  status: () => apiFetch<SystemStatus>("/api/status"),
  config: () => apiFetch<Record<string, unknown>>("/api/config"),
  configRaw: () => apiFetch<{ yaml: string }>("/api/config/raw"),

  saveConfig: (yaml: string) =>
    apiFetch<{ ok: boolean }>("/api/config", {
      method: "PUT",
      body: JSON.stringify({ yaml }),
    }),

  validateConfig: (yaml: string) =>
    apiFetch<{ valid: boolean; errors?: string[] }>("/api/config/validate", {
      method: "POST",
      body: JSON.stringify({ yaml }),
    }),

  traces: (params?: { limit?: number; offset?: number; source?: string }) => {
    const query = new URLSearchParams();
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));
    if (params?.source) query.set("source", params.source);
    return apiFetch<{ traces: TraceListItem[]; total: number }>(
      `/api/traces?${query}`
    );
  },

  trace: (id: string) => apiFetch<TraceListItem>(`/api/traces/${id}`),
  traceStats: () => apiFetch<TraceStats>("/api/traces/stats"),

  /** Store the API key in localStorage for future requests */
  setApiKey: (key: string) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("rivano_api_key", key);
    }
  },

  /** Remove the stored API key */
  clearApiKey: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("rivano_api_key");
    }
  },

  /** Check if an API key is stored */
  hasApiKey: (): boolean => {
    if (typeof window !== "undefined") {
      return !!localStorage.getItem("rivano_api_key");
    }
    return false;
  },
};