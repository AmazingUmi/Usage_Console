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
  provider: string; // 'codex' | 'claude' | 'antigravity' | 'grok'
  displayName: string;
  plan?: string;
  capturedAt: number;
  status: 'ok' | 'warning' | 'error' | 'unconfigured';
  /** Machine-readable reason; the UI translates it. `errorMessage` stays as the English fallback/detail. */
  errorCode?: 'login_required' | 'login_expired' | 'no_subscription' | 'rate_limited' | 'read_failed' | 'agy_unavailable';
  errorMessage?: string;
  windows?: QuotaWindow[];
  groups?: QuotaGroup[];
  accountId?: string;
}

export interface QuotaState {
  updatedAt: number;
  providers: Record<string, ProviderQuota>;
}
