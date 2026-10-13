import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';
import type { ProviderQuota, QuotaState, QuotaWindow } from './types.js';
import { AgyUnavailableError, queryAgyQuota } from './agy.js';
import { loadAccounts } from '../data/library.js';
import { fetchClaudeAccountQuota } from '../identity/claude-account.js';
import { ClaudeHttpError } from '../identity/claude-subscription.js';
import { listCredentials, withToken } from '../identity/credentials.js';
import type { CredentialProvider } from '../identity/credentials.js';
import { OAuthLoginError } from '../identity/credentials.js';

interface RawCodexResponse {
  user_id?: string;
  account_id?: string;
  email?: string;
  plan_type?: string;
  rate_limit?: {
    primary_window?: {
      used_percent: number;
      limit_window_seconds?: number;
      reset_at?: number;
    } | null;
    secondary_window?: {
      used_percent: number;
      limit_window_seconds?: number;
      reset_at?: number;
    } | null;
  };
}

interface RawGrokResponse {
  config?: {
    currentPeriod?: {
      start?: string;
      end?: string;
      type?: string;
    };
    creditUsagePercent?: number;
  };
}

class HttpStatusError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

let cachedQuotaState: QuotaState | null = null;
let lastFetchTime = 0;

export async function fetchLiveCodexQuota(
  token: string,
  accountId?: string,
  accountLabel = 'OpenAI Codex'
): Promise<ProviderQuota> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  if (accountId) {
    headers['ChatGPT-Account-Id'] = accountId;
  }

  const res = await fetch('https://chatgpt.com/backend-api/wham/usage', {
    headers,
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new HttpStatusError(res.status, `Codex API responded with HTTP ${res.status}`);
  }

  const data = (await res.json()) as RawCodexResponse;
  const rateLimit = data.rate_limit;
  const windows: QuotaWindow[] = [];

  // Some plans only expose a weekly window as "primary", so name each window by its length, not its slot.
  const pushWindow = (
    raw: { used_percent: number; limit_window_seconds?: number; reset_at?: number },
    fallbackMinutes: number
  ) => {
    const windowMinutes = raw.limit_window_seconds ? Math.round(raw.limit_window_seconds / 60) : fallbackMinutes;
    windows.push({
      label: windowMinutes >= 5 * 24 * 60 ? 'Weekly Limit' : '5-Hour Limit',
      remainingPercent: Math.max(0, 100 - raw.used_percent),
      resetAt: raw.reset_at ? raw.reset_at * 1000 : undefined,
      windowMinutes,
    });
  };
  if (rateLimit?.primary_window) pushWindow(rateLimit.primary_window, 300);
  if (rateLimit?.secondary_window) pushWindow(rateLimit.secondary_window, 10080);

  const plan = data.plan_type === 'prolite' ? 'Pro Lite' : data.plan_type || 'Active';

  return {
    provider: 'codex',
    displayName: `${accountLabel}${data.email ? ` (${data.email})` : ''}`,
    plan,
    capturedAt: Date.now(),
    status: 'ok',
    windows,
    accountId: data.account_id,
  };
}

function httpStatusOf(err: unknown): number | undefined {
  if (err instanceof HttpStatusError || err instanceof ClaudeHttpError) return err.status;
  return undefined;
}

function failedQuota(provider: string, displayName: string, err: unknown, accountId?: string): ProviderQuota {
  // A refresh the server rejected, or a 401 that survived a refresh, both mean the login itself is gone.
  const expired = err instanceof OAuthLoginError || httpStatusOf(err) === 401;
  const errorCode = expired ? 'login_expired' : httpStatusOf(err) === 429 ? 'rate_limited' : 'read_failed';
  return {
    provider,
    displayName,
    capturedAt: Date.now(),
    status: 'error',
    errorCode,
    errorMessage: (err as Error).message,
    accountId,
  };
}

