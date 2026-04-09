import type { AgentConfig } from "@rivano/core";
import type { Storage } from "@rivano/observer";
import type { FastifyInstance } from "fastify";
import { resolve } from "path";

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

// ── Shared constants (computed once from env) ──────────────────
const DATA_DIR = process.env.RIVANO_DATA_DIR || "/data";
const VERSION = "0.1.0";

export { DATA_DIR, VERSION };
export const CONFIG_PATH = process.env.RIVANO_CONFIG || resolve(DATA_DIR, "rivano.yaml");
export const DB_PATH = resolve(DATA_DIR, "traces.db");
export const API_KEY = process.env.RIVANO_API_KEY;

export interface ServerState {
  config: import("@rivano/core").RivanoConfig;
  proxy: FastifyInstance | null;
  observer: FastifyInstance | null;
  storage: Storage | null;
  agents: Map<string, { config: AgentConfig; deployedAt: string }>;
  logBuffer: LogEntry[];
  startedAt: number;
  shuttingDown: boolean;
  bufferLog: (level: LogEntry["level"], message: string) => void;
}