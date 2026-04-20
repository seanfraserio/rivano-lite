import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { interpolateEnvVars, validateConfig } from "@rivano/core";
import type { FastifyInstance } from "fastify";
import YAML from "js-yaml";
import type { ServerState } from "../state.js";
import { getApiKey, getConfigPath } from "../state.js";
import { withLock } from "../utils/lock.js";

export function sanitizeYamlObj(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeYamlObj);
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    clean[key] = sanitizeYamlObj(value);
  }
  return clean;
}

async function writeConfigAtomically(configPath: string, yaml: string): Promise<void> {
  const tmpPath = `${configPath}.tmp`;
  await writeFile(tmpPath, yaml, "utf-8");
  await rename(tmpPath, configPath);
}

export function registerConfigRoutes(app: FastifyInstance, state: ServerState, reload: () => Promise<void>) {
  // ── Config read (masked) ──────────────────────────────────
  app.get("/api/config", async () => {
    const masked = JSON.parse(JSON.stringify(state.config));
    for (const [, provider] of Object.entries(masked.providers || {})) {
      const p = provider as Record<string, unknown>;
      if (p.api_key && typeof p.api_key === "string") {
        const key = p.api_key as string;
        p.api_key = key.length > 8 ? `${key.slice(0, 4)}****` : "****";
      }
    }
    return masked;
  });

  // ── Config read (raw) — always requires auth, even when API_KEY is not set globally ──
  app.get("/api/config/raw", async (_request, reply) => {
    if (!getApiKey()) {
      return reply.status(401).send({ error: "Set RIVANO_API_KEY environment variable to access raw config" });
    }
    try {
      const raw = await readFile(getConfigPath(), "utf-8");
      return { yaml: raw };
    } catch (_err) {
      // Config file doesn't exist yet — return the in-memory default as YAML
      const defaultYaml = YAML.dump(state.config, { lineWidth: -1, noRefs: true });
      return { yaml: defaultYaml };
    }
  });

  // ── Config write ───────────────────────────────────────────
  app.put<{ Body: { yaml: string } }>("/api/config", async (request, reply) => {
    try {
      const { yaml } = request.body;
      if (!yaml || typeof yaml !== "string") {
        return reply.status(400).send({ ok: false, error: "Missing yaml field" });
      }

      if (yaml.length > 100_000) {
        return reply.status(400).send({ ok: false, error: "Config too large (max 100KB)" });
      }

      const interpolated = interpolateEnvVars(yaml, { strict: true });
      const parsed = sanitizeYamlObj(YAML.load(interpolated, { schema: YAML.JSON_SCHEMA }));
      validateConfig(parsed);

      return await withLock(async () => {
        const configPath = getConfigPath();
        let previousYaml: string | null = null;
        let hadPreviousYaml = false;

        try {
          previousYaml = await readFile(configPath, "utf-8");
          hadPreviousYaml = true;
        } catch {}

        await writeConfigAtomically(configPath, yaml);

        try {
          await reload();
        } catch (reloadError) {
          if (hadPreviousYaml && previousYaml !== null) {
            await writeConfigAtomically(configPath, previousYaml);
          } else {
            await rm(configPath, { force: true });
          }
          throw reloadError;
        }

        state.bufferLog("info", "Config updated via WebUI — services reloaded");
        return { ok: true };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      state.bufferLog("error", `Config update failed: ${message}`);
      return reply.status(400).send({ ok: false, error: `Configuration validation failed: ${message}` });
    }
  });

  // ── Config validate ────────────────────────────────────────
  app.post<{ Body: { yaml: string } }>("/api/config/validate", async (request, reply) => {
    try {
      const { yaml } = request.body;
      if (!yaml || typeof yaml !== "string") {
        return reply.status(400).send({ valid: false, errors: ["Missing yaml field"] });
      }
      const interpolated = interpolateEnvVars(yaml, { strict: true });
      const parsed = sanitizeYamlObj(YAML.load(interpolated, { schema: YAML.JSON_SCHEMA }));
      validateConfig(parsed);
      return { valid: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid config";
      return { valid: false, errors: [message] };
    }
  });
}
