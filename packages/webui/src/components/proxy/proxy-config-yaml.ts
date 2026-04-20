export interface ProxyConfigYamlProvider {
  name: string;
  base_url?: string;
  api_key?: string;
  models?: string[];
}

export interface ProxyConfigYamlPolicy {
  name: string;
  phase: "request" | "response";
  condition: string;
  action: "block" | "warn" | "redact" | "tag";
  description?: string;
}

function yamlScalar(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

export function mergeProvidersIntoYaml(rawYaml: string, providers: ProxyConfigYamlProvider[]): string {
  const lines = rawYaml.split("\n");
  const result: string[] = [];
  let skipUntilNextTopLevel = false;

  for (const line of lines) {
    if (!skipUntilNextTopLevel && /^providers\s*:/.test(line)) {
      skipUntilNextTopLevel = true;
      continue;
    }
    if (skipUntilNextTopLevel) {
      if (line.trim().length > 0 && !/^\s/.test(line)) {
        skipUntilNextTopLevel = false;
        result.push(line);
      }
      continue;
    }
    result.push(line);
  }

  while (result.length > 0 && result[result.length - 1].trim() === "") {
    result.pop();
  }

  const providerLines: string[] = [];
  if (providers.length === 0) {
    providerLines.push("providers: {}");
  } else {
    providerLines.push("providers:");
    for (const p of providers) {
      providerLines.push(`  ${p.name}:`);
      if (p.api_key && !p.api_key.startsWith("****")) {
        providerLines.push(`    api_key: ${yamlScalar(p.api_key)}`);
      }
      if (p.base_url) {
        providerLines.push(`    base_url: ${yamlScalar(p.base_url)}`);
      }
      if (p.models?.length) {
        providerLines.push("    models:");
        for (const m of p.models) {
          providerLines.push(`      - ${m}`);
        }
      }
    }
  }
  providerLines.push("");

  const versionIdx = result.findIndex((line) => /^version\s*:/.test(line));
  const insertAt = versionIdx >= 0 ? versionIdx + 1 : 0;
  let actualInsert = insertAt;
  while (actualInsert < result.length && result[actualInsert].trim() === "") {
    actualInsert++;
  }

  result.splice(actualInsert, 0, ...providerLines);
  return `${result.join("\n")}\n`;
}

export function mergePoliciesIntoYaml(rawYaml: string, policies: ProxyConfigYamlPolicy[]): string {
  const lines = rawYaml.split("\n");
  const result: string[] = [];
  let inProxy = false;
  let skipPolicies = false;
  let policiesIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^proxy\s*:/.test(line)) {
      inProxy = true;
      result.push(line);
      continue;
    }
    if (inProxy && /^\S/.test(line) && line.trim().length > 0) {
      inProxy = false;
    }

    if (inProxy && !skipPolicies && /^\s+policies\s*:/.test(line)) {
      skipPolicies = true;
      policiesIndent = line.search(/\S/);
      continue;
    }

    if (skipPolicies) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const indent = line.search(/\S/);
      if (indent > policiesIndent) {
        continue;
      }
      skipPolicies = false;
    }

    result.push(line);
  }

  let proxyLineIdx = -1;
  let nextTopLevelAfterProxy = result.length;
  for (let i = 0; i < result.length; i++) {
    if (/^proxy\s*:/.test(result[i])) {
      proxyLineIdx = i;
    } else if (proxyLineIdx >= 0 && /^\S/.test(result[i]) && result[i].trim().length > 0) {
      nextTopLevelAfterProxy = i;
      break;
    }
  }

  const policyLines: string[] = [];
  if (policies.length === 0) {
    policyLines.push("  policies: []");
  } else {
    policyLines.push("  policies:");
    for (const p of policies) {
      policyLines.push(`    - name: ${p.name}`);
      policyLines.push(`      on: ${p.phase}`);
      try {
        const condition = JSON.parse(p.condition) as Record<string, unknown>;
        policyLines.push("      condition:");
        for (const [key, value] of Object.entries(condition)) {
          if (typeof value === "object" && value !== null) {
            policyLines.push(`        ${key}:`);
            for (const [nestedKey, nestedValue] of Object.entries(value)) {
              policyLines.push(`          ${nestedKey}: ${nestedValue}`);
            }
          } else {
            policyLines.push(`        ${key}: ${value}`);
          }
        }
      } catch {
        policyLines.push("      condition: {}");
      }
      policyLines.push(`      action: ${p.action}`);
      if (p.description) {
        policyLines.push(`      message: ${yamlScalar(p.description)}`);
      }
    }
  }

  result.splice(nextTopLevelAfterProxy, 0, ...policyLines);
  return result.join("\n");
}

export function extractKeysFromYaml(rawYaml: string): Record<string, string> {
  const keys: Record<string, string> = {};
  const lines = rawYaml.split("\n");
  let currentProvider = "";
  let inProviders = false;

  for (const line of lines) {
    if (/^providers:/.test(line)) {
      inProviders = true;
      continue;
    }
    if (inProviders && /^\S/.test(line)) {
      inProviders = false;
      continue;
    }
    if (!inProviders) {
      continue;
    }

    const providerMatch = line.match(/^ {2}([^:\s]+):$/);
    if (providerMatch) {
      currentProvider = providerMatch[1];
      continue;
    }

    const keyMatch = line.match(/^ {4}api_key:\s*(.+)/);
    if (keyMatch && currentProvider) {
      keys[currentProvider] = keyMatch[1].replace(/^["']|["']$/g, "");
    }
  }

  return keys;
}
