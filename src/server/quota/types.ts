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
  errorMessage?: string;
  windows?: QuotaWindow[];
  groups?: QuotaGroup[];
}

export interface QuotaState {
  updatedAt: number;
  providers: Record<string, ProviderQuota>;
}
