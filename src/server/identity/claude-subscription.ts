import { L } from '../i18n.js';
import { proxyFetch as fetch } from '../network/proxy.js';
import type { QuotaWindow } from '../quota/types.js';

export interface ClaudeSubscription {
  plan?: string;
  capturedAt: number;
  windows: QuotaWindow[];
}

export class ClaudeHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

const HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'anthropic-beta': 'oauth-2025-04-20',
  'User-Agent': 'claude-code/2.0.0 (usage-console)',
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function remaining(used: unknown): number | null {
  if (used == null) return null;
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

/** Fixed windows returned by /api/oauth/usage, in display order. Null entries mean "not on this plan". */
const FIXED_WINDOWS: Array<{ key: string; label: string; minutes: number }> = [
  { key: 'five_hour', label: '5-Hour Limit', minutes: 300 },
  { key: 'seven_day', label: 'Weekly Limit', minutes: 10080 },
  { key: 'seven_day_opus', label: 'Opus Weekly Limit', minutes: 10080 },
  { key: 'seven_day_sonnet', label: 'Sonnet Weekly Limit', minutes: 10080 },
];

export function parseClaudeSubscription(usage: unknown, plan?: string): ClaudeSubscription | null {
  const body = record(usage);
  if (!body) return null;
  const windows: QuotaWindow[] = [];
  for (const item of FIXED_WINDOWS) {
    const raw = record(body[item.key]);
    const parsed = raw ? windowFrom(item.label, item.minutes, raw.utilization, raw.resets_at) : null;
    if (parsed) windows.push(parsed);
  }

  const limits = Array.isArray(body.limits) ? body.limits : [];
  for (const limit of limits) {
    const item = record(limit);
    if (!item || item.kind !== 'weekly_scoped') continue;
    const scope = record(item.scope) || {};
    if (scope.surface) continue;
    const model = text(record(scope.model)?.display_name);
    if (!model) continue;
    const label = `${model} Weekly Limit`;
    if (windows.some((window) => window.label === label)) continue;
    const parsed = windowFrom(label, 10080, item.percent ?? item.utilization, item.resets_at);
    if (parsed) windows.push(parsed);
  }

  if (windows.length === 0) return null;
  return { plan: plan || undefined, capturedAt: Date.now(), windows };
}

async function getJson(url: string, accessToken: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new ClaudeHttpError(res.status, `HTTP ${res.status}`);
  return res.json();
}

export async function queryClaudeProfile(accessToken: string): Promise<{
  userId: string;
  email?: string;
  organization?: string;
  plan?: string;
}> {
  const profile = record(await getJson('https://api.anthropic.com/api/oauth/profile', accessToken)) || {};
  const account = record(profile.account) || {};
  const organization = record(profile.organization) || {};
  const userId = text(account.uuid);
  if (!userId) throw new Error('Could not identify the Claude user ID');
  let plan = text(organization.organization_type) || text(organization.subscription_type) || text(account.subscription_type);
  if (/max/i.test(plan)) plan = 'max';
  else if (/pro/i.test(plan)) plan = 'pro';
  else if (/team/i.test(plan)) plan = 'team';
  else if (/enterprise/i.test(plan)) plan = 'enterprise';
  if (account.has_claude_max === true) plan = 'max';
  else if (!plan && account.has_claude_pro === true) plan = 'pro';
  return {
    userId,
    email: text(account.email) || text(account.email_address) || undefined,
    organization: text(organization.name) || undefined,
    plan: plan || undefined,
  };
}

export async function queryClaudeUsage(accessToken: string, plan?: string): Promise<ClaudeSubscription | null> {
  return parseClaudeSubscription(await getJson('https://api.anthropic.com/api/oauth/usage', accessToken), plan);
}

/** Used by the browser login flow: identity is required, quota must be readable. */
export async function queryClaudeSubscription(accessToken: string): Promise<{ userId: string; email?: string; subscription: ClaudeSubscription | null }> {
  let profile: Awaited<ReturnType<typeof queryClaudeProfile>>;
  try {
    profile = await queryClaudeProfile(accessToken);
  } catch (err) {
    const status = err instanceof ClaudeHttpError ? `（HTTP ${err.status}）` : '';
    throw new Error(L(`Claude 订阅身份读取失败${status}`, `Could not read the Claude account identity${status}`));
  }
  try {
    const subscription = await queryClaudeUsage(accessToken, profile.plan);
    return { userId: profile.userId, email: profile.email, subscription };
  } catch (err) {
    if (err instanceof ClaudeHttpError && (err.status === 401 || err.status === 403)) {
      throw new Error(L('这个登录不能读取 Claude 订阅额度。请用订阅账号重新认证，不要使用 API Key 授权。', 'This login cannot read Claude subscription quota. Sign in with a subscription account, not an API key.'));
    }
    return { userId: profile.userId, email: profile.email, subscription: null };
  }
}
