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
  status: 'ok' | 'warning' | 'error' | 'unconfigured' | 'loading';
  errorCode?: 'login_required' | 'login_expired' | 'no_subscription' | 'rate_limited' | 'read_failed' | 'agy_unavailable' | 'offline';
  errorMessage?: string;
  windows?: QuotaWindow[];
  groups?: QuotaGroup[];
  accountId?: string;
  userId?: string;
  email?: string;
  notes?: string;
  accountCardId?: string;
  accountType?: AccountType;
  /** The card shows the last stored reading because the live read failed. */
  stale?: boolean;
  /** The account has its own login in this console (set from the account list). */
  ownLogin?: boolean;
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
  /** True when this console holds the account's own refreshable login. */
  ownLogin?: boolean;
}

export interface ScanSourceStatus {
  id: string;
  label: string;
  path: string;
  exists: boolean;
  filesScanned: number;
  records: number;
  note?: string;
  noteCodes?: string[];
}

export interface ConsoleSettings {
  hideAgyClaude: boolean;
  quotaBatteryWarning: number;
  quotaBatteryLow: number;
  quotaRefreshIntervalSeconds: number;
  paths: PathSettings;
  defaults: PathSettings;
  resolved: PathSettings;
  availability: Record<keyof PathSettings, boolean>;
  claudeProjectsAll?: string[];
  accounts: ConsoleAccount[];
  dataDir: string;
  scan: {
    lastSyncTime: number;
    recordCount: number;
    sources: ScanSourceStatus[];
  };
}
