import type { QuotaState, UsageSummary, DailyTrendPoint, GroupedUsage, TokenUsageRecord, UsageRange } from './types';

const API_BASE = '/api';

export async function fetchQuota(): Promise<QuotaState> {
  const res = await fetch(`${API_BASE}/quota`);
  if (!res.ok) throw new Error('Failed to fetch quota');
  return res.json();
}

export async function refreshQuota(): Promise<QuotaState> {
  const res = await fetch(`${API_BASE}/quota/refresh`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to refresh quota');
  return res.json();
}

export async function fetchSummary(range: UsageRange): Promise<{ summary: UsageSummary; lastSyncTime: number }> {
  const res = await fetch(`${API_BASE}/usage/summary?range=${range}`);
  if (!res.ok) throw new Error('Failed to fetch summary');
  return res.json();
}

export async function fetchTrend(days = 14): Promise<DailyTrendPoint[]> {
  const res = await fetch(`${API_BASE}/usage/trend?days=${days}`);
  if (!res.ok) throw new Error('Failed to fetch trend');
  const data = await res.json();
  return data.trend;
}

export async function fetchByModel(range: UsageRange): Promise<GroupedUsage[]> {
  const res = await fetch(`${API_BASE}/usage/by-model?range=${range}`);
  if (!res.ok) throw new Error('Failed to fetch model breakdown');
  const data = await res.json();
  return data.data;
}

export async function fetchByProvider(range: UsageRange): Promise<GroupedUsage[]> {
  const res = await fetch(`${API_BASE}/usage/by-provider?range=${range}`);
  if (!res.ok) throw new Error('Failed to fetch provider breakdown');
  const data = await res.json();
  return data.data;
}

export async function fetchByClient(range: UsageRange): Promise<GroupedUsage[]> {
  const res = await fetch(`${API_BASE}/usage/by-client?range=${range}`);
  if (!res.ok) throw new Error('Failed to fetch client breakdown');
  const data = await res.json();
  return data.data;
}

export async function fetchRecentRecords(limit = 30): Promise<TokenUsageRecord[]> {
  const res = await fetch(`${API_BASE}/usage/records?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch records');
  const data = await res.json();
  return data.records;
}

export async function syncUsage(): Promise<{ count: number }> {
  const res = await fetch(`${API_BASE}/usage/sync`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to sync usage');
  return res.json();
}
