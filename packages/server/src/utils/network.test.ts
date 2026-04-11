import { afterEach, describe, expect, test } from "bun:test";
import { getBindHost } from "./network";

const originalBindHost = process.env.RIVANO_BIND_HOST;

afterEach(() => {
  if (originalBindHost === undefined) {
    delete process.env.RIVANO_BIND_HOST;
    return;
  }
  process.env.RIVANO_BIND_HOST = originalBindHost;
});

describe("getBindHost", () => {
  test("defaults to 0.0.0.0 for container-reachable services", () => {
    delete process.env.RIVANO_BIND_HOST;

    expect(getBindHost()).toBe("0.0.0.0");
  });

  test("allows overriding bind host via env", () => {
    process.env.RIVANO_BIND_HOST = "127.0.0.1";

    expect(getBindHost()).toBe("127.0.0.1");
  });
});
