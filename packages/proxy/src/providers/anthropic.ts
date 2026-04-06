import type { ProviderConfig } from "@rivano/core";
import type { ProviderResponse } from "./types.js";
import { filterHeaders, extractHeaders, validateBaseUrl, resolveAndValidateUrl } from "./utils.js";

export function createAnthropicProvider(config: ProviderConfig) {
  const baseUrl = config.base_url ?? "https://api.anthropic.com";
  validateBaseUrl(baseUrl);

  let dnsValidated = false;
  return async (
    path: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<ProviderResponse> => {
    if (!dnsValidated) {
      await resolveAndValidateUrl(baseUrl);
      dnsValidated = true;
    }

    const requestBody = body as { stream?: boolean };
    const isStreaming = requestBody?.stream === true;

    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.api_key ?? "",
        "anthropic-version": "2023-06-01",
        ...filterHeaders(headers),
      },
      body: JSON.stringify(body),
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
  };
}
