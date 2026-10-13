import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';
import type { ProviderQuota, QuotaState, QuotaWindow } from './types.js';
import { getLatestQuotaState } from './scanner.js';
import { loadAccounts } from '../data/library.js';
import { fetchClaudeAccountQuota } from '../identity/claude-account.js';
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
const CACHE_TTL_MS = 60 * 1000; // 60s cache

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

function failedQuota(provider: string, displayName: string, err: unknown, accountId?: string): ProviderQuota {
  const expired = err instanceof OAuthLoginError;
  return {
    provider,
    displayName,
    capturedAt: Date.now(),
    status: 'error',
    errorCode: expired ? 'login_expired' : 'read_failed',
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

export async function queryAllLiveQuotas(forceRefresh = false): Promise<QuotaState> {
  const now = Date.now();
  if (!forceRefresh && cachedQuotaState && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedQuotaState;
  }

  const providers: Record<string, ProviderQuota> = {};
  const tasks: Promise<void>[] = [];
  const seen: Record<CredentialProvider, Set<string>> = { gpt: new Set(), claude: new Set(), grok: new Set() };

  const library = loadAccounts();
  /** `Codex` or `Codex [备注名]`: the bracket only appears when the account has a name of its own. */
  const titleFor = (type: 'gpt' | 'claude' | 'grok', accountId: string, base: string): string => {
    const saved = library.find((account) => account.type === type && account.userId === accountId);
    return saved?.label ? `${base} [${saved.label}]` : base;
  };

  // 1. Accounts logged in through this console: their own OAuth grant, refreshed here. Nothing else is read for them.
  for (const credential of listCredentials('gpt')) {
    const id = credential.accountId;
    seen.gpt.add(id);
    const label = titleFor('gpt', id, 'Codex');
    const key = `codex_${id}`;
    tasks.push(
      withToken('gpt', credential, (token) => fetchLiveCodexQuota(token, id, label), isHttp401)
        .then((quota) => { providers[key] = quota; })
        .catch((err: Error) => {
          console.warn(`[Quota] ${label} live query failed:`, err.message);
          providers[key] = failedQuota('codex', label, err, id);
        })
    );
  }

  for (const credential of listCredentials('claude')) {
    const id = credential.accountId;
    seen.claude.add(id);
    const label = titleFor('claude', id, 'Claude');
    const key = `claude_${id}`;
    tasks.push(
      fetchClaudeAccountQuota(credential, label)
        .then((quota) => { providers[key] = quota; })
        .catch((err: Error) => {
          console.warn(`[Quota] ${label} live query failed:`, err.message);
          providers[key] = failedQuota('claude', label, err, id);
        })
    );
  }

  for (const credential of listCredentials('grok')) {
    const id = credential.accountId;
    seen.grok.add(id);
    const label = titleFor('grok', id, 'xAI Grok');
    const key = `grok_${id}`;
    tasks.push(
      withToken('grok', credential, (token) => fetchLiveGrokQuota(token, label, id), isHttp401)
        .then((quota) => { providers[key] = quota; })
        .catch((err: Error) => {
          console.warn(`[Quota] ${label} live query failed:`, err.message);
          providers[key] = failedQuota('grok', label, err, id);
        })
    );
  }

  // 2. Antigravity: read from the quota snapshots on disk, not an OAuth login of ours.
  try {
    const agyFile = path.join(CONFIG.paths.piQuotaReadings, 'antigravity-shared', 'latest.json');
    if (fsSync.existsSync(agyFile)) {
      const content = await fs.readFile(agyFile, 'utf8');
      const raw = JSON.parse(content);
      providers['antigravity'] = {
        provider: 'antigravity',
        displayName: 'Google Antigravity',
        plan: raw.tier || 'Claude 3.7 / Gemini 2.5',
        capturedAt: raw.capturedAt || Date.now(),
        status: 'ok',
        groups: raw.groups || [],
      };
    }
  } catch {}

  // Await all live queries
  await Promise.allSettled(tasks);

  // 3. Subscription accounts need a console login by default; without one, say what to do instead of hiding them.
  const SETUP: Array<{ type: 'gpt' | 'claude' | 'grok'; provider: string; name: string; prefix: string; vendor: string }> = [
    { type: 'gpt', provider: 'codex', name: 'Codex', prefix: 'codex_', vendor: 'OpenAI' },
    { type: 'claude', provider: 'claude', name: 'Claude', prefix: 'claude_', vendor: 'Claude' },
    { type: 'grok', provider: 'grok', name: 'xAI Grok', prefix: 'grok_', vendor: 'Grok' },
  ];
  for (const account of loadAccounts()) {
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

  try {
    const fallback = await getLatestQuotaState();
    for (const [key, quota] of Object.entries(fallback.providers)) {
      const alreadyPresent = Object.values(providers).some((item) => {
        return item.provider === quota.provider || item.displayName === quota.displayName;
      });
      if (!alreadyPresent && quota.provider === 'antigravity' && quota.status === 'ok') {
        providers[key] = {
          ...quota,
          displayName: quota.displayName.includes('(Cached)') ? quota.displayName : `${quota.displayName} (Cached)`,
        };
      }
    }
  } catch {}

  const result: QuotaState = {
    updatedAt: Date.now(),
    providers,
  };

  cachedQuotaState = result;
  lastFetchTime = Date.now();

  return result;
}
