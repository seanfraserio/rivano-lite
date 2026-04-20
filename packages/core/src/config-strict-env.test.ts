import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";

describe("loadConfig strict env validation", () => {
  test("rejects config files with unresolved environment variables", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rivano-config-"));
    const path = join(dir, "rivano.yaml");

    await writeFile(
      path,
      `version: "1"

providers:
  anthropic:
    api_key: \${MISSING_ANTHROPIC_KEY}

proxy:
  port: 4000
  default_provider: anthropic
  cache:
    enabled: true
    ttl: 3600
  rate_limit:
    requests_per_minute: 120
  policies: []

observer:
  port: 4100
  storage: sqlite
  retention_days: 30
  evaluators:
    - latency

agents: []
`,
      "utf8",
    );

    await expect(loadConfig(path)).rejects.toThrow(/MISSING_ANTHROPIC_KEY/);
  });
});
