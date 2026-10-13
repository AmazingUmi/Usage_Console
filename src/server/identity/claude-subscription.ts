import type { QuotaWindow } from '../quota/types.js';

export interface ClaudeSubscription {
  plan?: string;
  capturedAt: number;
  windows: QuotaWindow[];
}

const HEADERS = { Accept: 'application/json', 'anthropic-beta': 'oauth-2025-04-20' };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function remaining(used: unknown): number | null {
  const n = typeof used === 'number' ? used : Number(used);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.max(0, Math.min(100, 100 - n));
}

function resetAt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e11 ? value * 1000 : value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function windowFrom(label: string, windowMinutes: number, used: unknown, resets: unknown): QuotaWindow | null {
  const remainingPercent = remaining(used);
  if (remainingPercent == null) return null;
  const reset = resetAt(resets);
  return { label, windowMinutes, remainingPercent, ...(reset ? { resetAt: reset } : {}) };
}

export function parseClaudeSubscription(usage: unknown, plan?: string): ClaudeSubscription | null {
  if (!usage || typeof usage !== 'object') return null;
  const body = usage as Record<string, unknown>;
  const windows: QuotaWindow[] = [];
  const fiveHour = body.five_hour && typeof body.five_hour === 'object' ? body.five_hour as Record<string, unknown> : null;
  const weekly = body.seven_day && typeof body.seven_day === 'object' ? body.seven_day as Record<string, unknown> : null;
  const five = fiveHour ? windowFrom('5 小时', 300, fiveHour.utilization, fiveHour.resets_at) : null;
  const week = weekly ? windowFrom('每周', 10080, weekly.utilization, weekly.resets_at) : null;
  if (five) windows.push(five);
  if (week) windows.push(week);

  const limits = Array.isArray(body.limits) ? body.limits : [];
  for (const limit of limits) {
    if (!limit || typeof limit !== 'object') continue;
    const item = limit as Record<string, unknown>;
    if (item.kind !== 'weekly_scoped') continue;
    const scope = item.scope && typeof item.scope === 'object' ? item.scope as Record<string, unknown> : {};
    if (scope.surface) continue;
    const model = scope.model && typeof scope.model === 'object' ? text((scope.model as Record<string, unknown>).display_name) : '';
    if (!model) continue;
    const parsed = windowFrom(`${model} 每周`, 10080, item.percent, item.resets_at);
    if (parsed) windows.push(parsed);
  }

  if (windows.length === 0) return null;
  return { plan: plan || undefined, capturedAt: Date.now(), windows };
}

export async function queryClaudeSubscription(accessToken: string): Promise<{ userId: string; email?: string; subscription: ClaudeSubscription | null }> {
  const headers = { ...HEADERS, Authorization: `Bearer ${accessToken}` };
  const profileRes = await fetch('https://api.anthropic.com/api/oauth/profile', {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  if (!profileRes.ok) throw new Error(`Claude 订阅身份读取失败（HTTP ${profileRes.status}）`);
  const profile = await profileRes.json() as Record<string, unknown>;
  const account = profile.account && typeof profile.account === 'object' ? profile.account as Record<string, unknown> : {};
  const organization = profile.organization && typeof profile.organization === 'object'
    ? profile.organization as Record<string, unknown>
    : {};
  const userId = text(account.uuid);
  if (!userId) throw new Error('没有识别到 Claude 用户 ID');
  const plan = text(organization.subscription_type) || text(account.subscription_type) || undefined;
  let subscription: ClaudeSubscription | null = null;
  const usageRes = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  if (usageRes.ok) subscription = parseClaudeSubscription(await usageRes.json(), plan);
  else if (usageRes.status === 401 || usageRes.status === 403) {
    throw new Error('这个登录不能读取 Claude 订阅额度。请用订阅账号重新认证，不要使用 API Key 授权。');
  }
  return { userId, email: text(account.email) || undefined, subscription };
}
