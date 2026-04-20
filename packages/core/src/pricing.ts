/**
 * Shared model pricing table - single source of truth for cost estimation.
 * Kept in @rivano/core so both the audit middleware and observer evaluators
 * reference the same data.
 */
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-6": { inputPerMillion: 15, outputPerMillion: 75 },
  "claude-sonnet-4-5": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-haiku-4-5": { inputPerMillion: 0.8, outputPerMillion: 4 },
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "o3-mini": { inputPerMillion: 1.1, outputPerMillion: 4.4 },
};

export const DEFAULT_PRICING: ModelPricing = { inputPerMillion: 1, outputPerMillion: 3 };

export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  return (
    Math.round(
      ((tokensIn / 1_000_000) * p.inputPerMillion + (tokensOut / 1_000_000) * p.outputPerMillion) * 1_000_000,
    ) / 1_000_000
  );
}
