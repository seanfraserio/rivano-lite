import { describe, expect, test } from "bun:test";
import { detectPii, redactPii, DEFAULT_PII_PATTERNS } from "./pii.js";

describe("detectPii", () => {
  test("detects email addresses", () => {
    const result = detectPii("Contact me at user@example.com please");
    expect(result.found).toBe(true);
    expect(result.matches.some((m) => m.pattern === "email")).toBe(true);
  });

  test("detects phone numbers", () => {
    const result = detectPii("Call me at 555-123-4567");
    expect(result.found).toBe(true);
    expect(result.matches.some((m) => m.pattern === "phone")).toBe(true);
  });

  test("detects SSN pattern", () => {
    const result = detectPii("SSN: 123-45-6789");
    expect(result.found).toBe(true);
    expect(result.matches.some((m) => m.pattern === "ssn")).toBe(true);
  });

  test("detects credit card numbers", () => {
    const result = detectPii("Card: 4111222233334444");
    expect(result.found).toBe(true);
    expect(result.matches.some((m) => m.pattern === "credit_card")).toBe(true);
  });

  test("detects IP addresses", () => {
    const result = detectPii("Server at 192.168.1.100 responded");
    expect(result.found).toBe(true);
    expect(result.matches.some((m) => m.pattern === "ip_address")).toBe(true);
  });

  test("detects AWS keys", () => {
    const result = detectPii("Key: AKIAIOSFODNN7EXAMPLE");
    expect(result.found).toBe(true);
    expect(result.matches.some((m) => m.pattern === "aws_key")).toBe(true);
  });

  test("returns no matches for safe text", () => {
    const result = detectPii("Hello world, this is a safe message.");
    expect(result.found).toBe(false);
    expect(result.matches).toHaveLength(0);
  });

  test("detects multiple PII types in one text", () => {
    const result = detectPii("Email: test@test.com, Phone: 555-123-4567, SSN: 123-45-6789");
    expect(result.found).toBe(true);
    expect(result.matches.length).toBeGreaterThanOrEqual(3);
  });

  test("counts multiple occurrences of same pattern", () => {
    const result = detectPii("First: a@b.com, Second: c@d.com");
    const emailMatch = result.matches.find((m) => m.pattern === "email");
    expect(emailMatch?.count).toBeGreaterThanOrEqual(2);
  });

  test("accepts custom patterns", () => {
    const custom = [{ name: "zipcode", pattern: /\b\d{5}\b/g, replacement: "[ZIP]" }];
    const result = detectPii("Zip: 90210", custom);
    expect(result.found).toBe(true);
    expect(result.matches[0].pattern).toBe("zipcode");
  });
});

describe("redactPii", () => {
  test("redacts email addresses", () => {
    const result = redactPii("Contact user@example.com for info");
    expect(result).not.toContain("user@example.com");
    expect(result).toContain("[REDACTED:email]");
  });

  test("redacts SSN", () => {
    const result = redactPii("My SSN is 123-45-6789");
    expect(result).not.toContain("123-45-6789");
    expect(result).toContain("[REDACTED:ssn]");
  });

  test("redacts credit card numbers", () => {
    const result = redactPii("Card: 4111 2222 3333 4444");
    expect(result).toContain("[REDACTED:credit_card]");
  });

  test("does not modify safe text", () => {
    const safe = "This is completely safe text with no PII.";
    expect(redactPii(safe)).toBe(safe);
  });

  test("redacts multiple PII types simultaneously", () => {
    const result = redactPii("Email: a@b.com Phone: 555-123-4567");
    expect(result).toContain("[REDACTED:email]");
    expect(result).toContain("[REDACTED:phone]");
    expect(result).not.toContain("a@b.com");
  });

  test("accepts custom patterns for redaction", () => {
    const custom = [{ name: "zipcode", pattern: /\b\d{5}\b/g, replacement: "[ZIP]" }];
    const result = redactPii("Zip: 90210", custom);
    expect(result).toContain("[ZIP]");
    expect(result).not.toContain("90210");
  });
});

describe("DEFAULT_PII_PATTERNS", () => {
  test("has 6 default PII pattern categories", () => {
    expect(DEFAULT_PII_PATTERNS).toHaveLength(6);
  });

  test("each pattern has name, pattern (RegExp), and replacement", () => {
    for (const p of DEFAULT_PII_PATTERNS) {
      expect(p.name).toBeDefined();
      expect(p.pattern).toBeInstanceOf(RegExp);
      expect(typeof p.replacement).toBe("string");
    }
  });
});