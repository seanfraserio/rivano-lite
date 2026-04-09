import type { ProviderConfig } from "@rivano/core";
import type { ProviderResponse, ProviderFn } from "./types.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAIProvider } from "./openai.js";
import { createOllamaProvider } from "./ollama.js";

export type { ProviderResponse, ProviderFn };

// Note: Google/Gemini provider is listed in the WebUI but not yet implemented.
// Users should configure a custom OpenAI-compatible endpoint instead.
const PROVIDER_PATH_MAP: Record<string, string> = {
  "/v1/messages": "anthropic",
  "/v1/chat/completions": "openai",
  "/api/chat": "ollama",
};

export function detectProvider(path: string): string | null {
  // Match against path segments to avoid false prefix matches
  // e.g. /v1/messages-extended should not match /v1/messages
  const normalizedPath = path.split("?")[0].split("#")[0]; // strip query/hash
  for (const [prefix, provider] of Object.entries(PROVIDER_PATH_MAP)) {
    if (normalizedPath === prefix || normalizedPath.startsWith(prefix + "/")) {
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
    case "bedrock":
      throw new Error(
        "AWS Bedrock provider is not yet implemented in Rivano Lite. " +
        "Configure an OpenAI-compatible endpoint or use Rivano Cloud for Bedrock support."
      );
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}
