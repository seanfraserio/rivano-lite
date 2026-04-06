import { resolve as dnsResolve } from "dns/promises";

const BLOCKED_HEADERS = new Set(["host", "content-length", "x-api-key", "authorization"]);

const ALLOWED_PROTOCOLS = new Set(["https:", "http:"]);

const BLOCKED_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.aws.internal",
  "169.254.169.254",
  "100.100.100.200",
]);

function isPrivateIP(ip: string): boolean {
  // IPv4 private ranges
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("172.")) {
    const second = parseInt(ip.split(".")[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  // Loopback
  if (ip.startsWith("127.")) return true;
  if (ip === "::1" || ip === "0.0.0.0") return true;
  // Link-local
  if (ip.startsWith("169.254.")) return true;
  // IPv6 private
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80")) return true;
  return false;
}

export function validateBaseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid provider base_url: ${url}`);
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Disallowed protocol in base_url: ${parsed.protocol}`);
  }

  if (BLOCKED_HOSTS.has(parsed.hostname)) {
    throw new Error(`Blocked host in base_url: ${parsed.hostname}`);
  }

  // Block direct IP access to private ranges (except localhost for Ollama)
  if (isPrivateIP(parsed.hostname) && parsed.hostname !== "localhost" && !parsed.hostname.startsWith("host.docker.internal")) {
    throw new Error(`Blocked private IP in base_url: ${parsed.hostname}`);
  }
}

export async function resolveAndValidateUrl(url: string): Promise<void> {
  validateBaseUrl(url);

  const parsed = new URL(url);
  const hostname = parsed.hostname;

  // Skip DNS pinning for IPs and known-safe hosts
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return;
  if (hostname === "localhost" || hostname.endsWith(".internal")) return;

  // DNS pinning: resolve the hostname and verify the IP isn't private
  try {
    const addresses = await dnsResolve(hostname);
    for (const addr of addresses) {
      if (isPrivateIP(addr) || BLOCKED_HOSTS.has(addr)) {
        throw new Error(
          `DNS rebinding detected: ${hostname} resolves to blocked IP ${addr}`
        );
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("DNS rebinding")) throw err;
    // DNS resolution failure is not a security issue — let fetch handle it
  }
}

export function filterHeaders(headers: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!BLOCKED_HEADERS.has(key.toLowerCase())) {
      filtered[key] = value;
    }
  }
  return filtered;
}

export function extractHeaders(response: Response): Record<string, string> {
  const result: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}
