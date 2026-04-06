import type { ProviderConfig } from "@rivano/core";
import type { ProviderResponse } from "./types.js";
import { filterHeaders, extractHeaders, validateBaseUrl, resolveAndValidateUrl } from "./utils.js";

export function createOpenAIProvider(config: ProviderConfig) {
  const baseUrl = config.base_url ?? "https://api.openai.com";
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
        authorization: `Bearer ${config.api_key ?? ""}`,
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
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    return {
      status: response.status,
      headers: extractHeaders(response),
      body: responseBody,
      tokensIn: responseBody.usage?.prompt_tokens,
      tokensOut: responseBody.usage?.completion_tokens,
    };
  };
}