export async function fetchLiveGrokQuota(token: string, label = 'xAI Grok', accountId?: string): Promise<ProviderQuota> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };

  const res = await fetch('https://cli-chat-proxy.grok.com/v1/billing?format=credits', {
    headers,
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new HttpStatusError(res.status, `Grok API responded with HTTP ${res.status}`);
  }

  const data = (await res.json()) as RawGrokResponse;
  const config = data.config;
  const used = typeof config?.creditUsagePercent === 'number' ? config.creditUsagePercent : 0;
  const remaining = Math.max(0, 100 - used);

  let resetAt: number | undefined;
  if (config?.currentPeriod?.end) {
    resetAt = new Date(config.currentPeriod.end).getTime();
  }

  return {
    provider: 'grok',
    displayName: label,
    plan: 'SuperGrok',
    capturedAt: Date.now(),
    status: 'ok',
    accountId,
    windows: [
      {
        label: 'Weekly Credit',
        remainingPercent: remaining,
        resetAt,
        windowMinutes: 10080,
      },
    ],
  };
}

const isHttp401 = (err: unknown) => err instanceof HttpStatusError && err.status === 401;

/** How long a failed refresh may keep showing the previous good reading (marked stale). */
const STALE_WINDOW_MS = 10 * 60 * 1000;
/** agy takes several seconds; other accounts must not wait for it. */
const AGY_WAIT_MS = 2000;

const lastGood = new Map<string, { at: number; quota: ProviderQuota }>();

/** Stores a reading, or, for a failure, the last good reading marked stale when that is still fresh enough. */
function settle(providers: Record<string, ProviderQuota>, key: string, quota: ProviderQuota): void {
  if (quota.status === 'ok') {
    lastGood.set(key, { at: Date.now(), quota });
    providers[key] = quota;
    return;
  }
  if (quota.errorCode === 'login_expired') {
    // Expired credentials clear the snapshot at once: showing numbers for a dead login would mislead.
    lastGood.delete(key);
    providers[key] = quota;
    return;
  }
  const previous = lastGood.get(key);
  if (quota.status === 'error' && previous && Date.now() - previous.at <= STALE_WINDOW_MS) {
    providers[key] = {
      ...previous.quota,
      status: 'warning',
      stale: true,
      errorCode: quota.errorCode,
      errorMessage: quota.errorMessage,
    };
    return;
  }
  providers[key] = quota;
}

let inflightQuery: Promise<QuotaState> | null = null;

export function quotaAgeMs(): number {
  return cachedQuotaState ? Date.now() - lastFetchTime : Infinity;
}

/**
 * Without `forceRefresh` this returns what the last poll produced; the poll interval (a setting) decides
 * how fresh that is. Only the very first call, with nothing cached, reads providers.
 */
export function queryAllLiveQuotas(forceRefresh = false): Promise<QuotaState> {
  if (!forceRefresh && cachedQuotaState) return Promise.resolve(cachedQuotaState);
  if (inflightQuery) return inflightQuery;
  inflightQuery = readAllProviders(forceRefresh).finally(() => {
    inflightQuery = null;
  });
  return inflightQuery;
}

