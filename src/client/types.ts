export interface QuotaWindow {
  label: string;
  remainingPercent: number;
  resetAt?: number;
  windowMinutes?: number;
}

export interface QuotaGroup {
  name: string;
  windows: QuotaWindow[];
}

export interface ProviderQuota {
  provider: string;
  displayName: string;
  plan?: string;
  capturedAt: number;
  status: 'ok' | 'warning' | 'error' | 'unconfigured';
  errorMessage?: string;
  windows?: QuotaWindow[];
  groups?: QuotaGroup[];
}

export interface QuotaState {
  updatedAt: number;
  providers: Record<string, ProviderQuota>;
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
  date: string;
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

export interface TokenUsageRecord {
  id?: string;
  timestamp: number;
  client?: string; // 'codex' | 'pi' | 'grokbuild' | 'claude' | 'gemini' | ...
  provider: string;
  model: string;
  input: number;
  output: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  source?: string;
  sessionId?: string;
}

export type UsageRange = 'today' | '7d' | '30d' | 'all';

export interface UsageOverview {
  range: UsageRange;
  summary: UsageSummary;
  trend: DailyTrendPoint[];
  models: GroupedUsage[];
  providers: GroupedUsage[];
  clients: GroupedUsage[];
  records: TokenUsageRecord[];
  lastSyncTime: number;
}

export type ConnectionState = 'connecting' | 'connected' | 'offline';
