import type { TokenUsageRecord } from './types.js';

interface ModelRate {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
}

const DEFAULT_RATE: ModelRate = {
  inputPerMillion: 1.0,
  outputPerMillion: 3.0,
  cacheReadPerMillion: 0.25,
};

const RATES: Record<string, ModelRate> = {
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6, cacheReadPerMillion: 0.075 },
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10, cacheReadPerMillion: 1.25 },
  'gpt-4.1-mini': { inputPerMillion: 0.4, outputPerMillion: 1.6, cacheReadPerMillion: 0.1 },
  'gpt-4.1': { inputPerMillion: 2.0, outputPerMillion: 8.0, cacheReadPerMillion: 0.5 },
  'gpt-5': { inputPerMillion: 1.25, outputPerMillion: 10, cacheReadPerMillion: 0.125 },
  'o1-mini': { inputPerMillion: 3, outputPerMillion: 12, cacheReadPerMillion: 1.5 },
  'o1': { inputPerMillion: 15, outputPerMillion: 60, cacheReadPerMillion: 7.5 },
  'o3-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4, cacheReadPerMillion: 0.55 },
  'o3': { inputPerMillion: 2, outputPerMillion: 8, cacheReadPerMillion: 0.5 },
  'o4-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4, cacheReadPerMillion: 0.275 },
  'claude-3-5-haiku': { inputPerMillion: 0.8, outputPerMillion: 4.0, cacheReadPerMillion: 0.08, cacheWritePerMillion: 1.0 },
  'claude-haiku-4': { inputPerMillion: 0.8, outputPerMillion: 4.0, cacheReadPerMillion: 0.08, cacheWritePerMillion: 1.0 },
  'claude-3-5-sonnet': { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
  'claude-3-7-sonnet': { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
  'claude-sonnet-4': { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
  'claude-opus-4': { inputPerMillion: 15.0, outputPerMillion: 75.0, cacheReadPerMillion: 1.5, cacheWritePerMillion: 18.75 },
  'gemini-2.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.3, cacheReadPerMillion: 0.01875 },
  'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5.0, cacheReadPerMillion: 0.3125 },
  'gemini-3.8-flash': { inputPerMillion: 0.1, outputPerMillion: 0.4, cacheReadPerMillion: 0.025 },
  'gemini-3.8-pro': { inputPerMillion: 1.5, outputPerMillion: 6.0, cacheReadPerMillion: 0.375 },
  'deepseek-chat': { inputPerMillion: 0.14, outputPerMillion: 0.28, cacheReadPerMillion: 0.014 },
  'deepseek-reasoner': { inputPerMillion: 0.55, outputPerMillion: 2.19, cacheReadPerMillion: 0.14 },
  'grok-3': { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.75 },
  'grok-4': { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.75 },
};

const RATE_ENTRIES = Object.entries(RATES).sort((a, b) => b[0].length - a[0].length);

function resolveRate(model: string | undefined): ModelRate {
  const normalized = (model || '').toLowerCase();
  if (!normalized) return DEFAULT_RATE;

  for (const [key, rate] of RATE_ENTRIES) {
    if (normalized.includes(key)) return rate;
  }

  if (normalized.includes('opus')) return RATES['claude-opus-4'];
  if (normalized.includes('sonnet')) return RATES['claude-sonnet-4'];
  if (normalized.includes('haiku')) return RATES['claude-3-5-haiku'];
  if (normalized.includes('flash')) return RATES['gemini-2.5-flash'];
  if (normalized.includes('gemini') || normalized.includes('pro')) return RATES['gemini-2.5-pro'];
  if (normalized.includes('mini')) return RATES['gpt-4o-mini'];
  if (normalized.includes('grok')) return RATES['grok-4'];
  return DEFAULT_RATE;
}

export function estimateCost(record: TokenUsageRecord): number {
  if (typeof record.estimatedCostUsd === 'number' && record.estimatedCostUsd > 0) {
    return record.estimatedCostUsd;
  }

  const rate = resolveRate(record.model);
  const inputCost = ((record.input || 0) / 1_000_000) * rate.inputPerMillion;
  const outputCost = ((record.output || 0) / 1_000_000) * rate.outputPerMillion;
  const cacheReadCost = ((record.cacheRead || 0) / 1_000_000) * (rate.cacheReadPerMillion ?? rate.inputPerMillion * 0.25);
  const cacheWriteCost = ((record.cacheWrite || 0) / 1_000_000) * (rate.cacheWritePerMillion ?? rate.inputPerMillion * 1.25);

  return Number((inputCost + outputCost + cacheReadCost + cacheWriteCost).toFixed(6));
}
