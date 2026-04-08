import type { AgentConfig } from "@rivano/core";
import type { Storage } from "@rivano/observer";
import type { FastifyInstance } from "fastify";

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

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