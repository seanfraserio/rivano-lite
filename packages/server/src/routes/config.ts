import type { FastifyInstance } from "fastify";
import { readFile, writeFile, rename } from "fs/promises";
import YAML from "js-yaml";
import { validateConfig } from "@rivano/core";
import { CONFIG_PATH, API_KEY } from "../state.js";
import type { ServerState } from "../state.js";

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

export function registerConfigRoutes(app: FastifyInstance, state: ServerState, reload: () => Promise<void>) {
  // ── Config read (masked) ──────────────────────────────────
  app.get("/api/config", async () => {
    const masked = JSON.parse(JSON.stringify(state.config));
    for (const [, provider] of Object.entries(masked.providers || {})) {
      const p = provider as Record<string, unknown>;
      if (p.api_key && typeof p.api_key === "string") {
        const key = p.api_key as string;
        p.api_key = key.length > 8 ? key.slice(0, 4) + "****" : "****";
      }
    }
    return masked;
  });

  // ── Config read (raw) — requires API key ──────────────────
  app.get("/api/config/raw", async (request, reply) => {
    if (!API_KEY) {
      return reply.status(403).send({ error: "Set RIVANO_API_KEY to access raw config" });
    }
    try {
      const raw = await readFile(CONFIG_PATH, "utf-8");
      return { yaml: raw };
    } catch (err) {
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

      const parsed = sanitizeYamlObj(YAML.load(yaml, { schema: YAML.JSON_SCHEMA }));
      validateConfig(parsed);

      // Write atomically (tmp + rename)
      const tmpPath = CONFIG_PATH + ".tmp";
      await writeFile(tmpPath, yaml, "utf-8");
      await rename(tmpPath, CONFIG_PATH);

      await reload();

      state.bufferLog("info", "Config updated via WebUI — services reloaded");
      return { ok: true };
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
      const parsed = sanitizeYamlObj(YAML.load(yaml, { schema: YAML.JSON_SCHEMA }));
      validateConfig(parsed);
      return { valid: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid config";
      return { valid: false, errors: [message] };
    }
  });
}