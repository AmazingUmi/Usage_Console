import { getLang } from './i18n';
import type {
  ConsoleAccount,
  ConsoleSettings,
  PathSettings,
  QuotaState,
  UsageSummary,
  DailyTrendPoint,
  GroupedUsage,
  TokenUsageRecord,
  UsageRange,
  UsageOverview,
} from './types';

const API_BASE = '/api';

/** Every call carries the UI language so server-side messages come back in it. */
function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), 'x-lang': getLang() } });
}

export function trendDaysFor(range: UsageRange): number {
  switch (range) {
    case 'today':
    case '7d':
      return 7;
    default:
      return 30;
  }
}

async function readJson<T>(res: Response, fallbackMessage: string): Promise<T> {
  if (!res.ok) {
    let detail = fallbackMessage;
    try {
      const payload = await res.json();
      if (payload?.error) detail = String(payload.error);
    } catch {
      // Keep the generic message when the body is not JSON.
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export async function fetchQuota(signal?: AbortSignal): Promise<QuotaState> {
  const res = await apiFetch(`${API_BASE}/quota`, { signal });
  return readJson<QuotaState>(res, 'Failed to fetch quota');
}

export async function refreshQuota(): Promise<QuotaState> {
  const res = await apiFetch(`${API_BASE}/quota/refresh`, { method: 'POST' });
  return readJson<QuotaState>(res, 'Failed to refresh quota');
}

export async function fetchUsageOverview(
  range: UsageRange,
  options: { days?: number; limit?: number; signal?: AbortSignal } = {},
): Promise<UsageOverview> {
  const params = new URLSearchParams({
    range,
    days: String(options.days ?? trendDaysFor(range)),
    limit: String(options.limit ?? 50),
  });
  const res = await apiFetch(`${API_BASE}/usage/overview?${params}`, { signal: options.signal });
  return readJson<UsageOverview>(res, 'Failed to fetch usage overview');
}

export async function fetchSettings(signal?: AbortSignal): Promise<ConsoleSettings> {
  const res = await apiFetch(`${API_BASE}/settings`, { signal });
  return readJson<ConsoleSettings>(res, 'Failed to fetch settings');
}

export async function saveSettings(body: {
  hideAgyClaude?: boolean;
  quotaBatteryWarning?: number;
  quotaBatteryLow?: number;
  quotaRefreshIntervalSeconds?: number;
  paths?: Partial<PathSettings>;
  accounts?: ConsoleAccount[];
  dataDir?: string;
  rescan?: boolean;
}): Promise<{ settings: ConsoleSettings; quota: QuotaState | null }> {
  const res = await apiFetch(`${API_BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readJson(res, 'Failed to save settings');
}

export async function calibrateData(): Promise<{ settings: ConsoleSettings; count: number }> {
  const res = await apiFetch(`${API_BASE}/data/calibrate`, { method: 'POST' });
  return readJson(res, 'Calibration failed');
}

export async function updateAccount(id: string, patch: { label?: string; notes?: string }): Promise<{ settings: ConsoleSettings }> {
  const res = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return readJson(res, 'Could not save the account');
}

export async function deleteAccount(id: string): Promise<{ settings: ConsoleSettings }> {
  const res = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return readJson(res, 'Could not remove the account');
}

export type DeviceLoginType = 'gpt' | 'grok';

const DEVICE_LABEL: Record<DeviceLoginType, string> = { gpt: 'GPT', grok: 'Grok' };

export async function startDeviceLogin(type: DeviceLoginType): Promise<{ deviceCode: string; userCode: string; verificationUri: string; interval: number }> {
  const res = await apiFetch(`${API_BASE}/login/${type}/start`, { method: 'POST' });
  return readJson(res, `Could not start the ${DEVICE_LABEL[type]} login`);
}

export async function pollDeviceLogin(type: DeviceLoginType, deviceCode: string): Promise<{ pending: true } | { userId: string; settings: ConsoleSettings }> {
  const res = await apiFetch(`${API_BASE}/login/${type}/poll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceCode }),
  });
  return readJson(res, `${DEVICE_LABEL[type]} login failed`);
}

export async function startClaudeLogin(): Promise<{ state: string; authorizeUrl: string }> {
  const res = await apiFetch(`${API_BASE}/login/claude/start`, { method: 'POST' });
  return readJson(res, 'Could not start the Claude login');
}

export async function finishClaudeLogin(state: string, code: string): Promise<{ settings: ConsoleSettings }> {
  const res = await apiFetch(`${API_BASE}/login/claude/finish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, code }),
  });
  return readJson(res, 'Claude login failed');
}

export async function fetchSummary(range: UsageRange): Promise<{ summary: UsageSummary; lastSyncTime: number }> {
  const res = await apiFetch(`${API_BASE}/usage/summary?range=${range}`);
  return readJson(res, 'Failed to fetch summary');
}

export async function fetchTrend(days = 14): Promise<DailyTrendPoint[]> {
  const res = await apiFetch(`${API_BASE}/usage/trend?days=${days}`);
  const data = await readJson<{ trend?: DailyTrendPoint[] }>(res, 'Failed to fetch trend');
  return data.trend ?? [];
}

export async function fetchByModel(range: UsageRange): Promise<GroupedUsage[]> {
  const res = await apiFetch(`${API_BASE}/usage/by-model?range=${range}`);
  const data = await readJson<{ data?: GroupedUsage[] }>(res, 'Failed to fetch model breakdown');
  return data.data ?? [];
}

export async function fetchByProvider(range: UsageRange): Promise<GroupedUsage[]> {
  const res = await apiFetch(`${API_BASE}/usage/by-provider?range=${range}`);
  const data = await readJson<{ data?: GroupedUsage[] }>(res, 'Failed to fetch provider breakdown');
  return data.data ?? [];
}

export async function fetchByClient(range: UsageRange): Promise<GroupedUsage[]> {
  const res = await apiFetch(`${API_BASE}/usage/by-client?range=${range}`);
  const data = await readJson<{ data?: GroupedUsage[] }>(res, 'Failed to fetch client breakdown');
  return data.data ?? [];
}

export async function fetchRecentRecords(limit = 30, range: UsageRange = 'all'): Promise<TokenUsageRecord[]> {
  const res = await apiFetch(`${API_BASE}/usage/records?limit=${limit}&range=${range}`);
  const data = await readJson<{ records?: TokenUsageRecord[] }>(res, 'Failed to fetch records');
  return data.records ?? [];
}

export async function syncUsage(): Promise<{ count: number }> {
  const res = await apiFetch(`${API_BASE}/usage/sync`, { method: 'POST' });
  return readJson(res, 'Failed to sync usage');
}


export async function addLocalAgyAccount(): Promise<{ settings: ConsoleSettings }> {
  const res = await apiFetch(`${API_BASE}/accounts/agy`, { method: 'POST' });
  return readJson(res, 'Could not add the Antigravity account');
}
