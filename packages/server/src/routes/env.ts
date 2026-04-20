import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { ServerState } from "../state.js";
import { DATA_DIR } from "../state.js";
import { withLock } from "../utils/lock.js";

const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/** Env vars that could enable code execution or hijack runtime behavior */
const BLOCKED_ENV_KEYS = new Set([
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_EXTRA_CA_CERTS",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "PATH",
  "HOME",
  "SHELL",
  "USER",
  "LOGNAME",
  "BUN_INSTALL",
  "BUN_CONFIG_VERBOSE",
]);

function readEnvLines(envPath: string): Promise<string[]> {
  return readFile(envPath, "utf-8")
    .then((raw) => raw.split("\n"))
    .catch(() => []);
}

async function writeEnvLines(envPath: string, lines: string[]) {
  const content = `${lines.filter((l) => l.trim()).join("\n")}\n`;
  const tmpPath = `${envPath}.tmp`;
  await writeFile(tmpPath, content, "utf-8");
  await rename(tmpPath, envPath);
}

export function registerEnvRoutes(app: FastifyInstance, state: ServerState) {
  // ── List env keys (masked) ──────────────────────────────────
  app.get("/api/env", async () => {
    const envPath = join(DATA_DIR, ".env");
    try {
      const raw = await readFile(envPath, "utf-8");
      const keys = raw
        .split("\n")
        .filter((l) => l.includes("=") && !l.startsWith("#"))
        .map((l) => {
          const [key, ...rest] = l.split("=");
          const value = rest.join("=");
          const masked = value.length > 4 ? `****${value.slice(-4)}` : "****";
          return { key: key.trim(), masked, hasValue: value.trim().length > 0 };
        });
      return { keys };
    } catch {
      return { keys: [] };
    }
  });

  // ── Update env key ──────────────────────────────────────────
  app.put<{ Body: { key: string; value: string } }>("/api/env", async (request, reply) => {
    try {
      const { key, value } = request.body;
      if (!key || typeof key !== "string") {
        return reply.status(400).send({ ok: false, error: "Missing key" });
      }
      if (!ENV_KEY_PATTERN.test(key)) {
        return reply
          .status(400)
          .send({ ok: false, error: "Invalid key: must be UPPER_SNAKE_CASE (e.g., ANTHROPIC_API_KEY)" });
      }
      if (BLOCKED_ENV_KEYS.has(key)) {
        return reply.status(400).send({ ok: false, error: `Blocked: ${key} is a restricted environment variable` });
      }
      if (typeof value !== "string" || value.includes("\n") || value.includes("\r")) {
        return reply.status(400).send({ ok: false, error: "Invalid value: must not contain newlines" });
      }

      return withLock(async () => {
        const envPath = join(DATA_DIR, ".env");
        const lines = await readEnvLines(envPath);

        const existingIdx = lines.findIndex((l) => l.startsWith(`${key}=`));
        const newLine = `${key}=${value}`;
        if (existingIdx >= 0) {
          lines[existingIdx] = newLine;
        } else {
          lines.push(newLine);
        }

        await writeEnvLines(envPath, lines);
        process.env[key] = value;
        state.bufferLog("info", `Environment variable ${key} updated`);
        return { ok: true };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      state.bufferLog("error", `Env update failed: ${message}`);
      return reply.status(500).send({ ok: false, error: "Failed to save environment variable" });
    }
  });

  // ── Delete env key ──────────────────────────────────────────
  app.delete<{ Params: { key: string } }>("/api/env/:key", async (request, reply) => {
    try {
      const { key } = request.params;
      if (!key || typeof key !== "string" || !ENV_KEY_PATTERN.test(key)) {
        return reply.status(400).send({ ok: false, error: "Invalid key" });
      }

      return withLock(async () => {
        const envPath = join(DATA_DIR, ".env");
        const lines = await readEnvLines(envPath);
        const filtered = lines.filter((l) => !l.startsWith(`${key}=`));

        if (filtered.length === lines.length) {
          return reply.status(404).send({ ok: false, error: "Key not found" });
        }

        await writeEnvLines(envPath, filtered);
        delete process.env[key];
        state.bufferLog("info", `Environment variable ${key} removed`);
        return { ok: true };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      state.bufferLog("error", `Env delete failed: ${message}`);
      return reply.status(500).send({ ok: false, error: "Failed to remove environment variable" });
    }
  });
}
