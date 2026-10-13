import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';
import type { ProviderQuota, QuotaState, QuotaWindow } from './types.js';
import { getLatestQuotaState } from './scanner.js';
import { getClaudeLocalStatus } from '../identity/claude-local.js';
import { upsertAccounts } from '../data/library.js';

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
    throw new Error(`Codex API responded with HTTP ${res.status}`);
  }

  const data = (await res.json()) as RawCodexResponse;
  const rateLimit = data.rate_limit;
  const windows: QuotaWindow[] = [];

  if (rateLimit?.primary_window) {
    const pw = rateLimit.primary_window;
    const remaining = Math.max(0, 100 - pw.used_percent);
    windows.push({
      label: '5-Hour Limit',
      remainingPercent: remaining,
      resetAt: pw.reset_at ? pw.reset_at * 1000 : undefined,
      windowMinutes: pw.limit_window_seconds ? Math.round(pw.limit_window_seconds / 60) : 300,
    });
  }

  if (rateLimit?.secondary_window) {
    const sw = rateLimit.secondary_window;
    const remaining = Math.max(0, 100 - sw.used_percent);
    windows.push({
      label: 'Weekly Limit',
      remainingPercent: remaining,
      resetAt: sw.reset_at ? sw.reset_at * 1000 : undefined,
      windowMinutes: sw.limit_window_seconds ? Math.round(sw.limit_window_seconds / 60) : 10080,
    });
  }

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

export async function fetchLiveGrokQuota(token: string, label = 'xAI Grok'): Promise<ProviderQuota> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };

  const res = await fetch('https://cli-chat-proxy.grok.com/v1/billing?format=credits', {
    headers,
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`Grok API responded with HTTP ${res.status}`);
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

export async function queryAllLiveQuotas(forceRefresh = false): Promise<QuotaState> {
  const now = Date.now();
  if (!forceRefresh && cachedQuotaState && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedQuotaState;
  }

  const providers: Record<string, ProviderQuota> = {};
  const tasks: Promise<void>[] = [];
  const seenAccountIds = new Set<string>();

  // Load account identities mapping if exists
  const notesMap: Record<string, { note?: string; email?: string; plan?: string }> = {};
  try {
    const identPath = path.join(CONFIG.paths.piQuotaMonitor, 'account-identities.json');
    if (fsSync.existsSync(identPath)) {
      const idData = JSON.parse(await fs.readFile(identPath, 'utf8'));
      if (Array.isArray(idData.accounts)) {
        for (const acc of idData.accounts) {
          if (acc.accountId) {
            notesMap[acc.accountId] = { note: acc.note, email: acc.email, plan: acc.plan };
          }
        }
      }
    }
  } catch {}

  // 1. Check ~/.codex/auth.json for Codex Primary OAuth
  try {
    const codexAuthPath = CONFIG.paths.codexAuth;
    if (fsSync.existsSync(codexAuthPath)) {
      const content = await fs.readFile(codexAuthPath, 'utf8');
      const auth = JSON.parse(content);
      const token = auth.tokens?.access_token;
      const accountId = auth.tokens?.account_id as string | undefined;

      if (token) {
        if (accountId) seenAccountIds.add(accountId);
        const note = accountId && notesMap[accountId]?.note ? notesMap[accountId].note : 'Primary';
        tasks.push(
          fetchLiveCodexQuota(token, accountId, `Codex [${note}]`)
            .then((quota) => {
              providers['codex_primary'] = quota;
            })
            .catch((err) => {
              console.warn('[Quota] Codex live query failed:', err.message);
            })
        );
      }
    }
  } catch (err) {
    console.warn('[Quota] Failed to read Codex auth:', err);
  }

  // 2. Check ~/.pi/agent/pi-quota-monitor/accounts/ for any other Codex accounts (e.g. obr.json, lyy.json)
  try {
    const accountsDir = path.join(CONFIG.paths.piQuotaMonitor, 'accounts');
    if (fsSync.existsSync(accountsDir)) {
      const files = await fs.readdir(accountsDir);
      for (const file of files) {
        if (!file.endsWith('.json') || file === 'current.json') continue;
        try {
          const accContent = await fs.readFile(path.join(accountsDir, file), 'utf8');
          const accJson = JSON.parse(accContent);
          if (accJson.type === 'oauth' && accJson.access && accJson.accountId) {
            const accId = accJson.accountId as string;
            if (seenAccountIds.has(accId)) continue;
            seenAccountIds.add(accId);
            const note = notesMap[accId]?.note || path.basename(file, '.json');
            const key = `codex_${path.basename(file, '.json')}`;
            tasks.push(
              fetchLiveCodexQuota(accJson.access, accId, `Codex [${note}]`)
                .then((quota) => {
                  providers[key] = quota;
                })
                .catch(() => {
                  // Expired or unauthorized extra accounts can be ignored.
                })
            );
          }
        } catch {}
      }
    }
  } catch {}

  // 3. Check ~/.pi/agent/auth.json for Grok OAuth
  try {
    const piAuthPath = path.join(CONFIG.paths.piAgent, 'auth.json');
    if (fsSync.existsSync(piAuthPath)) {
      const content = await fs.readFile(piAuthPath, 'utf8');
      const auth = JSON.parse(content);

      if (auth.xai?.access) {
        tasks.push(
          fetchLiveGrokQuota(auth.xai.access, 'xAI Grok [小狗蛇]')
            .then((quota) => {
              providers['grok'] = quota;
            })
            .catch((err) => {
              console.warn('[Quota] Grok live query failed:', err.message);
            })
        );
      }
    }
  } catch (err) {
    console.warn('[Quota] Failed to read Pi auth:', err);
  }

  // 4. Antigravity Quota
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

  try {
    const claude = await getClaudeLocalStatus(forceRefresh);
    if (claude.userId) {
      upsertAccounts([{
        type: 'claude',
        userId: claude.userId,
        email: claude.email,
        source: 'scan',
        subscription: claude.subscription,
      }]);
    }
    if (claude.state !== 'not_logged_in' || claude.userId) {
      providers.claude = {
        provider: 'claude',
        displayName: claude.email ? `Claude (${claude.email})` : 'Claude',
        plan: claude.subscription?.plan || claude.plan || '订阅',
        capturedAt: claude.subscription?.capturedAt || claude.checkedAt,
        status: claude.state === 'ok' ? 'ok' : claude.state === 'no_subscription' ? 'warning' : 'error',
        errorMessage: claude.state === 'ok' ? undefined : claude.message,
        windows: claude.subscription?.windows,
        accountId: claude.userId,
      };
    }
  } catch (err) {
    console.warn('[Quota] Claude local login check failed:', (err as Error).message);
  }

  try {
    const fallback = await getLatestQuotaState();
    for (const [key, quota] of Object.entries(fallback.providers)) {
      const alreadyPresent = Object.values(providers).some((item) => {
        return item.provider === quota.provider || item.displayName === quota.displayName;
      });
      if (!alreadyPresent && quota.status === 'ok') {
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
