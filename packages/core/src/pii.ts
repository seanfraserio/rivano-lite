export interface PiiPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
}

export const DEFAULT_PII_PATTERNS: PiiPattern[] = [
  {
    name: "email",
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: "[REDACTED:email]",
  },
  {
    name: "phone",
    pattern: /(\+?1[-.\s]?)?(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g,
    replacement: "[REDACTED:phone]",
  },
  {
    name: "ssn",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[REDACTED:ssn]",
  },
  {
    name: "credit_card",
    pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    replacement: "[REDACTED:credit_card]",
  },
  {
    name: "ip_address",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: "[REDACTED:ip_address]",
  },
  {
    name: "aws_key",
    pattern: /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g,
    replacement: "[REDACTED:aws_key]",
  },
];

export function detectPii(
  text: string,
  patterns: PiiPattern[] = DEFAULT_PII_PATTERNS,
): { found: boolean; matches: Array<{ pattern: string; count: number }> } {
  const matches: Array<{ pattern: string; count: number }> = [];

  for (const p of patterns) {
    const regex = new RegExp(p.pattern.source, p.pattern.flags);
    const hits = text.match(regex);
    if (hits && hits.length > 0) {
      matches.push({ pattern: p.name, count: hits.length });
    }
  }

  return { found: matches.length > 0, matches };
}

export function redactPii(text: string, patterns: PiiPattern[] = DEFAULT_PII_PATTERNS): string {
  let result = text;

  for (const p of patterns) {
    const regex = new RegExp(p.pattern.source, p.pattern.flags);
    result = result.replace(regex, p.replacement);
  }

  return result;
}
