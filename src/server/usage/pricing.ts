import type { TokenUsageRecord } from './types.js';

interface ModelRate {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
}

// Pricing in USD per million tokens
const RATES: Record<string, ModelRate> = {
  // OpenAI
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10, cacheReadPerMillion: 1.25 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6, cacheReadPerMillion: 0.075 },
  'o1': { inputPerMillion: 15, outputPerMillion: 60, cacheReadPerMillion: 7.5 },
  'o1-mini': { inputPerMillion: 3, outputPerMillion: 12, cacheReadPerMillion: 1.5 },
  'o3-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4, cacheReadPerMillion: 0.55 },
  // Anthropic Claude
  'claude-3-5-sonnet': { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
  'claude-3-5-haiku': { inputPerMillion: 0.8, outputPerMillion: 4.0, cacheReadPerMillion: 0.08, cacheWritePerMillion: 1.0 },
  'claude-3-7-sonnet': { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
  // Google Gemini
  'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5.0, cacheReadPerMillion: 0.3125 },
  'gemini-2.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.3, cacheReadPerMillion: 0.01875 },
  'gemini-3.8-flash': { inputPerMillion: 0.1, outputPerMillion: 0.4, cacheReadPerMillion: 0.025 },
  'gemini-3.8-pro': { inputPerMillion: 1.5, outputPerMillion: 6.0, cacheReadPerMillion: 0.375 },
  // DeepSeek
  'deepseek-chat': { inputPerMillion: 0.14, outputPerMillion: 0.28, cacheReadPerMillion: 0.014 },
  'deepseek-reasoner': { inputPerMillion: 0.55, outputPerMillion: 2.19, cacheReadPerMillion: 0.14 },
};

export function estimateCost(record: TokenUsageRecord): number {
  if (typeof record.estimatedCostUsd === 'number') {
    return record.estimatedCostUsd;
  }

  const modelKey = Object.keys(RATES).find(k => record.model?.toLowerCase().includes(k.toLowerCase()));
  const rate = modelKey ? RATES[modelKey] : { inputPerMillion: 1.0, outputPerMillion: 3.0, cacheReadPerMillion: 0.25 };

  const inputCost = (record.input / 1_000_000) * rate.inputPerMillion;
  const outputCost = (record.output / 1_000_000) * rate.outputPerMillion;
  const cacheReadCost = ((record.cacheRead || 0) / 1_000_000) * (rate.cacheReadPerMillion ?? rate.inputPerMillion * 0.25);
  const cacheWriteCost = ((record.cacheWrite || 0) / 1_000_000) * (rate.cacheWritePerMillion ?? rate.inputPerMillion * 1.25);

  return Number((inputCost + outputCost + cacheReadCost + cacheWriteCost).toFixed(6));
}
