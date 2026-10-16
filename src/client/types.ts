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
  /** Seconds between automatic quota reads. 0 is manual only. */
  refreshIntervalSeconds?: number;
  /** When the server will next read quota. Null when manual or not scheduled. */
  nextRefreshAt?: number | null;
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
  ttftMedianMs?: number | null;
  tokensPerSecondMedian?: number | null;
  ttftSamples?: number;
  speedSamples?: number;
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
  ttftMedianMs?: number | null;
  tokensPerSecondMedian?: number | null;
  ttftSamples?: number;
  speedSamples?: number;
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
  ttftMs?: number;
  decodeMs?: number;
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
  speed?: SpeedReport;
  lastSyncTime: number;
}

export interface SpeedGroup {
  model: string;
  client: string;
  ttftSamples: number;
  speedSamples: number;
  ttftMedianMs: number | null;
  ttftP90Ms: number | null;
  tokensPerSecondMedian: number | null;
  tokensPerSecondP90: number | null;
}

export interface SpeedReport {
  ttftSamples: number;
  speedSamples: number;
  requestCount: number;
  ttftMedianMs: number | null;
  tokensPerSecondMedian: number | null;
  groups: SpeedGroup[];
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

export interface ProxyEndpoint {
  source: 'settings' | 'environment' | 'system';
  host: string;
  port: number;
}

export interface ProxyStatus {
  active: ProxyEndpoint | null;
  detected: ProxyEndpoint | null;
  restartRequired: boolean;
  portMismatch: boolean;
  checkedPort: number | null;
  /** TCP only: an open local port does not prove that upstream requests work. */
  listening: boolean | null;
}

export interface ConsoleSettings {
  hideAgyClaude: boolean;
  quotaBatteryWarning: number;
  quotaBatteryLow: number;
  quotaRefreshIntervalSeconds: number;
  proxyPort: number | null;
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
