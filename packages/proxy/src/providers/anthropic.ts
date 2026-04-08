import type { ProviderConfig } from "@rivano/core";
import type { ProviderResponse } from "./types.js";
import { filterHeaders, extractHeaders, validateBaseUrl, resolveAndValidateUrl } from "./utils.js";

const PROVIDER_TIMEOUT_MS = 30_000; // 30 second default timeout

export function createAnthropicProvider(config: ProviderConfig) {
  const baseUrl = config.base_url ?? "https://api.anthropic.com";
  validateBaseUrl(baseUrl);

  return async (
    path: string,
    body: unknown,
    headers: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<ProviderResponse> => {
    await resolveAndValidateUrl(baseUrl);

    const requestBody = body as { stream?: boolean };
    const isStreaming = requestBody?.stream === true;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    // Combine external signal with our timeout
    if (signal) {
      signal.addEventListener("abort", () => controller.abort());
    }

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": config.api_key ?? "",
          "anthropic-version": "2023-06-01",
          ...filterHeaders(headers),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (isStreaming && response.body) {
        return {
          status: response.status,
          headers: extractHeaders(response),
          body: null,
          stream: response.body,
        };
      }

      const responseBody = (await response.json()) as {
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      return {
        status: response.status,
        headers: extractHeaders(response),
        body: responseBody,
        tokensIn: responseBody.usage?.input_tokens,
        tokensOut: responseBody.usage?.output_tokens,
      };
    } finally {
      clearTimeout(timeout);
    }
  };
}