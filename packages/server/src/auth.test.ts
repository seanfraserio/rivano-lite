import { afterEach, describe, expect, test } from "bun:test";
import { getApiKeyWarnings, isAuthenticated } from "./auth";

const ORIGINAL_API_KEY = process.env.RIVANO_API_KEY;

afterEach(() => {
  if (ORIGINAL_API_KEY === undefined) {
    delete process.env.RIVANO_API_KEY;
  } else {
    process.env.RIVANO_API_KEY = ORIGINAL_API_KEY;
  }
});

describe("API auth", () => {
  test("accepts runtime API key rotation without restart", () => {
    process.env.RIVANO_API_KEY = "first-live-key-1234";
    expect(isAuthenticated("Bearer first-live-key-1234")).toBe(true);
    expect(isAuthenticated("Bearer rotated-live-key-5678")).toBe(false);

    process.env.RIVANO_API_KEY = "rotated-live-key-5678";
    expect(isAuthenticated("Bearer first-live-key-1234")).toBe(false);
    expect(isAuthenticated("Bearer rotated-live-key-5678")).toBe(true);
  });

  test("returns startup warnings based on the current API key value", () => {
    delete process.env.RIVANO_API_KEY;
    expect(getApiKeyWarnings()).toEqual([
      "[rivano] WARNING: No RIVANO_API_KEY set — API endpoints are unauthenticated!",
      "[rivano] Set RIVANO_API_KEY environment variable to secure the API.",
    ]);

    process.env.RIVANO_API_KEY = "short-key";
    expect(getApiKeyWarnings()).toEqual([
      "[rivano] WARNING: RIVANO_API_KEY is only 9 characters — consider using a longer key (≥16 chars) for security.",
    ]);
  });
});
