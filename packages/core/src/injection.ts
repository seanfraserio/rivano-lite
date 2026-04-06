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
];

export function scoreInjection(text: string): {
  score: number;
  signals: InjectionSignal[];
} {
  const totalWeight = INJECTION_PATTERNS.reduce((sum, p) => sum + p.weight, 0);
  let matchedWeight = 0;

  const signals: InjectionSignal[] = INJECTION_PATTERNS.map((p) => {
    const matched = p.pattern.test(text);
    if (matched) {
      matchedWeight += p.weight;
    }
    return { name: p.name, weight: p.weight, matched };
  });

  const score = Math.min(1, Math.max(0, matchedWeight / totalWeight));

  return { score, signals };
}
