import { timingSafeEqual } from "node:crypto";
import { getApiKey } from "./state.js";

export function getApiKeyWarnings(): string[] {
  const apiKey = getApiKey();
  if (!apiKey) {
    return [
      "[rivano] WARNING: No RIVANO_API_KEY set — API endpoints are unauthenticated!",
      "[rivano] Set RIVANO_API_KEY environment variable to secure the API.",
    ];
  }
  if (apiKey.length < 16) {
    return [
      `[rivano] WARNING: RIVANO_API_KEY is only ${apiKey.length} characters — consider using a longer key (≥16 chars) for security.`,
    ];
  }
  return [];
}

export function isAuthenticated(authHeader: string | undefined): boolean {
  const apiKey = getApiKey();
  if (!apiKey) return true;
  if (!authHeader) return false;

  const expected = `Bearer ${apiKey}`;
  if (authHeader.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
}
