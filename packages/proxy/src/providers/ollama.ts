import type { ProviderConfig } from "@rivano/core";
import type { ProviderResponse } from "./types.js";
import { filterHeaders, extractHeaders, validateBaseUrl, resolveAndValidateUrl } from "./utils.js";

const PROVIDER_TIMEOUT_MS = 30_000; // 30 second default timeout

export function createOllamaProvider(config: ProviderConfig) {
  const baseUrl = config.base_url ?? "http://localhost:11434";
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
      const url = path.startsWith("/api/") ? `${baseUrl}${path}` : `${baseUrl}/api/chat`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
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
        prompt_eval_count?: number;
        eval_count?: number;
      };

      return {
        status: response.status,
        headers: extractHeaders(response),
        body: responseBody,
        tokensIn: responseBody.prompt_eval_count,
        tokensOut: responseBody.eval_count,
      };
    } finally {
      clearTimeout(timeout);
      if (signal) {
        signal.removeEventListener("abort", onExternalAbort);
      }
    }
  };
}