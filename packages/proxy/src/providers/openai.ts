import type { ProviderConfig } from "@rivano/core";
import type { ProviderResponse } from "./types.js";
import { extractHeaders, filterHeaders, resolveAndValidateUrl, validateBaseUrl } from "./utils.js";

const PROVIDER_TIMEOUT_MS = 30_000; // 30 second default timeout

export function createOpenAIProvider(config: ProviderConfig) {
  const baseUrl = config.base_url ?? "https://api.openai.com";
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
    // Forward external abort signal to our controller
    const onExternalAbort = () => controller.abort();
    if (signal) {
      signal.addEventListener("abort", onExternalAbort);
    }

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.api_key ?? ""}`,
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
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      return {
        status: response.status,
        headers: extractHeaders(response),
        body: responseBody,
        tokensIn: responseBody.usage?.prompt_tokens,
        tokensOut: responseBody.usage?.completion_tokens,
      };
    } finally {
      clearTimeout(timeout);
      if (signal) {
        signal.removeEventListener("abort", onExternalAbort);
      }
    }
  };
}
