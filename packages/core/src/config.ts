import { readFile } from "node:fs/promises";
import yaml from "js-yaml";
import { z } from "zod";
import type { RivanoConfig } from "./types.js";

const ProviderSchema = z.enum(["anthropic", "openai", "ollama", "bedrock"]);

const ThresholdSchema = z.object({
  gt: z.number().optional(),
  lt: z.number().optional(),
  gte: z.number().optional(),
  lte: z.number().optional(),
});

const PolicyConditionSchema = z.object({
  contains: z.string().optional(),
  regex: z.string().optional(),
  injection_score: z.union([z.number().min(0).max(1), ThresholdSchema]).optional(),
  pii_detected: z.boolean().optional(),
  length_exceeds: z.number().positive().optional(),
});

const PolicySchema = z.object({
  name: z.string(),
  on: z.enum(["request", "response"]),
  condition: PolicyConditionSchema,
  action: z.enum(["block", "warn", "redact", "tag"]),
  message: z.string().optional(),
});

const ProxyConfigSchema = z.object({
  port: z.number().int().positive(),
  default_provider: ProviderSchema,
  cache: z.object({
    enabled: z.boolean(),
    ttl: z.number().positive(),
  }),
  rate_limit: z.object({
    requests_per_minute: z.number().int().positive(),
    burst: z.number().int().positive().optional(),
  }),
  policies: z.array(PolicySchema),
});

const ProviderConfigSchema = z.object({
  api_key: z.string().optional(),
  base_url: z.string().optional(),
  models: z.array(z.string()).optional(),
});

const ObserverConfigSchema = z.object({
  port: z.number().int().positive(),
  storage: z.literal("sqlite"),
  retention_days: z.number().int().positive(),
  evaluators: z.array(z.string()),
});

const AgentConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  model: z.object({
    provider: ProviderSchema,
    name: z.string(),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().positive().optional(),
  }),
  system_prompt: z.string(),
  tools: z.array(z.string()).optional(),
  memory: z.boolean().optional(),
});

export const RivanoConfigSchema = z.object({
  version: z.string(),
  providers: z.record(z.string(), ProviderConfigSchema),
  proxy: ProxyConfigSchema,
  observer: ObserverConfigSchema,
  agents: z.array(AgentConfigSchema),
});

export interface InterpolateEnvVarsOptions {
  strict?: boolean;
}

export function interpolateEnvVars(text: string, options: InterpolateEnvVarsOptions = {}): string {
  const missing: string[] = [];
  const result = text.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    const trimmed = varName.trim();
    const value = process.env[trimmed];
    if (value === undefined) {
      missing.push(trimmed);
      return match; // Leave the ${VAR} placeholder intact so it's obvious what's missing
    }
    return value;
  });

  if (missing.length > 0) {
    console.warn(
      `[rivano] Warning: Unset environment variables: ${missing.join(", ")}. ` +
        "These were left as placeholders. Providers with unresolved API keys will fail. " +
        "Set these in your .env file or environment.",
    );
  }

  if (options.strict && missing.length > 0) {
    throw new Error(`Unresolved environment variables: ${missing.join(", ")}`);
  }

  return result;
}

export function validateConfig(config: unknown): RivanoConfig {
  return RivanoConfigSchema.parse(config) as RivanoConfig;
}

export async function loadConfig(path: string): Promise<RivanoConfig> {
  const raw = await readFile(path, "utf-8");
  const interpolated = interpolateEnvVars(raw, { strict: true });
  const parsed = yaml.load(interpolated, { schema: yaml.JSON_SCHEMA });
  return validateConfig(parsed);
}
