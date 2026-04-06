export interface ProviderResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  stream?: ReadableStream;
  tokensIn?: number;
  tokensOut?: number;
}

export type ProviderFn = (
  path: string,
  body: unknown,
  headers: Record<string, string>,
) => Promise<ProviderResponse>;
