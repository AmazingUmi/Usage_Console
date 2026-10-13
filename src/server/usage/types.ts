export interface TokenUsageRecord {
  id?: string;
  timestamp: number;
  provider: string;
  model: string;
  input: number;
  output: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  pricingAsOf?: string;
  source?: string;
  sessionId?: string;
}

export interface UsageSummary {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd: number;
  requestCount: number;
}

export interface DailyTrendPoint {
  date: string; // YYYY-MM-DD
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  requestCount: number;
}

export interface GroupedUsage {
  name: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  estimatedCostUsd: number;
  requestCount: number;
  percentage: number;
}

export type UsageRange = 'today' | '7d' | '30d' | 'all';
