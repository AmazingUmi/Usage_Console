import type { TokenUsageRecord } from './types.js';

export interface ModelRate {
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

/**
 * Keys are canonicalized (lowercase, parentheticals stripped, non-alphanumerics collapsed to `-`)
 * so UI labels like `Gemini 4 Argon (High)`, dotted IDs like `gemini-3.8-flash`, and hyphenated
 * API slugs like `claude-sonnet-5-5-20260901` all match the same entry.
 */
const RATES: Record<string, ModelRate> = {
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6, cacheReadPerMillion: 0.075 },
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10, cacheReadPerMillion: 1.25 },
  'gpt-4-1-nano': { inputPerMillion: 0.1, outputPerMillion: 0.4, cacheReadPerMillion: 0.025 },
  'gpt-4-1-mini': { inputPerMillion: 0.4, outputPerMillion: 1.6, cacheReadPerMillion: 0.1 },
  'gpt-4-1': { inputPerMillion: 2.0, outputPerMillion: 8.0, cacheReadPerMillion: 0.5 },
  'gpt-5-mini': { inputPerMillion: 0.25, outputPerMillion: 2.0, cacheReadPerMillion: 0.025 },
  'gpt-5': { inputPerMillion: 1.25, outputPerMillion: 10, cacheReadPerMillion: 0.125 },
  'gpt-oss-120b': { inputPerMillion: 0.15, outputPerMillion: 0.6, cacheReadPerMillion: 0.075 },
  'gpt-oss': { inputPerMillion: 0.15, outputPerMillion: 0.6, cacheReadPerMillion: 0.075 },
  'o1-mini': { inputPerMillion: 3, outputPerMillion: 12, cacheReadPerMillion: 1.5 },
  'o1': { inputPerMillion: 15, outputPerMillion: 60, cacheReadPerMillion: 7.5 },
  'o3-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4, cacheReadPerMillion: 0.55 },
  'o3': { inputPerMillion: 2, outputPerMillion: 8, cacheReadPerMillion: 0.5 },
  'o4-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4, cacheReadPerMillion: 0.275 },
  'claude-3-5-haiku': { inputPerMillion: 0.8, outputPerMillion: 4.0, cacheReadPerMillion: 0.08, cacheWritePerMillion: 1.0 },
  'claude-haiku-4-5': { inputPerMillion: 1.0, outputPerMillion: 5.0, cacheReadPerMillion: 0.1, cacheWritePerMillion: 1.25 },
  'claude-haiku-4': { inputPerMillion: 0.8, outputPerMillion: 4.0, cacheReadPerMillion: 0.08, cacheWritePerMillion: 1.0 },
  'claude-3-5-sonnet': { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
  'claude-3-7-sonnet': { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
  'claude-sonnet-4-6': { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
  'claude-sonnet-4-5': { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
  'claude-sonnet-4': { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
  'claude-sonnet-5-5': { inputPerMillion: 2.0, outputPerMillion: 10.0, cacheReadPerMillion: 0.1, cacheWritePerMillion: 2.5 },
  'claude-sonnet-5': { inputPerMillion: 2.0, outputPerMillion: 10.0, cacheReadPerMillion: 0.1, cacheWritePerMillion: 2.5 },
  'claude-opus-4-6': { inputPerMillion: 5.0, outputPerMillion: 25.0, cacheReadPerMillion: 0.5, cacheWritePerMillion: 6.25 },
  'claude-opus-4-5': { inputPerMillion: 5.0, outputPerMillion: 25.0, cacheReadPerMillion: 0.5, cacheWritePerMillion: 6.25 },
  'claude-opus-4': { inputPerMillion: 15.0, outputPerMillion: 75.0, cacheReadPerMillion: 1.5, cacheWritePerMillion: 18.75 },
  'claude-opus-5-5': { inputPerMillion: 4.0, outputPerMillion: 20.0, cacheReadPerMillion: 0.2, cacheWritePerMillion: 5.0 },
  'claude-opus-5': { inputPerMillion: 4.0, outputPerMillion: 20.0, cacheReadPerMillion: 0.2, cacheWritePerMillion: 5.0 },
  'gemini-4-argon': { inputPerMillion: 2.0, outputPerMillion: 10.0, cacheReadPerMillion: 0.1 },
  'gemini-3-8-flash': { inputPerMillion: 0.75, outputPerMillion: 3.75, cacheReadPerMillion: 0.075 },
  'gemini-3-8-pro': { inputPerMillion: 2.0, outputPerMillion: 12.0, cacheReadPerMillion: 0.2 },
  'gemini-3-7-flash': { inputPerMillion: 0.5, outputPerMillion: 3.0, cacheReadPerMillion: 0.05 },
  'gemini-3-6-flash': { inputPerMillion: 0.5, outputPerMillion: 3.0, cacheReadPerMillion: 0.05 },
  'gemini-3-5-flash-lite': { inputPerMillion: 0.25, outputPerMillion: 1.5, cacheReadPerMillion: 0.025 },
  'gemini-3-1-flash-lite': { inputPerMillion: 0.25, outputPerMillion: 1.5, cacheReadPerMillion: 0.025 },
  'gemini-3-1-pro': { inputPerMillion: 2.0, outputPerMillion: 12.0, cacheReadPerMillion: 0.2 },
  'gemini-3-flash': { inputPerMillion: 0.5, outputPerMillion: 3.0, cacheReadPerMillion: 0.05 },
  'gemini-3-pro': { inputPerMillion: 2.0, outputPerMillion: 12.0, cacheReadPerMillion: 0.2 },
  'gemini-2-5-flash-lite': { inputPerMillion: 0.1, outputPerMillion: 0.4, cacheReadPerMillion: 0.01 },
  'gemini-2-5-flash': { inputPerMillion: 0.3, outputPerMillion: 2.5, cacheReadPerMillion: 0.03 },
  'gemini-2-5-pro': { inputPerMillion: 1.25, outputPerMillion: 10.0, cacheReadPerMillion: 0.125 },
  'gemini-2-0-flash': { inputPerMillion: 0.1, outputPerMillion: 0.4, cacheReadPerMillion: 0.025 },
  'gemini-flash-lite': { inputPerMillion: 0.25, outputPerMillion: 1.5, cacheReadPerMillion: 0.025 },
  'gemini-flash': { inputPerMillion: 0.75, outputPerMillion: 3.75, cacheReadPerMillion: 0.075 },
  'gemini-pro': { inputPerMillion: 2.0, outputPerMillion: 12.0, cacheReadPerMillion: 0.2 },
  'deepseek-chat': { inputPerMillion: 0.14, outputPerMillion: 0.28, cacheReadPerMillion: 0.014 },
  'deepseek-reasoner': { inputPerMillion: 0.55, outputPerMillion: 2.19, cacheReadPerMillion: 0.14 },
  'grok-3': { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.75 },
  'grok-4': { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.75 },
};

const RATE_ENTRIES = Object.entries(RATES)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([key, rate]) => ({
    key,
    rate,
    segmentRe: new RegExp(`(^|-)${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(-|$)`),
  }));

function canonicalModelKey(model: string | undefined): string {
  return (model || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function resolveModelRate(model: string | undefined): ModelRate {
  const normalized = canonicalModelKey(model);
  if (!normalized) return DEFAULT_RATE;

  for (const entry of RATE_ENTRIES) {
    if (entry.segmentRe.test(normalized)) return entry.rate;
  }
  for (const entry of RATE_ENTRIES) {
    if (entry.key.length >= 4 && normalized.includes(entry.key)) return entry.rate;
  }

  if (normalized.includes('argon') || normalized.includes('gemini-4')) return RATES['gemini-4-argon'];
  if (normalized.includes('gpt-oss')) return RATES['gpt-oss-120b'];
  if (normalized.includes('opus')) {
    if (/(^|-)5(-|$)/.test(normalized)) return RATES['claude-opus-5-5'];
    if (/(^|-)4-(5|6)(-|$)/.test(normalized)) return RATES['claude-opus-4-5'];
    return RATES['claude-opus-4-5'];
  }
  if (normalized.includes('sonnet')) {
    if (/(^|-)5(-|$)/.test(normalized)) return RATES['claude-sonnet-5-5'];
    return RATES['claude-sonnet-4-5'];
  }
  if (normalized.includes('haiku')) {
    if (/(^|-)(4-5|5)(-|$)/.test(normalized)) return RATES['claude-haiku-4-5'];
    return RATES['claude-3-5-haiku'];
  }
  if (normalized.includes('flash-lite')) return RATES['gemini-3-1-flash-lite'];
  if (normalized.includes('flash')) {
    if (normalized.includes('gemini-2')) return RATES['gemini-2-5-flash'];
    return RATES['gemini-3-8-flash'];
  }
  if (normalized.includes('gemini-3')) return RATES['gemini-3-1-pro'];
  if (normalized.includes('gemini') || normalized.includes('pro')) return RATES['gemini-2-5-pro'];
  if (normalized.includes('mini')) return RATES['gpt-4o-mini'];
  if (normalized.includes('grok')) return RATES['grok-4'];
  return DEFAULT_RATE;
}

export function estimateCost(record: TokenUsageRecord): number {
  if (typeof record.estimatedCostUsd === 'number' && record.estimatedCostUsd > 0) {
    return record.estimatedCostUsd;
  }

  const rate = resolveModelRate(record.model);
  const inputCost = ((record.input || 0) / 1_000_000) * rate.inputPerMillion;
  const outputCost = ((record.output || 0) / 1_000_000) * rate.outputPerMillion;
  const cacheReadCost = ((record.cacheRead || 0) / 1_000_000) * (rate.cacheReadPerMillion ?? rate.inputPerMillion * 0.25);
  const cacheWriteCost = ((record.cacheWrite || 0) / 1_000_000) * (rate.cacheWritePerMillion ?? rate.inputPerMillion * 1.25);

  return Number((inputCost + outputCost + cacheReadCost + cacheWriteCost).toFixed(6));
}
