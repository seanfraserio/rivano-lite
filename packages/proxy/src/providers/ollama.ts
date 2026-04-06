import type { ProviderConfig } from "@rivano/core";
import type { ProviderResponse } from "./types.js";
import { filterHeaders, extractHeaders, validateBaseUrl, resolveAndValidateUrl } from "./utils.js";

export function createOllamaProvider(config: ProviderConfig) {
  const baseUrl = config.base_url ?? "http://localhost:11434";
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

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
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
  };
}
