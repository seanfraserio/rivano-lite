export interface InjectionSignal {
  name: string;
  weight: number;
  matched: boolean;
}

const INJECTION_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  weight: number;
}> = [
  {
    name: "ignore_previous",
    pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|context)/i,
    weight: 0.9,
  },
  {
    name: "system_prompt_extract",
    pattern: /(?:reveal|show|print|output|repeat)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions)/i,
    weight: 0.85,
  },
  {
    name: "role_hijacking",
    pattern: /you\s+are\s+now\s+(?:a|an|the)\s+/i,
    weight: 0.8,
  },
  {
    name: "jailbreak_prefix",
    pattern: /(?:DAN|DUDE|AIM|STAN)\s*(?:mode|prompt|=|:)/i,
    weight: 0.9,
  },
  {
    name: "encoding_trick",
    pattern: /(?:base64|rot13|hex)\s*(?:decode|encode|translate)/i,
    weight: 0.7,
  },
  {
    name: "delimiter_injection",
    pattern: /(?:```|<\/?system>|<\/?user>|<\/?assistant>|\[INST\]|\[\/INST\])/i,
    weight: 0.75,
  },
  {
    name: "instruction_override",
    pattern: /(?:new\s+instructions?|override\s+(?:the\s+)?(?:previous|prior|system))/i,
    weight: 0.85,
  },
  {
    name: "prompt_leak",
    pattern: /(?:what\s+(?:is|are)\s+your\s+(?:system\s+)?(?:instructions|rules|guidelines|prompt))/i,
    weight: 0.6,
  },
  {
    name: "disregard_directive",
    pattern:
      /(?:disregard|forget|ignore)\s+(?:all\s+)?(?:previous|prior|above|earlier)\s*(?:instructions|rules|context|directives)?/i,
    weight: 0.85,
  },
  {
    name: "pretend_persona",
    pattern: /(?:pretend|act\s+as|roleplay|imagine)\s+you.{0,20}(?:are|were|have\s+become)/i,
    weight: 0.7,
  },
  {
    name: "output_instruction",
    pattern: /(?:output|print|write|display)\s+(?:the|your|my|system)\s+(?:instructions|prompt|rules|directives)/i,
    weight: 0.8,
  },
];

export function scoreInjection(text: string): {
  score: number;
  signals: InjectionSignal[];
} {
  let maxWeight = 0;
  let matchedCount = 0;

  const signals: InjectionSignal[] = INJECTION_PATTERNS.map((p) => {
    // Use .test() on a fresh regex to avoid lastIndex issues with /g flag
    const matched = new RegExp(p.pattern.source, p.pattern.flags).test(text.slice(0, 10_000));
    if (matched) {
      maxWeight = Math.max(maxWeight, p.weight);
      matchedCount++;
    }
    return { name: p.name, weight: p.weight, matched };
  });

  // Blended score: weight the single strongest match heavily,
  // with diminishing contributions from additional matches.
  // A single strong match (0.9) → score ~0.85 (exceeds 0.8 threshold).
  // Multiple matches push closer to 1.0.
  const baseScore = matchedCount === 0 ? 0 : maxWeight;
  const bonus = matchedCount > 1 ? Math.min(0.1 * (matchedCount - 1), 0.15) : 0;
  const score = Math.min(1, baseScore + bonus);

  return { score, signals };
}
