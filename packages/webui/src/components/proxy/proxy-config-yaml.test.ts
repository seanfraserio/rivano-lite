import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractKeysFromYaml, mergePoliciesIntoYaml, mergeProvidersIntoYaml } from "./proxy-config-yaml";

const DEFAULT_YAML = readFileSync(join(import.meta.dir, "../../../../../config/defaults/rivano.yaml"), "utf8");

describe("proxy-config-yaml", () => {
  test("extractKeysFromYaml returns real provider keys from raw yaml", () => {
    const yaml = `version: "1"

providers:
  anthropic:
    api_key: "sk-ant-123"
  openai:
    api_key: \${OPENAI_API_KEY}

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
`;

    expect(extractKeysFromYaml(yaml)).toEqual({
      anthropic: "sk-ant-123",
      openai: "${OPENAI_API_KEY}",
    });
  });

  test("mergeProvidersIntoYaml removes providers while preserving proxy and observer blocks", () => {
    const merged = mergeProvidersIntoYaml(DEFAULT_YAML, []);

    expect(merged).toContain("providers: {}");
    expect(merged).toContain("proxy:");
    expect(merged).toContain("observer:");
    expect(merged).toContain("agents: []");
    expect(merged).not.toContain('base_url: "http://host.docker.internal:11434"');
  });

  test("mergePoliciesIntoYaml replaces proxy policies without dropping later sections", () => {
    const merged = mergePoliciesIntoYaml(DEFAULT_YAML, [
      {
        name: "block-ssn",
        phase: "request",
        condition: '{"contains":"SSN"}',
        action: "block",
        description: "Block SSN leakage",
      },
    ]);

    expect(merged).toContain("  policies:");
    expect(merged).toContain("    - name: block-ssn");
    expect(merged).toContain('      message: "Block SSN leakage"');
    expect(merged).toContain("observer:");
    expect(merged).toContain("agents: []");
  });

  test("mergePoliciesIntoYaml supports empty policies array for delete-all flow", () => {
    const merged = mergePoliciesIntoYaml(DEFAULT_YAML, []);

    expect(merged).toContain("  policies: []");
    expect(merged).toContain("observer:");
    expect(merged).toContain("agents: []");
  });
});