async function readAllProviders(forceRefresh: boolean): Promise<QuotaState> {
  const providers: Record<string, ProviderQuota> = {};
  const tasks: Promise<void>[] = [];
  const seen: Record<CredentialProvider, Set<string>> = { gpt: new Set(), claude: new Set(), grok: new Set() };

  const library = loadAccounts();
  /** `Codex` or `Codex [备注名]`: the bracket only appears when the account has a name of its own. */
  const titleFor = (type: 'gpt' | 'claude' | 'grok', accountId: string, base: string): string => {
    const saved = library.find((account) => account.type === type && account.userId === accountId);
    return saved?.label ? `${base} [${saved.label}]` : base;
  };

  const track = (key: string, provider: string, label: string, accountId: string, run: () => Promise<ProviderQuota>) => {
    tasks.push(
      run()
        .then((quota) => settle(providers, key, quota))
        .catch((err: Error) => {
          console.warn(`[Quota] ${label} live query failed:`, err.message);
          settle(providers, key, failedQuota(provider, label, err, accountId));
        })
    );
  };

  // 1. Accounts logged in through this console: their own OAuth grant, refreshed here. Nothing else is read for them.
  for (const credential of listCredentials('gpt')) {
    const id = credential.accountId;
    seen.gpt.add(id);
    const label = titleFor('gpt', id, 'Codex');
    track(`codex_${id}`, 'codex', label, id, () => withToken('gpt', credential, (token) => fetchLiveCodexQuota(token, id, label), isHttp401));
  }
  for (const credential of listCredentials('claude')) {
    const id = credential.accountId;
    seen.claude.add(id);
    const label = titleFor('claude', id, 'Claude');
    track(`claude_${id}`, 'claude', label, id, () => fetchClaudeAccountQuota(credential, label));
  }
  for (const credential of listCredentials('grok')) {
    const id = credential.accountId;
    seen.grok.add(id);
    const label = titleFor('grok', id, 'xAI Grok');
    track(`grok_${id}`, 'grok', label, id, () => withToken('grok', credential, (token) => fetchLiveGrokQuota(token, label, id), isHttp401));
  }

  // 2. Antigravity: asks the local agy CLI (its own login), so it needs no OAuth login of ours.
  // It may take longer than the rest; whatever it returns later is written into this same map.
  if (library.some((account) => account.type === 'agy')) {
    const agy = queryAgyQuota(forceRefresh)
      .then((quota) => settle(providers, 'antigravity', quota))
      .catch((err: Error) => {
        console.warn('[Quota] agy usage failed:', err.message);
        settle(providers, 'antigravity', {
          provider: 'antigravity',
          displayName: 'Google Antigravity',
          capturedAt: Date.now(),
          status: 'error',
          errorCode: err instanceof AgyUnavailableError ? 'agy_unavailable' : 'read_failed',
          errorMessage: err.message,
          accountId: 'agy-local',
        });
      });
    tasks.push(Promise.race([agy, new Promise<void>((resolve) => setTimeout(resolve, AGY_WAIT_MS))]));
  }

  await Promise.allSettled(tasks);

  if (library.some((account) => account.type === 'agy') && !providers['antigravity']) {
    const previous = lastGood.get('antigravity');
    providers['antigravity'] = previous && Date.now() - previous.at <= STALE_WINDOW_MS
      ? { ...previous.quota, stale: true }
      : { provider: 'antigravity', displayName: 'Google Antigravity', capturedAt: Date.now(), status: 'loading', accountId: 'agy-local' };
  }

  // 3. Subscription accounts need a console login by default; without one, say what to do instead of hiding them.
  const SETUP: Array<{ type: 'gpt' | 'claude' | 'grok'; provider: string; name: string; prefix: string; vendor: string }> = [
    { type: 'gpt', provider: 'codex', name: 'Codex', prefix: 'codex_', vendor: 'OpenAI' },
    { type: 'claude', provider: 'claude', name: 'Claude', prefix: 'claude_', vendor: 'Claude' },
    { type: 'grok', provider: 'grok', name: 'xAI Grok', prefix: 'grok_', vendor: 'Grok' },
  ];
  for (const account of library) {
    const setup = SETUP.find((item) => item.type === account.type);
    if (!setup || seen[setup.type].has(account.userId)) continue;
    providers[`${setup.prefix}${account.userId}`] = {
      provider: setup.provider,
      displayName: titleFor(setup.type, account.userId, setup.name),
      capturedAt: Date.now(),
      status: 'unconfigured',
      errorCode: 'login_required',
      errorMessage: `This ${setup.vendor} account is not signed in to this console yet. Use "Add account" to authenticate once.`,
      accountId: account.userId,
    };
  }

  const result: QuotaState = { updatedAt: Date.now(), providers };
  cachedQuotaState = result;
  lastFetchTime = Date.now();
  return result;
}
