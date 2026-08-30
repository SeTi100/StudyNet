/**
 * Utility zur Berechnung der geschätzten Token-Kosten für Google Gemini Modelle.
 * Preise in USD pro 1.000.000 Tokens (Stand 2025/2026).
 */

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const GEMINI_PRICING: Record<string, ModelPricing> = {
  // Gemini 1.5 Flash
  'gemini-1.5-flash': {
    inputPerMillion: 0.075,
    outputPerMillion: 0.30,
  },
  'gemini-1.5-flash-8b': {
    inputPerMillion: 0.0375,
    outputPerMillion: 0.15,
  },
  // Gemini 2.0 Flash
  'gemini-2.0-flash': {
    inputPerMillion: 0.10,
    outputPerMillion: 0.40,
  },
  'gemini-2.0-flash-lite': {
    inputPerMillion: 0.075,
    outputPerMillion: 0.30,
  },
  // Gemini 1.5 Pro
  'gemini-1.5-pro': {
    inputPerMillion: 1.25,
    outputPerMillion: 5.00,
  },
  // Default Fallback
  default: {
    inputPerMillion: 0.075,
    outputPerMillion: 0.30,
  },
};

/**
 * Berechnet die geschätzten Kosten in USD basierend auf Gesamt- und Output-Tokens.
 * Nutzt totalTokens um auch gecachte und Thinking-Tokens zu berücksichtigen.
 */
export function calculateEstimatedCostUsd(
  modelName: string = 'gemini-1.5-flash',
  totalTokens: number = 0,
  outputTokens: number = 0
): number {
  const cleanModel = modelName.trim().replace(/^models\//, '').toLowerCase();
  
  // Finde das passende Preismodell (oder Default)
  let pricing = GEMINI_PRICING[cleanModel];
  if (!pricing) {
    if (cleanModel.includes('pro')) {
      pricing = GEMINI_PRICING['gemini-1.5-pro'];
    } else if (cleanModel.includes('8b')) {
      pricing = GEMINI_PRICING['gemini-1.5-flash-8b'];
    } else {
      pricing = GEMINI_PRICING.default;
    }
  }

  const inputTokens = Math.max(0, totalTokens - outputTokens);
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  
  return inputCost + outputCost;
}

/**
 * Formatiert Token-Zahlen lesbar (z.B. 1.2k, 45.8k, 1.2M).
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return tokens.toLocaleString('de-DE');
}

/**
 * Formatiert USD-Kosten in lesbares Format (z.B. "$0.0004" oder "< $0.0001").
 */
export function formatCostUsd(costUsd: number): string {
  if (costUsd === 0) return '$0.00';
  if (costUsd < 0.0001) return '< $0.0001';
  if (costUsd < 0.01) return `$${costUsd.toFixed(4)}`;
  return `$${costUsd.toFixed(3)}`;
}
