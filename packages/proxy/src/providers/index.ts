import type { ProviderConfig } from "@rivano/core";
import type { ProviderResponse, ProviderFn } from "./types.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAIProvider } from "./openai.js";
import { createOllamaProvider } from "./ollama.js";

export type { ProviderResponse, ProviderFn };

const PROVIDER_PATH_MAP: Record<string, string> = {
  "/v1/messages": "anthropic",
  "/v1/chat/completions": "openai",
  "/api/chat": "ollama",
};

export function detectProvider(path: string): string | null {
  for (const [prefix, provider] of Object.entries(PROVIDER_PATH_MAP)) {
    if (path.startsWith(prefix)) {
      return provider;
    }
  }
  return null;
}

export function createProvider(name: string, config: ProviderConfig): ProviderFn {
  switch (name) {
    case "anthropic":
      return createAnthropicProvider(config);
    case "openai":
      return createOpenAIProvider(config);
    case "ollama":
      return createOllamaProvider(config);
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}
