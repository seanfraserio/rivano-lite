import { describe, expect, test } from "bun:test";
import { interpolateEnvVars } from "./config.js";

describe("interpolateEnvVars", () => {
  test("replaces environment variables", () => {
    process.env.TEST_VAR_INTERPOLATE = "hello";
    const result = interpolateEnvVars("prefix_${TEST_VAR_INTERPOLATE}_suffix");
    expect(result).toBe("prefix_hello_suffix");
    delete process.env.TEST_VAR_INTERPOLATE;
  });

  test("replaces multiple env vars in one string", () => {
    process.env.HOST_VAR = "localhost";
    process.env.PORT_VAR = "8080";
    const result = interpolateEnvVars("${HOST_VAR}:${PORT_VAR}");
    expect(result).toBe("localhost:8080");
    delete process.env.HOST_VAR;
    delete process.env.PORT_VAR;
  });

  test("leaves unset env vars as placeholders", () => {
    const result = interpolateEnvVars("key: ${NONEXISTENT_VAR_12345}");
    expect(result).toBe("key: ${NONEXISTENT_VAR_12345}");
  });

  test("warns about missing environment variables (via console.warn)", () => {
    // Clear a known-unset var
    delete process.env.DEFINITELY_NOT_SET_ABC123;
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => warnings.push(args.join(" "));

    interpolateEnvVars("${DEFINITELY_NOT_SET_ABC123}");

    console.warn = originalWarn;
    expect(warnings.some((w) => w.includes("DEFINITELY_NOT_SET_ABC123"))).toBe(true);
  });

  test("leaves plain text untouched", () => {
    const result = interpolateEnvVars("just plain text with no vars");
    expect(result).toBe("just plain text with no vars");
  });

  test("handles empty string", () => {
    expect(interpolateEnvVars("")).toBe("");
  });

  test("trims whitespace in var name", () => {
    process.env.TRIM_VAR = "value";
    const result = interpolateEnvVars("${ TRIM_VAR }");
    expect(result).toBe("value");
    delete process.env.TRIM_VAR;
  });
});
