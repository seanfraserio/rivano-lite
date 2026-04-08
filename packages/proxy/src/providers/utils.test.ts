import { describe, expect, test } from "bun:test";
import { validateBaseUrl, filterHeaders, extractHeaders } from "./utils.js";

describe("validateBaseUrl", () => {
  test("accepts valid HTTPS URLs", () => {
    expect(() => validateBaseUrl("https://api.openai.com/v1")).not.toThrow();
  });

  test("accepts valid HTTP URLs", () => {
    expect(() => validateBaseUrl("http://localhost:11434")).not.toThrow();
  });

  test("rejects invalid URLs", () => {
    expect(() => validateBaseUrl("not-a-url")).toThrow(/Invalid provider base_url/);
  });

  test("rejects disallowed protocols (ftp)", () => {
    expect(() => validateBaseUrl("ftp://example.com")).toThrow(/Disallowed protocol/);
  });

  test("rejects blocked metadata hosts", () => {
    expect(() => validateBaseUrl("http://metadata.google.internal")).toThrow(/Blocked host/);
    // 169.254.169.254 is in BLOCKED_HOSTS, so it throws "Blocked host" (checked before private IP)
    expect(() => validateBaseUrl("http://169.254.169.254")).toThrow(/Blocked/);
    expect(() => validateBaseUrl("http://metadata.aws.internal")).toThrow(/Blocked host/);
  });

  test("rejects private IPv4 ranges (10.x, 172.16-31.x, 192.168.x, 127.x)", () => {
    expect(() => validateBaseUrl("https://10.0.0.1")).toThrow(/Blocked private IP/);
    expect(() => validateBaseUrl("https://172.16.0.1")).toThrow(/Blocked private IP/);
    expect(() => validateBaseUrl("https://192.168.1.1")).toThrow(/Blocked private IP/);
    expect(() => validateBaseUrl("https://127.0.0.1")).toThrow(/Blocked private IP/);
  });

  test("accepts localhost for local development", () => {
    expect(() => validateBaseUrl("http://localhost:11434")).not.toThrow();
  });

  test("rejects 0.0.0.0", () => {
    expect(() => validateBaseUrl("http://0.0.0.0")).toThrow(/Blocked private IP/);
  });

  test("accepts public IPs", () => {
    expect(() => validateBaseUrl("https://1.1.1.1")).not.toThrow();
  });
});

describe("filterHeaders", () => {
  test("removes sensitive headers", () => {
    const headers = {
      "content-type": "application/json",
      "authorization": "Bearer sk-test",
      "x-api-key": "sk-test",
      "host": "api.openai.com",
      "content-length": "100",
      "accept": "application/json",
    };
    const filtered = filterHeaders(headers);
    expect(filtered["authorization"]).toBeUndefined();
    expect(filtered["x-api-key"]).toBeUndefined();
    expect(filtered["host"]).toBeUndefined();
    expect(filtered["content-length"]).toBeUndefined();
    expect(filtered["content-type"]).toBe("application/json");
    expect(filtered["accept"]).toBe("application/json");
  });

  test("preserves safe headers", () => {
    const headers = {
      "content-type": "application/json",
      "accept": "application/json",
      "x-request-id": "abc123",
    };
    const filtered = filterHeaders(headers);
    expect(Object.keys(filtered)).toHaveLength(3);
  });

  test("handles case-insensitive header matching", () => {
    const headers = {
      "Authorization": "Bearer test",
      "X-API-Key": "key123",
    };
    const filtered = filterHeaders(headers);
    expect(filtered["Authorization"]).toBeUndefined();
    expect(filtered["X-API-Key"]).toBeUndefined();
  });

  test("handles empty headers", () => {
    expect(filterHeaders({})).toEqual({});
  });
});

describe("extractHeaders", () => {
  test("extracts headers from a Response object", () => {
    const response = new Response(null, {
      headers: { "content-type": "application/json", "x-request-id": "abc" },
    });
    const headers = extractHeaders(response);
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-request-id"]).toBe("abc");
  });
});