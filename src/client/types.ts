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
  accountId?: string;
  userId?: string;
  email?: string;
  notes?: string;
  accountCardId?: string;
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
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
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

export interface PathSettings {
  codexDir: string;
  piAgentDir: string;
  claudeProjectsDir: string;
  grokSessionsDir: string;
}

export type AccountType = 'gpt' | 'claude' | 'grok' | 'agy';

export interface AccountSubscription {
  plan?: string;
  capturedAt: number;
  windows: QuotaWindow[];
}

export interface ConsoleAccount {
  id: string;
  type: AccountType;
  label: string;
  userId?: string;
  notes?: string;
  email?: string;
  source?: 'scan' | 'login';
  subscription?: AccountSubscription;
}

export interface ScanSourceStatus {
  id: string;
  label: string;
  path: string;
  exists: boolean;
  filesScanned: number;
  records: number;
  note?: string;
}

export interface ClaudeLoginStatus {
  state: 'ok' | 'not_logged_in' | 'expired' | 'no_subscription' | 'error';
  message: string;
  checkedAt: number;
  source?: string;
  userId?: string;
  email?: string;
  organization?: string;
  plan?: string;
  expiresAt?: number;
  refreshed?: boolean;
  windows: QuotaWindow[];
}

export interface ConsoleSettings {
  hideAgyClaude: boolean;
  paths: PathSettings;
  defaults: PathSettings;
  resolved: PathSettings;
  availability: Record<keyof PathSettings, boolean>;
  claudeProjectsAll?: string[];
  claudeLogin?: ClaudeLoginStatus | null;
  accounts: ConsoleAccount[];
  dataDir: string;
  scan: {
    lastSyncTime: number;
    recordCount: number;
    sources: ScanSourceStatus[];
  };
}
